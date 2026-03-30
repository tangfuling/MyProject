package com.niuma.gzh.modules.chat.service.impl;

import com.niuma.gzh.common.ai.AiClient;
import com.niuma.gzh.common.ai.AiClientFactory;
import com.niuma.gzh.common.ai.AiGenerateRequest;
import com.niuma.gzh.common.ai.AiGenerateResult;
import com.niuma.gzh.common.ai.AiMessage;
import com.niuma.gzh.common.ai.AiModelProvider;
import com.niuma.gzh.common.ai.AiToolCall;
import com.niuma.gzh.common.ai.AiToolDefinition;
import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.IdUtil;
import com.niuma.gzh.common.util.JsonUtil;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import com.niuma.gzh.modules.analysis.model.entity.AnalysisReportEntity;
import com.niuma.gzh.modules.analysis.repository.AnalysisReportRepository;
import com.niuma.gzh.modules.article.model.vo.ArticleVO;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class ChatServiceImpl extends BaseService implements ChatService {
    private static final Pattern LEGACY_TOOL_CALL_PATTERN =
        Pattern.compile("^\\[\\[TOOL:get_article_content\\|keyword=(.+?)\\]\\]$", Pattern.DOTALL);

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
        AuthContext.setUserId(userId);
        try {
            UserEntity user = userService.getById(userId);
            AiClient client = aiClientFactory.getByModelCode(user.getAiModel());
            AiModelProvider provider = aiClientFactory.getProvider(user.getAiModel());

            List<AiMessage> history = loadHistory(userId, sessionId);
            String prompt = buildPrompt(userId, dto);
            String requestText = prompt + "\n用户问题: " + dto.getMessage();

            AiGenerateResult firstResult = client.generate(new AiGenerateRequest(
                chatSystemPrompt(),
                requestText,
                history,
                buildToolDefinitions()
            ));

            int totalInputTokens = firstResult.inputTokens();
            int totalOutputTokens = firstResult.outputTokens();
            String finalContent = sanitizeAssistantOutput(firstResult.content());

            ToolCall toolCall = parseNativeToolCall(firstResult.safeToolCalls());
            if (toolCall == null) {
                toolCall = parseLegacyToolCall(firstResult.content());
            }

            if (toolCall != null) {
                String toolResult = executeTool(toolCall, dto);
                List<AiMessage> secondHistory = new ArrayList<>(history);
                if (firstResult.content() != null && !firstResult.content().isBlank()) {
                    secondHistory.add(new AiMessage("assistant", firstResult.content()));
                }
                secondHistory.add(new AiMessage("user", "工具调用结果如下，请直接给最终回答，不要再输出工具调用。\n" + toolResult));

                AiGenerateResult secondResult = client.generate(new AiGenerateRequest(
                    chatSystemPrompt(),
                    requestText,
                    secondHistory,
                    List.of()
                ));
                totalInputTokens += secondResult.inputTokens();
                totalOutputTokens += secondResult.outputTokens();
                finalContent = sanitizeAssistantOutput(secondResult.content());
            }

            streamText(emitter, finalContent);

            int costCent = provider.calcCostCent(totalInputTokens, totalOutputTokens);
            String assistantContentForStore = finalContent;
            final int finalInputTokens = totalInputTokens;
            final int finalOutputTokens = totalOutputTokens;
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
                assistant.setContent(assistantContentForStore);
                assistant.setAiModel(provider.getCode());
                assistant.setInputTokens(finalInputTokens);
                assistant.setOutputTokens(finalOutputTokens);
                assistant.setCostCent(costCent);
                assistant.setCreatedAt(LocalDateTime.now());
                chatMessageRepository.save(assistant);

                userService.logTokenCost(userId, "chat", String.valueOf(assistant.getId()), provider.getCode(),
                    finalInputTokens, finalOutputTokens, costCent);
                return null;
            });

            sendEvent(emitter, Map.of(
                "type", "done",
                "sessionId", sessionId,
                "inputTokens", totalInputTokens,
                "outputTokens", totalOutputTokens,
                "costCent", costCent,
                "aiModel", provider.getCode()
            ));
            emitter.complete();
        } catch (Exception ex) {
            try {
                sendEvent(emitter, Map.of("type", "error", "message", friendlyErrorMessage(ex)));
            } catch (IOException ignored) {
            }
            emitter.completeWithError(ex);
        } finally {
            AuthContext.clear();
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

        List<ArticleVO> recentArticles = articleService.listRangeArticles(dto.getRange(), 5);
        if (!recentArticles.isEmpty()) {
            sb.append("最近文章摘要:\n");
            for (ArticleVO article : recentArticles) {
                String snippet = article.getContent();
                if (snippet == null) {
                    snippet = "";
                }
                if (snippet.length() > 300) {
                    snippet = snippet.substring(0, 300);
                }
                sb.append("- ").append(article.getTitle()).append(": ").append(snippet).append("\n");
            }
        }

        if (dto.getReportId() != null) {
            AnalysisReportEntity report = analysisReportRepository.findById(dto.getReportId());
            if (report != null && report.getUserId().equals(userId)) {
                sb.append("最近分析报告: ").append(report.getContent()).append("\n");
            }
        }
        return sb.toString();
    }

    private String chatSystemPrompt() {
        return "你是公众号数据运营助手。你必须基于用户历史数据给出具体建议，避免鸡汤和空泛表达。"
            + "如需某篇文章完整正文，请优先使用 get_article_content 工具。";
    }

    private List<AiToolDefinition> buildToolDefinitions() {
        Map<String, Object> schema = new HashMap<>();
        schema.put("type", "object");
        schema.put("properties", Map.of(
            "keyword", Map.of(
                "type", "string",
                "description", "文章标题关键词或 wxArticleId"
            )
        ));
        schema.put("required", List.of("keyword"));
        schema.put("additionalProperties", false);

        return List.of(new AiToolDefinition(
            "get_article_content",
            "根据文章标题关键词或 wxArticleId 获取文章正文与关键指标",
            schema
        ));
    }

    private ToolCall parseNativeToolCall(List<AiToolCall> calls) {
        if (calls == null || calls.isEmpty()) {
            return null;
        }
        AiToolCall first = calls.getFirst();
        if (first == null || first.name() == null || first.name().isBlank()) {
            return null;
        }
        String keyword = "";
        try {
            Map<?, ?> args = jsonUtil.fromJson(first.argumentsJson(), Map.class);
            Object value = args.get("keyword");
            if (value != null) {
                keyword = String.valueOf(value).trim();
            }
        } catch (Exception ignore) {
            keyword = first.argumentsJson();
        }
        if (keyword.isBlank()) {
            return null;
        }
        return new ToolCall(first.name(), keyword);
    }

    private ToolCall parseLegacyToolCall(String content) {
        if (content == null) {
            return null;
        }
        Matcher matcher = LEGACY_TOOL_CALL_PATTERN.matcher(content.trim());
        if (!matcher.matches()) {
            return null;
        }
        String keyword = matcher.group(1).trim();
        if (keyword.isEmpty()) {
            return null;
        }
        return new ToolCall("get_article_content", keyword);
    }

    private String executeTool(ToolCall call, ChatSendDTO dto) {
        if (!"get_article_content".equals(call.name())) {
            return "工具调用失败：不支持的工具 " + call.name();
        }
        List<ArticleVO> candidates = articleService.listRangeArticles(dto.getRange(), 30);
        String keywordLower = call.keyword().toLowerCase();
        for (ArticleVO article : candidates) {
            String title = article.getTitle() == null ? "" : article.getTitle();
            String wxId = article.getWxArticleId() == null ? "" : article.getWxArticleId();
            if (!title.toLowerCase().contains(keywordLower) && !wxId.toLowerCase().contains(keywordLower)) {
                continue;
            }
            String content = article.getContent() == null ? "" : article.getContent();
            if (content.length() > 4000) {
                content = content.substring(0, 4000);
            }
            return "tool=get_article_content\n"
                + "title=" + title + "\n"
                + "wxArticleId=" + wxId + "\n"
                + "publishTime=" + article.getPublishTime() + "\n"
                + "readCount=" + article.getReadCount() + "\n"
                + "sendCount=" + article.getSendCount() + "\n"
                + "content=" + content;
        }
        return "tool=get_article_content\nresult=未找到匹配文章，keyword=" + call.keyword();
    }

    private String sanitizeAssistantOutput(String content) {
        if (content == null) {
            return "";
        }
        ToolCall toolCall = parseLegacyToolCall(content);
        if (toolCall != null) {
            return "我需要更多文章内容才能回答，请换个问题或指定更准确的文章标题。";
        }
        return content;
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

    private String friendlyErrorMessage(Exception ex) {
        if (ex instanceof BizException bizException && bizException.getCode() == ErrorCode.THIRD_PARTY_ERROR.getCode()) {
            return "当前模型暂时不可用，请切换其他模型重试";
        }
        String message = ex.getMessage();
        if (message == null || message.isBlank()) {
            return "对话生成失败，请稍后重试";
        }
        return message;
    }

    private record ToolCall(String name, String keyword) {
    }
}
