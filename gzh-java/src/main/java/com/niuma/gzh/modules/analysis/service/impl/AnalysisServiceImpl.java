package com.niuma.gzh.modules.analysis.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.ai.AiClient;
import com.niuma.gzh.common.ai.AiClientFactory;
import com.niuma.gzh.common.ai.AiGenerateRequest;
import com.niuma.gzh.common.ai.AiGenerateResult;
import com.niuma.gzh.common.ai.AiModelProvider;
import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.JsonUtil;
import com.niuma.gzh.modules.analysis.model.dto.GenerateAnalysisDTO;
import com.niuma.gzh.modules.analysis.model.entity.AnalysisReportEntity;
import com.niuma.gzh.modules.analysis.model.vo.AnalysisReportVO;
import com.niuma.gzh.modules.analysis.repository.AnalysisReportRepository;
import com.niuma.gzh.modules.analysis.service.AnalysisService;
import com.niuma.gzh.modules.article.model.vo.ArticleVO;
import com.niuma.gzh.modules.article.model.vo.OverviewVO;
import com.niuma.gzh.modules.article.service.ArticleService;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.service.UserService;
import java.io.IOException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class AnalysisServiceImpl extends BaseService implements AnalysisService {
    private final ArticleService articleService;
    private final UserService userService;
    private final AnalysisReportRepository analysisReportRepository;
    private final AiClientFactory aiClientFactory;
    private final TransactionTemplate transactionTemplate;
    private final JsonUtil jsonUtil;

    public AnalysisServiceImpl(ArticleService articleService,
                               UserService userService,
                               AnalysisReportRepository analysisReportRepository,
                               AiClientFactory aiClientFactory,
                               TransactionTemplate transactionTemplate,
                               JsonUtil jsonUtil) {
        this.articleService = articleService;
        this.userService = userService;
        this.analysisReportRepository = analysisReportRepository;
        this.aiClientFactory = aiClientFactory;
        this.transactionTemplate = transactionTemplate;
        this.jsonUtil = jsonUtil;
    }

    @Override
    public SseEmitter generate(GenerateAnalysisDTO dto) {
        Long userId = AuthContext.requiredUserId();
        String range = dto.getRange() == null || dto.getRange().isBlank() ? "30d" : dto.getRange();

        SseEmitter emitter = new SseEmitter(0L);
        CompletableFuture.runAsync(() -> runGenerate(userId, range, emitter));
        return emitter;
    }

    @Override
    public PageResult<AnalysisReportVO> reports(long page, long size) {
        Long userId = AuthContext.requiredUserId();
        Page<AnalysisReportEntity> result = analysisReportRepository.pageByUser(userId, page, size);
        List<AnalysisReportVO> records = result.getRecords().stream().map(this::toVO).toList();
        return new PageResult<>(page, size, result.getTotal(), records);
    }

    @Override
    public AnalysisReportVO reportDetail(Long id) {
        Long userId = AuthContext.requiredUserId();
        AnalysisReportEntity report = analysisReportRepository.findById(id);
        if (report == null || !report.getUserId().equals(userId)) {
            return null;
        }
        return toVO(report);
    }

    private void runGenerate(Long userId, String range, SseEmitter emitter) {
        try {
            OverviewVO overview = articleService.overview(range);
            List<ArticleVO> articles = articleService.listRangeArticles(range, 20);
            UserEntity user = userService.getById(userId);

            String systemPrompt = analysisSystemPrompt();
            String userPrompt = buildAnalysisPrompt(range, overview, articles);

            AiClient client = aiClientFactory.getByModelCode(user.getAiModel());
            AiModelProvider provider = aiClientFactory.getProvider(user.getAiModel());
            AiGenerateResult aiResult = client.generate(new AiGenerateRequest(systemPrompt, userPrompt, List.of()));
            String content = aiResult.content();

            streamText(emitter, content);

            List<String> suggestedQuestions = buildSuggestedQuestions(overview);
            int costCent = provider.calcCostCent(aiResult.inputTokens(), aiResult.outputTokens());
            AnalysisReportEntity saved = transactionTemplate.execute(status -> persistReportAndCharge(
                userId,
                range,
                overview.getArticleCount(),
                provider.getCode(),
                aiResult,
                content,
                suggestedQuestions,
                costCent
            ));
            if (saved == null) {
                throw new IllegalStateException("保存报告失败");
            }

            sendEvent(emitter, Map.of(
                "type", "done",
                "reportId", saved.getId(),
                "inputTokens", aiResult.inputTokens(),
                "outputTokens", aiResult.outputTokens(),
                "costCent", costCent,
                "aiModel", provider.getCode(),
                "suggestedQuestions", suggestedQuestions
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

    private AnalysisReportEntity persistReportAndCharge(Long userId,
                                                        String range,
                                                        int articleCount,
                                                        String aiModel,
                                                        AiGenerateResult result,
                                                        String content,
                                                        List<String> suggestedQuestions,
                                                        int costCent) {
        userService.deductCost(userId, costCent);

        AnalysisReportEntity report = new AnalysisReportEntity();
        report.setUserId(userId);
        report.setRangeCode(range);
        report.setArticleCount(articleCount);
        report.setInputTokens(result.inputTokens());
        report.setOutputTokens(result.outputTokens());
        report.setCostCent(costCent);
        report.setAiModel(aiModel);
        report.setContent(content);
        report.setSuggestedQuestionsJson(jsonUtil.toJson(suggestedQuestions));
        report.setCreatedAt(LocalDateTime.now());
        report.setUpdatedAt(LocalDateTime.now());
        analysisReportRepository.save(report);

        userService.logTokenCost(userId, "analysis", String.valueOf(report.getId()), aiModel,
            result.inputTokens(), result.outputTokens(), costCent);
        return report;
    }

    private AnalysisReportVO toVO(AnalysisReportEntity entity) {
        AnalysisReportVO vo = new AnalysisReportVO();
        vo.setId(entity.getId());
        vo.setRangeCode(entity.getRangeCode());
        vo.setArticleCount(entity.getArticleCount());
        vo.setInputTokens(entity.getInputTokens());
        vo.setOutputTokens(entity.getOutputTokens());
        vo.setCostCent(entity.getCostCent());
        vo.setAiModel(entity.getAiModel());
        vo.setContent(entity.getContent());
        vo.setSuggestedQuestions(parseQuestions(entity.getSuggestedQuestionsJson()));
        vo.setCreatedAt(entity.getCreatedAt());
        return vo;
    }

    private List<String> parseQuestions(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        return jsonUtil.fromJson(json, List.class);
    }

    private String buildAnalysisPrompt(String range, OverviewVO overview, List<ArticleVO> articles) {
        StringBuilder sb = new StringBuilder();
        sb.append("分析范围: ").append(range).append("\n");
        sb.append("文章数量: ").append(overview.getArticleCount()).append("\n");
        sb.append("总阅读: ").append(overview.getMetrics().getTotalRead()).append("\n");
        sb.append("篇均阅读: ").append(overview.getMetrics().getAvgRead()).append("\n");
        sb.append("完读率: ").append(overview.getMetrics().getCompletionRate()).append("\n");
        sb.append("总分享: ").append(overview.getMetrics().getTotalShare()).append("\n");
        sb.append("总点赞: ").append(overview.getMetrics().getTotalLike()).append("\n");
        sb.append("新增关注: ").append(overview.getMetrics().getNewFollowers()).append("\n");
        sb.append("流量来源: ").append(overview.getTrafficSummary()).append("\n\n");

        sb.append("文章详情:\n");
        for (ArticleVO article : articles) {
            sb.append("- ").append(article.getTitle()).append(" | 阅读=").append(article.getReadCount())
                .append(" 分享=").append(article.getShareCount())
                .append(" 点赞=").append(article.getLikeCount())
                .append(" 完读率=").append(article.getCompletionRate())
                .append("\n");
        }
        sb.append("\n请按固定结构输出：阶段、核心发现、3条建议、节奏感、5条推荐问题。\n");
        return sb.toString();
    }

    private String analysisSystemPrompt() {
        return "你是公众号数据运营助手。输出风格：事实导向、具体可执行、避免鸡汤。核心发现必须引用具体数字。建议必须是本周可执行动作。";
    }

    private List<String> buildSuggestedQuestions(OverviewVO overview) {
        List<String> list = new ArrayList<>();
        list.add("下周选题怎么排优先级？");
        list.add("哪种标题更可能提升分享率？");
        list.add("如何提高完读率？");
        list.add("朋友圈以外如何拉新？");
        list.add("下一篇我先改哪三点？");
        return list;
    }

    private void streamText(SseEmitter emitter, String content) throws IOException {
        if (content == null) {
            return;
        }
        int chunkSize = 120;
        for (int i = 0; i < content.length(); i += chunkSize) {
            int end = Math.min(content.length(), i + chunkSize);
            String chunk = content.substring(i, end);
            sendEvent(emitter, Map.of("type", "chunk", "content", chunk));
        }
    }

    private void sendEvent(SseEmitter emitter, Map<String, Object> event) throws IOException {
        emitter.send(SseEmitter.event().data(jsonUtil.toJson(event)));
    }
}
