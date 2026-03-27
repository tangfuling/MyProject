package com.niuma.gzh.modules.article.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.JsonUtil;
import com.niuma.gzh.common.util.RangeUtil;
import com.niuma.gzh.modules.article.model.dto.SyncArticlesDTO;
import com.niuma.gzh.modules.article.model.entity.ArticleEntity;
import com.niuma.gzh.modules.article.model.entity.ArticleSnapshotEntity;
import com.niuma.gzh.modules.article.model.query.ArticleListQuery;
import com.niuma.gzh.modules.article.model.vo.ArticleVO;
import com.niuma.gzh.modules.article.model.vo.OverviewVO;
import com.niuma.gzh.modules.article.model.vo.SyncResultVO;
import com.niuma.gzh.modules.article.repository.ArticleRepository;
import com.niuma.gzh.modules.article.repository.ArticleSnapshotRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ArticleServiceImpl extends BaseService implements ArticleService {
    private final ArticleRepository articleRepository;
    private final ArticleSnapshotRepository snapshotRepository;
    private final JsonUtil jsonUtil;

    public ArticleServiceImpl(ArticleRepository articleRepository,
                              ArticleSnapshotRepository snapshotRepository,
                              JsonUtil jsonUtil) {
        this.articleRepository = articleRepository;
        this.snapshotRepository = snapshotRepository;
        this.jsonUtil = jsonUtil;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public SyncResultVO syncArticles(SyncArticlesDTO dto) {
        Long userId = AuthContext.requiredUserId();
        int newCount = 0;
        int updatedCount = 0;

        for (SyncArticlesDTO.ArticleItem item : dto.getArticles()) {
            ArticleEntity existed = articleRepository.findByUserAndWxId(userId, item.getWxArticleId());
            if (existed == null) {
                ArticleEntity created = new ArticleEntity();
                created.setUserId(userId);
                created.setWxArticleId(item.getWxArticleId());
                created.setTitle(item.getTitle());
                created.setContent(item.getContent());
                created.setWordCount(item.getWordCount() == null ? 0 : item.getWordCount());
                created.setPublishTime(parseDateTime(item.getPublishTime()));
                articleRepository.save(created);
                newCount++;
            } else {
                existed.setTitle(item.getTitle());
                if (item.getContent() != null && !item.getContent().isBlank()) {
                    existed.setContent(item.getContent());
                }
                existed.setWordCount(item.getWordCount() == null ? existed.getWordCount() : item.getWordCount());
                existed.setPublishTime(parseDateTime(item.getPublishTime()));
                articleRepository.save(existed);
                updatedCount++;
            }
        }

        for (SyncArticlesDTO.SnapshotItem snapshotItem : dto.getSnapshots()) {
            ArticleEntity article = articleRepository.findByUserAndWxId(userId, snapshotItem.getWxArticleId());
            if (article == null) {
                continue;
            }
            ArticleSnapshotEntity snapshot = new ArticleSnapshotEntity();
            snapshot.setUserId(userId);
            snapshot.setArticleId(article.getId());
            snapshot.setWxArticleId(snapshotItem.getWxArticleId());
            snapshot.setReadCount(defaultInt(snapshotItem.getReadCount()));
            snapshot.setShareCount(defaultInt(snapshotItem.getShareCount()));
            snapshot.setLikeCount(defaultInt(snapshotItem.getLikeCount()));
            snapshot.setWowCount(defaultInt(snapshotItem.getWowCount()));
            snapshot.setCommentCount(defaultInt(snapshotItem.getCommentCount()));
            snapshot.setSaveCount(defaultInt(snapshotItem.getSaveCount()));
            snapshot.setCompletionRate(BigDecimal.valueOf(snapshotItem.getCompletionRate() == null ? 0 : snapshotItem.getCompletionRate())
                .setScale(2, RoundingMode.HALF_UP));
            snapshot.setNewFollowers(defaultInt(snapshotItem.getNewFollowers()));
            snapshot.setTrafficSourcesJson(jsonUtil.toJson(snapshotItem.getTrafficSources() == null ? Map.of() : snapshotItem.getTrafficSources()));
            snapshot.setSnapshotTime(LocalDateTime.now());
            snapshotRepository.save(snapshot);
        }

        SyncResultVO vo = new SyncResultVO();
        vo.setNewArticles(newCount);
        vo.setUpdatedArticles(updatedCount);
        return vo;
    }

    @Override
    public PageResult<ArticleVO> pageArticles(ArticleListQuery query) {
        Long userId = AuthContext.requiredUserId();
        String range = query.getRange() == null ? "30d" : query.getRange();
        LocalDateTime start = RangeUtil.rangeStart(range);
        LocalDateTime end = LocalDateTime.now();

        long pageNo = query.getPage() == null || query.getPage() <= 0 ? 1L : query.getPage();
        long pageSize = query.getSize() == null || query.getSize() <= 0 ? 20L : query.getSize();
        Page<ArticleEntity> page = articleRepository.pageByUserAndRange(userId, start, end, pageNo, pageSize);

        List<ArticleVO> list = page.getRecords().stream().map(this::toArticleVO).toList();
        return new PageResult<>(pageNo, pageSize, page.getTotal(), list);
    }

    @Override
    public OverviewVO overview(String range) {
        Long userId = AuthContext.requiredUserId();
        String realRange = range == null || range.isBlank() ? "30d" : range;

        int days = RangeUtil.toDays(realRange);
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime currentStart = now.minusDays(days);
        LocalDateTime previousStart = currentStart.minusDays(days);

        MetricsBundle current = calcMetrics(userId, currentStart, now);
        MetricsBundle previous = calcMetrics(userId, previousStart, currentStart);

        OverviewVO vo = new OverviewVO();
        vo.setRange(realRange);
        vo.setArticleCount(current.articleCount);

        OverviewVO.Metrics metrics = new OverviewVO.Metrics();
        metrics.setTotalRead(current.totalRead);
        metrics.setAvgRead(current.avgRead);
        metrics.setCompletionRate(current.completionRate);
        metrics.setTotalShare(current.totalShare);
        metrics.setTotalLike(current.totalLike);
        metrics.setNewFollowers(current.newFollowers);
        vo.setMetrics(metrics);

        OverviewVO.Changes changes = new OverviewVO.Changes();
        changes.setTotalRead(pctChange(current.totalRead, previous.totalRead));
        changes.setAvgRead(pctChange(current.avgRead, previous.avgRead));
        changes.setCompletionRate(pctChange(current.completionRate, previous.completionRate));
        changes.setTotalShare(pctChange(current.totalShare, previous.totalShare));
        changes.setTotalLike(pctChange(current.totalLike, previous.totalLike));
        changes.setNewFollowers(pctChange(current.newFollowers, previous.newFollowers));
        vo.setChanges(changes);
        vo.setTrafficSummary(current.trafficPercent);

        return vo;
    }

    @Override
    public List<ArticleVO> listRangeArticles(String range, int limit) {
        Long userId = AuthContext.requiredUserId();
        String realRange = range == null || range.isBlank() ? "30d" : range;
        LocalDateTime start = RangeUtil.rangeStart(realRange);
        LocalDateTime end = LocalDateTime.now();
        List<ArticleEntity> list = articleRepository.listByUserAndRange(userId, start, end);
        List<ArticleVO> result = new ArrayList<>();
        for (ArticleEntity article : list) {
            result.add(toArticleVO(article));
            if (result.size() >= limit) {
                break;
            }
        }
        return result;
    }

    private ArticleVO toArticleVO(ArticleEntity article) {
        ArticleVO vo = new ArticleVO();
        vo.setId(article.getId());
        vo.setWxArticleId(article.getWxArticleId());
        vo.setTitle(article.getTitle());
        vo.setContent(article.getContent());
        vo.setWordCount(article.getWordCount());
        vo.setPublishTime(article.getPublishTime());

        ArticleSnapshotEntity latest = snapshotRepository.latestByArticle(article.getId());
        if (latest != null) {
            vo.setReadCount(latest.getReadCount());
            vo.setShareCount(latest.getShareCount());
            vo.setLikeCount(latest.getLikeCount());
            vo.setWowCount(latest.getWowCount());
            vo.setCommentCount(latest.getCommentCount());
            vo.setSaveCount(latest.getSaveCount());
            vo.setNewFollowers(latest.getNewFollowers());
            vo.setCompletionRate(latest.getCompletionRate());
            vo.setTrafficSources(jsonUtil.toIntMap(latest.getTrafficSourcesJson()));
        }
        return vo;
    }

    private MetricsBundle calcMetrics(Long userId, LocalDateTime start, LocalDateTime end) {
        List<ArticleEntity> articles = articleRepository.listByUserAndRange(userId, start, end);
        int totalRead = 0;
        int totalShare = 0;
        int totalLike = 0;
        int newFollowers = 0;
        BigDecimal completionSum = BigDecimal.ZERO;
        int completionCount = 0;
        Map<String, Integer> trafficCount = new HashMap<>();

        for (ArticleEntity article : articles) {
            ArticleSnapshotEntity latest = snapshotRepository.latestByArticle(article.getId());
            if (latest == null) {
                continue;
            }
            totalRead += defaultInt(latest.getReadCount());
            totalShare += defaultInt(latest.getShareCount());
            totalLike += defaultInt(latest.getLikeCount());
            newFollowers += defaultInt(latest.getNewFollowers());

            if (latest.getCompletionRate() != null) {
                completionSum = completionSum.add(latest.getCompletionRate());
                completionCount++;
            }

            Map<String, Integer> oneMap = jsonUtil.toIntMap(latest.getTrafficSourcesJson());
            oneMap.forEach((k, v) -> trafficCount.put(k, trafficCount.getOrDefault(k, 0) + defaultInt(v)));
        }

        int articleCount = articles.size();
        int avgRead = articleCount == 0 ? 0 : totalRead / articleCount;
        double completionRate = completionCount == 0 ? 0 : completionSum.divide(BigDecimal.valueOf(completionCount), 2, RoundingMode.HALF_UP).doubleValue();

        int trafficTotal = trafficCount.values().stream().mapToInt(Integer::intValue).sum();
        Map<String, Integer> trafficPercent = new HashMap<>();
        if (trafficTotal > 0) {
            trafficCount.forEach((k, v) -> trafficPercent.put(k, (int) Math.round(v * 100.0 / trafficTotal)));
        }

        return new MetricsBundle(articleCount, totalRead, avgRead, completionRate, totalShare, totalLike, newFollowers, trafficPercent);
    }

    private double pctChange(double current, double previous) {
        if (previous == 0) {
            return current == 0 ? 0 : 100;
        }
        return BigDecimal.valueOf((current - previous) * 100 / previous)
            .setScale(2, RoundingMode.HALF_UP)
            .doubleValue();
    }

    private int defaultInt(Integer value) {
        return value == null ? 0 : value;
    }

    private LocalDateTime parseDateTime(String text) {
        try {
            return OffsetDateTime.parse(text).toLocalDateTime();
        } catch (Exception ignore) {
            try {
                return LocalDateTime.parse(text);
            } catch (Exception ex) {
                return LocalDateTime.now();
            }
        }
    }

    private record MetricsBundle(
        int articleCount,
        int totalRead,
        int avgRead,
        double completionRate,
        int totalShare,
        int totalLike,
        int newFollowers,
        Map<String, Integer> trafficPercent
    ) {}
}
