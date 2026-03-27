package com.niuma.gzh.modules.chat.service.impl;

import com.niuma.gzh.common.ai.AiClient;
import com.niuma.gzh.common.ai.AiClientFactory;
import com.niuma.gzh.common.ai.AiGenerateRequest;
import com.niuma.gzh.common.ai.AiGenerateResult;
import com.niuma.gzh.common.ai.AiMessage;
import com.niuma.gzh.common.ai.AiModelProvider;
import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.IdUtil;
import com.niuma.gzh.common.util.JsonUtil;
import com.niuma.gzh.modules.analysis.model.entity.AnalysisReportEntity;
import com.niuma.gzh.modules.analysis.repository.AnalysisReportRepository;
import com.niuma.gzh.modules.article.model.vo.OverviewVO;
import com.niuma.gzh.modules.article.service.ArticleService;
import com.niuma.gzh.modules.chat.model.dto.ChatSendDTO;
import com.niuma.gzh.modules.chat.model.entity.ChatMessageEntity;
import com.niuma.gzh.modules.chat.model.vo.ChatMessageVO;
import com.niuma.gzh.modules.chat.repository.ChatMessageRepository;
import com.niuma.gzh.modules.chat.service.ChatService;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.service.UserService;
import java.io.IOException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class ChatServiceImpl extends BaseService implements ChatService {
    private final ChatMessageRepository chatMessageRepository;
    private final AnalysisReportRepository analysisReportRepository;
    private final ArticleService articleService;
    private final UserService userService;
    private final AiClientFactory aiClientFactory;
    private final TransactionTemplate transactionTemplate;
    private final JsonUtil jsonUtil;

    public ChatServiceImpl(ChatMessageRepository chatMessageRepository,
                           AnalysisReportRepository analysisReportRepository,
                           ArticleService articleService,
                           UserService userService,
                           AiClientFactory aiClientFactory,
                           TransactionTemplate transactionTemplate,
                           JsonUtil jsonUtil) {
        this.chatMessageRepository = chatMessageRepository;
        this.analysisReportRepository = analysisReportRepository;
        this.articleService = articleService;
        this.userService = userService;
        this.aiClientFactory = aiClientFactory;
        this.transactionTemplate = transactionTemplate;
        this.jsonUtil = jsonUtil;
    }

    @Override
    public SseEmitter send(ChatSendDTO dto) {
        Long userId = AuthContext.requiredUserId();
        String sessionId = dto.getSessionId() == null || dto.getSessionId().isBlank() ? IdUtil.sessionId() : dto.getSessionId();

        SseEmitter emitter = new SseEmitter(0L);
        CompletableFuture.runAsync(() -> runChat(userId, sessionId, dto, emitter));
        return emitter;
    }

    @Override
    public List<ChatMessageVO> history(String sessionId) {
        Long userId = AuthContext.requiredUserId();
        List<ChatMessageEntity> messages = chatMessageRepository.listBySession(userId, sessionId, 200);
        return messages.stream()
            .sorted(Comparator.comparing(ChatMessageEntity::getCreatedAt))
            .map(this::toVO)
            .toList();
    }

    private void runChat(Long userId, String sessionId, ChatSendDTO dto, SseEmitter emitter) {
        try {
            UserEntity user = userService.getById(userId);
            AiClient client = aiClientFactory.getByModelCode(user.getAiModel());
            AiModelProvider provider = aiClientFactory.getProvider(user.getAiModel());

            List<AiMessage> history = loadHistory(userId, sessionId);
            String prompt = buildPrompt(userId, dto);
            AiGenerateResult result = client.generate(new AiGenerateRequest(chatSystemPrompt(), prompt + "\n用户问题: " + dto.getMessage(), history));
            String content = result.content();

            streamText(emitter, content);

            int costCent = provider.calcCostCent(result.inputTokens(), result.outputTokens());
            transactionTemplate.execute(status -> {
                userService.deductCost(userId, costCent);

                ChatMessageEntity userMessage = new ChatMessageEntity();
                userMessage.setUserId(userId);
                userMessage.setSessionId(sessionId);
                userMessage.setReportId(dto.getReportId());
                userMessage.setRole("user");
                userMessage.setContent(dto.getMessage());
                userMessage.setCreatedAt(LocalDateTime.now());
                chatMessageRepository.save(userMessage);

                ChatMessageEntity assistant = new ChatMessageEntity();
                assistant.setUserId(userId);
                assistant.setSessionId(sessionId);
                assistant.setReportId(dto.getReportId());
                assistant.setRole("assistant");
                assistant.setContent(content);
                assistant.setAiModel(provider.getCode());
                assistant.setInputTokens(result.inputTokens());
                assistant.setOutputTokens(result.outputTokens());
                assistant.setCostCent(costCent);
                assistant.setCreatedAt(LocalDateTime.now());
                chatMessageRepository.save(assistant);

                userService.logTokenCost(userId, "chat", String.valueOf(assistant.getId()), provider.getCode(),
                    result.inputTokens(), result.outputTokens(), costCent);
                return null;
            });

            sendEvent(emitter, Map.of(
                "type", "done",
                "sessionId", sessionId,
                "inputTokens", result.inputTokens(),
                "outputTokens", result.outputTokens(),
                "costCent", costCent,
                "aiModel", provider.getCode()
            ));
            emitter.complete();
        } catch (Exception ex) {
            try {
                sendEvent(emitter, Map.of("type", "error", "message", ex.getMessage()));
            } catch (IOException ignored) {
            }
            emitter.completeWithError(ex);
        }
    }

    private List<AiMessage> loadHistory(Long userId, String sessionId) {
        List<ChatMessageEntity> list = chatMessageRepository.listBySession(userId, sessionId, 10);
        List<AiMessage> history = new ArrayList<>();
        list.stream().sorted(Comparator.comparing(ChatMessageEntity::getCreatedAt)).forEach(item -> {
            history.add(new AiMessage(item.getRole(), item.getContent()));
        });
        return history;
    }

    private String buildPrompt(Long userId, ChatSendDTO dto) {
        StringBuilder sb = new StringBuilder();
        OverviewVO overview = articleService.overview(dto.getRange());
        sb.append("当前数据概览: ").append(jsonUtil.toJson(overview)).append("\n");
        if (dto.getReportId() != null) {
            AnalysisReportEntity report = analysisReportRepository.findById(dto.getReportId());
            if (report != null && report.getUserId().equals(userId)) {
                sb.append("最近分析报告: ").append(report.getContent()).append("\n");
            }
        }
        return sb.toString();
    }

    private String chatSystemPrompt() {
        return "你是公众号数据运营助手。你必须基于用户历史数据给出具体建议，避免鸡汤，避免空泛表达。";
    }

    private ChatMessageVO toVO(ChatMessageEntity entity) {
        ChatMessageVO vo = new ChatMessageVO();
        vo.setId(entity.getId());
        vo.setSessionId(entity.getSessionId());
        vo.setReportId(entity.getReportId());
        vo.setRole(entity.getRole());
        vo.setContent(entity.getContent());
        vo.setAiModel(entity.getAiModel());
        vo.setInputTokens(entity.getInputTokens());
        vo.setOutputTokens(entity.getOutputTokens());
        vo.setCostCent(entity.getCostCent());
        vo.setCreatedAt(entity.getCreatedAt());
        return vo;
    }

    private void streamText(SseEmitter emitter, String content) throws IOException {
        if (content == null) {
            return;
        }
        int chunkSize = 120;
        for (int i = 0; i < content.length(); i += chunkSize) {
            int end = Math.min(content.length(), i + chunkSize);
            sendEvent(emitter, Map.of("type", "chunk", "content", content.substring(i, end)));
        }
    }

    private void sendEvent(SseEmitter emitter, Map<String, Object> event) throws IOException {
        emitter.send(SseEmitter.event().data(jsonUtil.toJson(event)));
    }
}
