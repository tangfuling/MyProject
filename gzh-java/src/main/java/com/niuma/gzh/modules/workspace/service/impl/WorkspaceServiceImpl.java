package com.niuma.gzh.modules.workspace.service.impl;

import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.JsonUtil;
import com.niuma.gzh.modules.analysis.model.entity.AnalysisReportEntity;
import com.niuma.gzh.modules.analysis.repository.AnalysisReportRepository;
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
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class WorkspaceServiceImpl extends BaseService implements WorkspaceService {
    private static final DateTimeFormatter TREND_LABEL_FORMAT = DateTimeFormatter.ofPattern("MM-dd", Locale.CHINA);
    private static final List<String> DEFAULT_QUESTIONS = List.of(
        "下一篇写什么",
        "怎么提高分享率",
        "对比上周变化",
        "哪篇完读率最高",
        "搜一搜怎么优化"
    );

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
        log.info("[workspace.overview] start userId={}, inputRange={}, realRange={}", userId, range, realRange);

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

        List<String> questions = analysisPanel.getSuggestedQuestions();
        if (questions == null || questions.isEmpty()) {
            questions = DEFAULT_QUESTIONS;
        }
        vo.setQuickQuestions(questions);

        vo.setArticles(buildArticles(allArticles, 8));
        Integer totalRead = vo.getDataPanel() == null || vo.getDataPanel().getMetrics() == null
            ? null : vo.getDataPanel().getMetrics().getTotalRead();
        Integer articleCount = vo.getHeader() == null ? null : vo.getHeader().getArticleCount();
        log.info("[workspace.overview] done userId={}, range={}, articleCount={}, totalRead={}, articleCards={}",
            userId, realRange, articleCount, totalRead, vo.getArticles().size());
        return vo;
    }

    private WorkspaceOverviewVO.Header buildHeader(UserEntity user, UserProfileVO profile) {
        WorkspaceOverviewVO.Header header = new WorkspaceOverviewVO.Header();
        String phone = user.getPhone() == null ? "" : user.getPhone();
        String suffix = phone.length() <= 4 ? phone : phone.substring(phone.length() - 4);
        header.setAccountName("创作者" + (suffix.isBlank() ? "" : " " + suffix));
        header.setPhoneMasked(profile.getPhone());
        header.setAiModel(profile.getAiModel());
        header.setBalanceCent(profile.getBalanceCent());
        header.setFreeQuotaCent(profile.getFreeQuotaCent());
        header.setArticleCount(profile.getArticleCount());
        header.setLastSyncAt(profile.getLastSyncAt());
        return header;
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
            panel.setSummary("暂无分析报告，先同步数据后点击“重新生成”");
            panel.setActionSuggestions(List.of("点击“重新生成”获取第一份报告"));
            panel.setSuggestedQuestions(DEFAULT_QUESTIONS);
            panel.setContent("");
            return panel;
        }

        List<String> questions = parseQuestions(report.getSuggestedQuestionsJson());
        if (questions.isEmpty()) {
            questions = DEFAULT_QUESTIONS;
        }
        panel.setReportId(report.getId());
        panel.setRangeCode(report.getRangeCode());
        panel.setCreatedAt(report.getCreatedAt());
        panel.setAiModel(report.getAiModel());
        panel.setInputTokens(report.getInputTokens());
        panel.setOutputTokens(report.getOutputTokens());
        panel.setCostCent(report.getCostCent());
        panel.setSummary(toSummary(report.getContent()));
        panel.setActionSuggestions(questions.subList(0, Math.min(3, questions.size())));
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
                if (result.size() >= 5) {
                    break;
                }
            }
            return result;
        } catch (Exception ignore) {
            return List.of();
        }
    }

    private String toSummary(String content) {
        if (content == null || content.isBlank()) {
            return "暂无分析摘要";
        }
        String text = content.replace('\n', ' ').replace('\r', ' ').replaceAll("\\s+", " ").trim();
        if (text.length() <= 130) {
            return text;
        }
        return text.substring(0, 130) + "...";
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
