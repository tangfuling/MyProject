package com.niuma.gzh.modules.workspace.service.impl;

import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.JsonUtil;
import com.niuma.gzh.modules.analysis.model.entity.AnalysisReportEntity;
import com.niuma.gzh.modules.analysis.repository.AnalysisReportRepository;
import com.niuma.gzh.modules.analysis.util.AnalysisResultParser;
import com.niuma.gzh.modules.article.model.vo.ArticleVO;
import com.niuma.gzh.modules.article.model.vo.OverviewVO;
import com.niuma.gzh.modules.article.service.ArticleService;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.model.vo.UserProfileVO;
import com.niuma.gzh.modules.user.service.UserService;
import com.niuma.gzh.modules.workspace.model.vo.WorkspaceOverviewVO;
import com.niuma.gzh.modules.workspace.service.WorkspaceService;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class WorkspaceServiceImpl extends BaseService implements WorkspaceService {
    private static final DateTimeFormatter TREND_LABEL_FORMAT = DateTimeFormatter.ofPattern("MM-dd", Locale.CHINA);
    private static final Pattern TECHNICAL_MP_ID_PATTERN = Pattern.compile("^(gh_|wxid_)[a-z0-9_]{4,}$", Pattern.CASE_INSENSITIVE);

    private final ArticleService articleService;
    private final UserService userService;
    private final AnalysisReportRepository analysisReportRepository;
    private final JsonUtil jsonUtil;

    public WorkspaceServiceImpl(ArticleService articleService,
                                UserService userService,
                                AnalysisReportRepository analysisReportRepository,
                                JsonUtil jsonUtil) {
        this.articleService = articleService;
        this.userService = userService;
        this.analysisReportRepository = analysisReportRepository;
        this.jsonUtil = jsonUtil;
    }

    @Override
    public WorkspaceOverviewVO overview(String range) {
        Long userId = AuthContext.requiredUserId();
        String realRange = normalizeRange(range);
        try {
            UserEntity user = userService.getById(userId);
            UserProfileVO profile = userService.profile();
            OverviewVO overview = articleService.overview(realRange);
            List<ArticleVO> allArticles = articleService.listRangeArticles(realRange, 40);

            WorkspaceOverviewVO vo = new WorkspaceOverviewVO();
            vo.setRange(realRange);
            vo.setHeader(buildHeader(user, profile));
            vo.setDataPanel(buildDataPanel(overview, allArticles));

            AnalysisReportEntity latestReport = analysisReportRepository.latestByUser(userId);
            WorkspaceOverviewVO.AnalysisPanel analysisPanel = buildAnalysisPanel(latestReport);
            vo.setAnalysisPanel(analysisPanel);
            vo.setQuickQuestions(analysisPanel.getSuggestedQuestions() == null ? List.of() : analysisPanel.getSuggestedQuestions());

            vo.setArticles(buildArticles(allArticles, 8));
            return vo;
        } catch (Exception ex) {
            log.error("[tfling][workspace.overview] failed userId={}, range={}, message={}",
                userId, realRange, ex.getMessage(), ex);
            throw ex;
        }
    }

    private WorkspaceOverviewVO.Header buildHeader(UserEntity user, UserProfileVO profile) {
        WorkspaceOverviewVO.Header header = new WorkspaceOverviewVO.Header();
        String accountName = normalizeMpAccountName(profile == null ? null : profile.getMpAccountName());
        if (accountName == null || accountName.isBlank()) {
            accountName = normalizeMpAccountName(user == null ? null : user.getMpAccountName());
        }
        if (accountName == null || accountName.isBlank()) {
            accountName = profile == null ? null : normalizeDisplayName(profile.getDisplayName());
        }
        if (accountName == null || accountName.isBlank()) {
            accountName = user == null ? null : normalizeDisplayName(user.getDisplayName());
        }
        if (accountName == null || accountName.isBlank()) {
            String phone = user == null || user.getPhone() == null ? "" : user.getPhone().trim();
            String suffix = phone.length() <= 4 ? phone : phone.substring(phone.length() - 4);
            accountName = suffix.isBlank() ? "公众号账号" : ("公众号" + suffix);
        }
        header.setAccountName(accountName);
        header.setPhoneMasked(profile.getPhone());
        header.setAiModel(profile.getAiModel());
        header.setBalanceCent(profile.getBalanceCent());
        header.setFreeQuotaCent(profile.getFreeQuotaCent());
        header.setArticleCount(profile.getArticleCount());
        header.setLastSyncAt(profile.getLastSyncAt());
        return header;
    }

    private String normalizeMpAccountName(String rawName) {
        if (rawName == null || rawName.isBlank()) {
            return "";
        }
        String normalized = rawName.trim();
        if (TECHNICAL_MP_ID_PATTERN.matcher(normalized).matches()) {
            return "";
        }
        return normalized;
    }

    private String normalizeDisplayName(String rawName) {
        if (rawName == null || rawName.isBlank()) {
            return "";
        }
        return rawName.trim();
    }

    private WorkspaceOverviewVO.DataPanel buildDataPanel(OverviewVO overview, List<ArticleVO> allArticles) {
        WorkspaceOverviewVO.DataPanel panel = new WorkspaceOverviewVO.DataPanel();

        OverviewVO.Metrics metrics = overview.getMetrics();
        WorkspaceOverviewVO.Metrics dataMetrics = new WorkspaceOverviewVO.Metrics();
        dataMetrics.setTotalRead(metrics == null ? 0 : nullToZero(metrics.getTotalRead()));
        dataMetrics.setAvgRead(metrics == null ? 0 : nullToZero(metrics.getAvgRead()));
        dataMetrics.setCompletionRate(metrics == null ? 0D : nullToZero(metrics.getCompletionRate()));
        dataMetrics.setTotalShare(metrics == null ? 0 : nullToZero(metrics.getTotalShare()));
        dataMetrics.setTotalLike(metrics == null ? 0 : nullToZero(metrics.getTotalLike()));
        dataMetrics.setTotalWow(metrics == null ? 0 : nullToZero(metrics.getTotalWow()));
        dataMetrics.setTotalComment(metrics == null ? 0 : nullToZero(metrics.getTotalComment()));
        dataMetrics.setNewFollowers(metrics == null ? 0 : nullToZero(metrics.getNewFollowers()));
        dataMetrics.setAvgReadTimeSec(metrics == null ? 0 : nullToZero(metrics.getAvgReadTimeSec()));
        dataMetrics.setFollowRate(metrics == null ? 0D : nullToZero(metrics.getFollowRate()));
        dataMetrics.setShareRate(metrics == null ? 0D : nullToZero(metrics.getShareRate()));
        dataMetrics.setLikeRate(metrics == null ? 0D : nullToZero(metrics.getLikeRate()));
        dataMetrics.setWowRate(metrics == null ? 0D : nullToZero(metrics.getWowRate()));
        dataMetrics.setCommentRate(metrics == null ? 0D : nullToZero(metrics.getCommentRate()));
        panel.setMetrics(dataMetrics);

        OverviewVO.Changes changes = overview.getChanges();
        WorkspaceOverviewVO.Changes dataChanges = new WorkspaceOverviewVO.Changes();
        dataChanges.setTotalRead(changes == null ? 0D : nullToZero(changes.getTotalRead()));
        dataChanges.setAvgRead(changes == null ? 0D : nullToZero(changes.getAvgRead()));
        dataChanges.setCompletionRate(changes == null ? 0D : nullToZero(changes.getCompletionRate()));
        dataChanges.setTotalShare(changes == null ? 0D : nullToZero(changes.getTotalShare()));
        dataChanges.setTotalLike(changes == null ? 0D : nullToZero(changes.getTotalLike()));
        dataChanges.setNewFollowers(changes == null ? 0D : nullToZero(changes.getNewFollowers()));
        panel.setChanges(dataChanges);

        panel.setTrafficSummary(overview.getTrafficSummary());
        panel.setTrend(buildTrend(allArticles, 8));
        return panel;
    }

    private WorkspaceOverviewVO.AnalysisPanel buildAnalysisPanel(AnalysisReportEntity report) {
        WorkspaceOverviewVO.AnalysisPanel panel = new WorkspaceOverviewVO.AnalysisPanel();
        if (report == null) {
            panel.setSummary("等待千问分析报告生成后展示建议");
            panel.setArticleCount(0);
            panel.setSignalOverview("等待千问生成信号概览");
            panel.setStage("");
            panel.setFindings(List.of());
            panel.setRhythm("");
            panel.setRiskHint("等待千问生成风险提示");
            panel.setActionSuggestions(List.of());
            panel.setSuggestedQuestions(List.of());
            panel.setContent("");
            return panel;
        }

        List<String> questions = parseQuestions(report.getSuggestedQuestionsJson());
        AnalysisResultParser.Parsed parsed = AnalysisResultParser.parse(report.getContent());
        if (questions.isEmpty()) {
            questions = parsed.suggestedQuestions();
        }
        panel.setReportId(report.getId());
        panel.setRangeCode(report.getRangeCode());
        panel.setArticleCount(report.getArticleCount());
        panel.setCreatedAt(report.getCreatedAt());
        panel.setAiModel(report.getAiModel());
        panel.setInputTokens(report.getInputTokens());
        panel.setOutputTokens(report.getOutputTokens());
        panel.setCostCent(report.getCostCent());
        panel.setSummary(AnalysisResultParser.toSummary(report.getContent()));
        panel.setSignalOverview(parsed.signalOverview());
        panel.setStage(parsed.stage());
        panel.setFindings(parsed.findings());
        panel.setRhythm(parsed.rhythm());
        panel.setRiskHint(parsed.riskHint());
        panel.setActionSuggestions(parsed.actionSuggestions());
        panel.setSuggestedQuestions(questions);
        panel.setContent(report.getContent() == null ? "" : report.getContent());
        return panel;
    }

    private List<WorkspaceOverviewVO.TrendPoint> buildTrend(List<ArticleVO> allArticles, int maxCount) {
        List<ArticleVO> sorted = allArticles.stream()
            .sorted(Comparator.comparing(ArticleVO::getPublishTime, Comparator.nullsLast(Comparator.naturalOrder())))
            .toList();

        int start = Math.max(0, sorted.size() - maxCount);
        List<WorkspaceOverviewVO.TrendPoint> trend = new ArrayList<>();
        for (int i = start; i < sorted.size(); i++) {
            ArticleVO article = sorted.get(i);
            WorkspaceOverviewVO.TrendPoint point = new WorkspaceOverviewVO.TrendPoint();
            point.setLabel(article.getPublishTime() == null ? "--" : article.getPublishTime().format(TREND_LABEL_FORMAT));
            point.setReadCount(nullToZero(article.getReadCount()));
            trend.add(point);
        }
        return trend;
    }

    private List<WorkspaceOverviewVO.ArticleCard> buildArticles(List<ArticleVO> allArticles, int maxCount) {
        List<WorkspaceOverviewVO.ArticleCard> cards = new ArrayList<>();
        int count = Math.min(maxCount, allArticles.size());
        for (int i = 0; i < count; i++) {
            ArticleVO article = allArticles.get(i);
            WorkspaceOverviewVO.ArticleCard card = new WorkspaceOverviewVO.ArticleCard();
            card.setId(article.getId());
            card.setWxArticleId(article.getWxArticleId());
            card.setTitle(article.getTitle());
            card.setPublishTime(article.getPublishTime());
            card.setReadCount(nullToZero(article.getReadCount()));
            card.setSendCount(nullToZero(article.getSendCount()));
            card.setShareCount(nullToZero(article.getShareCount()));
            card.setLikeCount(nullToZero(article.getLikeCount()));
            card.setWowCount(nullToZero(article.getWowCount()));
            card.setCommentCount(nullToZero(article.getCommentCount()));
            card.setSaveCount(nullToZero(article.getSaveCount()));
            card.setAvgReadTimeSec(nullToZero(article.getAvgReadTimeSec()));
            card.setNewFollowers(nullToZero(article.getNewFollowers()));
            card.setCompletionRate(article.getCompletionRate());
            card.setTrafficSources(article.getTrafficSources());
            card.setTrafficSourceRates(article.getTrafficSourceRates());
            cards.add(card);
        }
        return cards;
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
                if (result.size() >= 6) {
                    break;
                }
            }
            return result;
        } catch (Exception ignore) {
            return List.of();
        }
    }

    private String normalizeRange(String range) {
        if ("7d".equals(range) || "30d".equals(range) || "90d".equals(range) || "all".equals(range)) {
            return range;
        }
        return "all";
    }

    private int nullToZero(Integer value) {
        return value == null ? 0 : value;
    }

    private double nullToZero(Double value) {
        return value == null ? 0D : value;
    }
}
