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
import com.niuma.gzh.modules.analysis.util.AnalysisResultParser;
import com.niuma.gzh.modules.article.model.vo.ArticleVO;
import com.niuma.gzh.modules.article.model.vo.OverviewVO;
import com.niuma.gzh.modules.article.service.ArticleService;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.service.UserService;
import java.io.IOException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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

            AnalysisResultParser.Parsed parsed = AnalysisResultParser.parse(content);
            StructuredResult structuredResult = enrichStructuredByAi(client, content, parsed);
            AnalysisResultParser.Parsed structured = structuredResult.parsed;
            List<String> suggestedQuestions = structured.suggestedQuestions();
            int totalInputTokens = aiResult.inputTokens() + structuredResult.extraInputTokens;
            int totalOutputTokens = aiResult.outputTokens() + structuredResult.extraOutputTokens;
            int costCent = provider.calcCostCent(totalInputTokens, totalOutputTokens);
            AnalysisReportEntity saved = transactionTemplate.execute(status -> persistReportAndCharge(
                userId,
                range,
                overview.getArticleCount(),
                provider.getCode(),
                totalInputTokens,
                totalOutputTokens,
                content,
                suggestedQuestions,
                costCent
            ));
            if (saved == null) {
                throw new IllegalStateException("保存报告失败");
            }

            Map<String, Object> donePayload = new LinkedHashMap<>();
            donePayload.put("type", "done");
            donePayload.put("reportId", saved.getId());
            donePayload.put("inputTokens", totalInputTokens);
            donePayload.put("outputTokens", totalOutputTokens);
            donePayload.put("costCent", costCent);
            donePayload.put("aiModel", provider.getCode());
            donePayload.put("stage", structured.stage());
            donePayload.put("findings", structured.findings());
            donePayload.put("actionSuggestions", structured.actionSuggestions());
            donePayload.put("rhythm", structured.rhythm());
            donePayload.put("riskHint", structured.riskHint());
            donePayload.put("suggestedQuestions", suggestedQuestions);
            sendEvent(emitter, donePayload);
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
                                                        int inputTokens,
                                                        int outputTokens,
                                                        String content,
                                                        List<String> suggestedQuestions,
                                                        int costCent) {
        userService.deductCost(userId, costCent);

        AnalysisReportEntity report = new AnalysisReportEntity();
        report.setUserId(userId);
        report.setRangeCode(range);
        report.setArticleCount(articleCount);
        report.setInputTokens(inputTokens);
        report.setOutputTokens(outputTokens);
        report.setCostCent(costCent);
        report.setAiModel(aiModel);
        report.setContent(content);
        report.setSuggestedQuestionsJson(jsonUtil.toJson(suggestedQuestions));
        report.setCreatedAt(LocalDateTime.now());
        report.setUpdatedAt(LocalDateTime.now());
        analysisReportRepository.save(report);

        userService.logTokenCost(userId, "analysis", String.valueOf(report.getId()), aiModel,
            inputTokens, outputTokens, costCent);
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
        AnalysisResultParser.Parsed parsed = AnalysisResultParser.parse(entity.getContent());
        vo.setStage(parsed.stage());
        vo.setFindings(parsed.findings());
        vo.setActionSuggestions(parsed.actionSuggestions());
        vo.setRhythm(parsed.rhythm());
        vo.setRiskHint(parsed.riskHint());
        List<String> questions = parseQuestions(entity.getSuggestedQuestionsJson());
        if (questions.isEmpty()) {
            questions = parsed.suggestedQuestions();
        }
        vo.setSuggestedQuestions(questions);
        vo.setCreatedAt(entity.getCreatedAt());
        return vo;
    }

    private List<String> parseQuestions(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            List<?> raw = jsonUtil.fromJson(json, List.class);
            List<String> result = new ArrayList<>();
            for (Object item : raw) {
                if (item == null) {
                    continue;
                }
                String text = String.valueOf(item).trim();
                if (!text.isEmpty()) {
                    result.add(text);
                }
                if (result.size() >= 5) {
                    break;
                }
            }
            return List.copyOf(result);
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private String buildAnalysisPrompt(String range, OverviewVO overview, List<ArticleVO> articles) {
        StringBuilder sb = new StringBuilder();
        sb.append("分析范围: ").append(range).append("\n");
        sb.append("文章数量: ").append(overview.getArticleCount()).append("\n");
        sb.append("总阅读: ").append(overview.getMetrics().getTotalRead()).append("\n");
        sb.append("总送达: ").append(overview.getMetrics().getTotalSend()).append("\n");
        sb.append("篇均阅读: ").append(overview.getMetrics().getAvgRead()).append("\n");
        sb.append("完读率: ").append(overview.getMetrics().getCompletionRate()).append("\n");
        sb.append("总分享: ").append(overview.getMetrics().getTotalShare()).append("\n");
        sb.append("总点赞: ").append(overview.getMetrics().getTotalLike()).append("\n");
        sb.append("新增关注: ").append(overview.getMetrics().getNewFollowers()).append("\n");
        sb.append("流量来源: ").append(overview.getTrafficSummary()).append("\n\n");

        sb.append("文章详情:\n");
        for (ArticleVO article : articles) {
            sb.append("- ").append(article.getTitle()).append(" | 阅读=").append(article.getReadCount())
                .append(" 送达=").append(article.getSendCount())
                .append(" 分享=").append(article.getShareCount())
                .append(" 点赞=").append(article.getLikeCount())
                .append(" 完读率=").append(article.getCompletionRate())
                .append("\n");
        }
        sb.append("\n请按固定结构输出：你现在在什么阶段、核心发现、3条可执行建议、风险提示、节奏感、5条推荐问题。\n");
        sb.append("输出必须引用数据，不要泛泛而谈。\n");
        return sb.toString();
    }

    private String analysisSystemPrompt() {
        return "你是公众号数据运营助手。输出风格：事实导向、具体可执行、避免鸡汤。"
            + "必须严格输出以下小节标题：你现在在什么阶段、核心发现、可执行建议、风险提示、节奏感、推荐问题。"
            + "核心发现必须引用具体数字，建议必须是本周可执行动作。";
    }

    private StructuredResult enrichStructuredByAi(AiClient client,
                                                  String reportContent,
                                                  AnalysisResultParser.Parsed parsed) {
        if (isStructuredComplete(parsed)) {
            return new StructuredResult(parsed, 0, 0);
        }
        try {
            String prompt = buildExtractPrompt(reportContent);
            AiGenerateResult extractResult = client.generate(new AiGenerateRequest(
                "你是严格的 JSON 提取器。你只能输出 JSON，不要输出任何解释。",
                prompt,
                List.of()
            ));
            StructuredExtract payload = parseStructuredExtract(extractResult.content());
            if (payload == null) {
                return new StructuredResult(parsed, extractResult.inputTokens(), extractResult.outputTokens());
            }
            return new StructuredResult(
                mergeParsed(parsed, payload),
                extractResult.inputTokens(),
                extractResult.outputTokens()
            );
        } catch (Exception ignored) {
            return new StructuredResult(parsed, 0, 0);
        }
    }

    private boolean isStructuredComplete(AnalysisResultParser.Parsed parsed) {
        return parsed != null
            && parsed.stage() != null && !parsed.stage().isBlank()
            && parsed.findings() != null && !parsed.findings().isEmpty()
            && parsed.actionSuggestions() != null && !parsed.actionSuggestions().isEmpty()
            && parsed.riskHint() != null && !parsed.riskHint().isBlank()
            && parsed.suggestedQuestions() != null && parsed.suggestedQuestions().size() >= 3;
    }

    private String buildExtractPrompt(String content) {
        StringBuilder sb = new StringBuilder();
        sb.append("请把下面分析报告提取成 JSON，对象字段固定为：\n");
        sb.append("stage(string)、findings(string[])、actionSuggestions(string[])、rhythm(string)、riskHint(string)、suggestedQuestions(string[])。\n");
        sb.append("规则：\n");
        sb.append("1) 只输出 JSON 对象，不要 markdown。\n");
        sb.append("2) findings 保留 3~5 条，actionSuggestions 保留 3 条，suggestedQuestions 保留 5 条。\n");
        sb.append("3) 如果缺失字段，用空字符串或空数组。\n\n");
        sb.append("报告原文：\n");
        sb.append(content == null ? "" : content);
        return sb.toString();
    }

    private StructuredExtract parseStructuredExtract(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String json = extractFirstJsonObject(text);
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            Map<String, Object> map = jsonUtil.fromJson(json, Map.class);
            StructuredExtract payload = new StructuredExtract();
            payload.stage = firstString(map, "stage");
            payload.findings = firstStringList(map, "findings", "coreFindings", "core_findings");
            payload.actionSuggestions = firstStringList(map, "actionSuggestions", "action_suggestions", "actions");
            payload.rhythm = firstString(map, "rhythm");
            payload.riskHint = firstString(map, "riskHint", "risk_hint");
            payload.suggestedQuestions = firstStringList(map, "suggestedQuestions", "suggested_questions", "questions");
            return payload;
        } catch (Exception ignored) {
            return null;
        }
    }

    private String firstString(Map<String, Object> map, String... keys) {
        if (map == null || map.isEmpty()) {
            return "";
        }
        for (String key : keys) {
            Object value = map.get(key);
            if (value == null) {
                continue;
            }
            String text = String.valueOf(value).trim();
            if (!text.isEmpty()) {
                return text;
            }
        }
        return "";
    }

    private List<String> firstStringList(Map<String, Object> map, String... keys) {
        if (map == null || map.isEmpty()) {
            return List.of();
        }
        for (String key : keys) {
            Object value = map.get(key);
            if (!(value instanceof List<?> raw)) {
                continue;
            }
            List<String> result = new ArrayList<>();
            for (Object item : raw) {
                if (item == null) {
                    continue;
                }
                String text = String.valueOf(item).trim();
                if (!text.isEmpty()) {
                    result.add(text);
                }
            }
            if (!result.isEmpty()) {
                return List.copyOf(result);
            }
        }
        return List.of();
    }

    private String extractFirstJsonObject(String text) {
        int start = text.indexOf('{');
        if (start < 0) {
            return null;
        }
        int depth = 0;
        for (int i = start; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '{') {
                depth++;
            } else if (ch == '}') {
                depth--;
                if (depth == 0) {
                    return text.substring(start, i + 1);
                }
            }
        }
        return null;
    }

    private AnalysisResultParser.Parsed mergeParsed(AnalysisResultParser.Parsed parsed, StructuredExtract extracted) {
        String stage = mergeText(parsed.stage(), extracted.stage);
        String rhythm = mergeText(parsed.rhythm(), extracted.rhythm);
        String riskHint = mergeText(parsed.riskHint(), extracted.riskHint);
        List<String> findings = parsed.findings().isEmpty() ? extracted.findings : parsed.findings();
        List<String> actions = parsed.actionSuggestions().isEmpty() ? extracted.actionSuggestions : parsed.actionSuggestions();
        List<String> questions = parsed.suggestedQuestions().isEmpty() ? extracted.suggestedQuestions : parsed.suggestedQuestions();
        return new AnalysisResultParser.Parsed(
            stage,
            findings == null ? List.of() : findings,
            actions == null ? List.of() : actions,
            rhythm,
            riskHint,
            questions == null ? List.of() : questions
        );
    }

    private String mergeText(String parsedText, String extractedText) {
        if (parsedText != null && !parsedText.isBlank()) {
            return parsedText;
        }
        return extractedText == null ? "" : extractedText.trim();
    }

    private static class StructuredExtract {
        private String stage = "";
        private List<String> findings = List.of();
        private List<String> actionSuggestions = List.of();
        private String rhythm = "";
        private String riskHint = "";
        private List<String> suggestedQuestions = List.of();
    }

    private static class StructuredResult {
        private final AnalysisResultParser.Parsed parsed;
        private final int extraInputTokens;
        private final int extraOutputTokens;

        private StructuredResult(AnalysisResultParser.Parsed parsed, int extraInputTokens, int extraOutputTokens) {
            this.parsed = parsed;
            this.extraInputTokens = Math.max(extraInputTokens, 0);
            this.extraOutputTokens = Math.max(extraOutputTokens, 0);
        }
    }

    private String friendlyErrorMessage(Exception ex) {
        if (ex instanceof BizException bizException && bizException.getCode() == ErrorCode.THIRD_PARTY_ERROR.getCode()) {
            return "当前千问模型暂时不可用，请切换千问版本后重试";
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
