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
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import com.niuma.gzh.modules.analysis.model.dto.GenerateAnalysisDTO;
import com.niuma.gzh.modules.analysis.model.entity.AnalysisReportEntity;
import com.niuma.gzh.modules.analysis.model.vo.AnalysisEstimateVO;
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
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
    public AnalysisEstimateVO estimate(String range) {
        String realRange = normalizeRange(range);
        UserEntity user = userService.getById(AuthContext.requiredUserId());
        AiModelProvider provider = aiClientFactory.getProvider(user.getAiModel());

        OverviewVO overview = articleService.overview(realRange);
        int articleCount = overview.getArticleCount() == null ? 0 : overview.getArticleCount();
        int limit = Math.min(Math.max(articleCount, 200), 5000);
        List<ArticleVO> articles = articleService.listRangeArticles(realRange, limit);

        int totalWords = 0;
        for (ArticleVO article : articles) {
            int wordCount = article.getWordCount() == null ? 0 : article.getWordCount();
            if (wordCount <= 0 && article.getContent() != null) {
                wordCount = article.getContent().length();
            }
            totalWords += Math.max(wordCount, 0);
        }

        int promptOverheadTokens = 2200;
        int structureOverheadTokens = Math.min(20000, articleCount * 120);
        int contentTokens = Math.max(totalWords, articleCount * 700);
        int estimatedInputTokens = Math.max(1200, promptOverheadTokens + structureOverheadTokens + contentTokens);
        int estimatedOutputTokens = Math.max(900, Math.min(4000, 900 + articleCount * 90));
        int estimatedCostCent = provider.calcCostCent(estimatedInputTokens, estimatedOutputTokens);

        AnalysisEstimateVO vo = new AnalysisEstimateVO();
        vo.setRange(realRange);
        vo.setArticleCount(articleCount);
        vo.setEstimatedInputTokens(estimatedInputTokens);
        vo.setEstimatedOutputTokens(estimatedOutputTokens);
        vo.setEstimatedCostCent(estimatedCostCent);
        vo.setAiModel(provider.getCode());
        return vo;
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
        if (report == null) {
            throw new com.niuma.gzh.common.web.BizException(com.niuma.gzh.common.web.ErrorCode.NOT_FOUND.getCode(), "报告不存在");
        }
        if (!report.getUserId().equals(userId)) {
            throw new com.niuma.gzh.common.web.BizException(com.niuma.gzh.common.web.ErrorCode.FORBIDDEN.getCode(), "无权限查看该报告");
        }
        return toVO(report);
    }

    private void runGenerate(Long userId, String range, SseEmitter emitter) {
        AuthContext.setUserId(userId);
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

            List<String> suggestedQuestions = buildSuggestedQuestions(content, overview, articles);
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
                sendEvent(emitter, Map.of("type", "error", "message", friendlyErrorMessage(ex)));
            } catch (IOException ignored) {
            }
            emitter.completeWithError(ex);
        } finally {
            AuthContext.clear();
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

    private List<String> buildSuggestedQuestions(String content, OverviewVO overview, List<ArticleVO> articles) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        if (content != null && !content.isBlank()) {
            String[] lines = content.split("\\R");
            for (String line : lines) {
                String candidate = normalizeQuestionCandidate(line);
                if (candidate != null) {
                    result.add(candidate);
                    if (result.size() >= 5) {
                        return List.copyOf(result);
                    }
                }
            }
        }

        appendHeuristicQuestions(result, overview, articles);
        return List.copyOf(result).subList(0, Math.min(5, result.size()));
    }

    private String normalizeQuestionCandidate(String line) {
        if (line == null || line.isBlank()) {
            return null;
        }
        String text = line.trim()
            .replaceFirst("^[\\-•*\\d\\.\\)\\s]+", "")
            .replaceFirst("^Q[:：]\\s*", "");
        if (text.startsWith("推荐问题") || text.startsWith("问题")) {
            return null;
        }
        if (!(text.contains("?") || text.contains("？"))) {
            return null;
        }
        text = text.replace("?", "？");
        int idx = text.indexOf('？');
        if (idx <= 0) {
            return null;
        }
        text = text.substring(0, idx + 1).trim();
        if (text.length() < 5 || text.length() > 28) {
            return null;
        }
        return text;
    }

    private void appendHeuristicQuestions(Set<String> questions, OverviewVO overview, List<ArticleVO> articles) {
        OverviewVO.Metrics metrics = overview == null ? null : overview.getMetrics();
        double completionRate = metrics == null || metrics.getCompletionRate() == null ? 0 : metrics.getCompletionRate();
        int totalShare = metrics == null || metrics.getTotalShare() == null ? 0 : metrics.getTotalShare();
        int totalRead = metrics == null || metrics.getTotalRead() == null ? 0 : metrics.getTotalRead();
        double shareRate = totalRead <= 0 ? 0 : totalShare * 100.0 / totalRead;

        if (completionRate < 60) {
            questions.add("完读率偏低先改哪三处？");
        } else {
            questions.add("如何把完读率再提10%？");
        }
        if (shareRate < 6) {
            questions.add("怎样把分享率提高一倍？");
        } else {
            questions.add("下一篇怎么提升传播半径？");
        }

        ArticleVO best = articles == null ? null : articles.stream()
            .max(Comparator.comparing(a -> a.getReadCount() == null ? 0 : a.getReadCount()))
            .orElse(null);
        if (best != null && best.getTitle() != null && !best.getTitle().isBlank()) {
            questions.add("怎么复用《" + shortTitle(best.getTitle()) + "》的方法？");
        }

        questions.add("下周选题怎么排优先级？");
        questions.add("哪种标题更可能提升分享率？");
        questions.add("朋友圈以外如何拉新？");
        questions.add("下一篇我先改哪三点？");
    }

    private String shortTitle(String title) {
        if (title.length() <= 12) {
            return title;
        }
        return title.substring(0, 12) + "...";
    }

    private String friendlyErrorMessage(Exception ex) {
        if (ex instanceof BizException bizException && bizException.getCode().equals(ErrorCode.THIRD_PARTY_ERROR.getCode())) {
            return "当前模型暂时不可用，请切换其他模型重试";
        }
        String message = ex.getMessage();
        if (message == null || message.isBlank()) {
            return "生成失败，请稍后重试";
        }
        return message;
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

    private String normalizeRange(String range) {
        if ("7d".equals(range) || "30d".equals(range) || "90d".equals(range) || "all".equals(range)) {
            return range;
        }
        return "30d";
    }
}
