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
import com.niuma.gzh.modules.article.service.ArticleService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
public class ArticleServiceImpl extends BaseService implements ArticleService {
    private static final List<DateTimeFormatter> LOCAL_DATE_TIME_FORMATTERS = List.of(
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"),
        DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm")
    );
    private static final List<DateTimeFormatter> LOCAL_DATE_FORMATTERS = List.of(
        DateTimeFormatter.ISO_LOCAL_DATE,
        DateTimeFormatter.ofPattern("yyyy/MM/dd")
    );

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
        int articleInputSize = dto.getArticles() == null ? 0 : dto.getArticles().size();
        int snapshotInputSize = dto.getSnapshots() == null ? 0 : dto.getSnapshots().size();
        log.info("[tfling] sync/articles start userId={}, articleInputSize={}, snapshotInputSize={}", userId, articleInputSize, snapshotInputSize);
        if (articleInputSize > 0) {
            String sample = dto.getArticles().stream()
                .limit(5)
                .map(SyncArticlesDTO.ArticleItem::getWxArticleId)
                .collect(Collectors.joining(","));
            log.info("[tfling] sync/articles article sample wxArticleIds={}", sample);
        }

        int newCount = 0;
        int updatedCount = 0;
        int snapshotSaved = 0;
        int snapshotMissedArticle = 0;
        int snapshotAllZero = 0;
        long snapshotReadTotal = 0;
        long snapshotSendTotal = 0;
        long snapshotShareTotal = 0;
        long snapshotLikeTotal = 0;
        long snapshotFollowTotal = 0;
        int skippedDeletedArticle = 0;

        for (SyncArticlesDTO.ArticleItem item : dto.getArticles()) {
            if (shouldSkipArticle(item.getTitle())) {
                skippedDeletedArticle++;
                continue;
            }
            LocalDateTime parsedPublishTime = parseDateTime(item.getPublishTime());
            ArticleEntity existed = articleRepository.findByUserAndWxId(userId, item.getWxArticleId());
            if (existed == null) {
                ArticleEntity created = new ArticleEntity();
                created.setUserId(userId);
                created.setWxArticleId(item.getWxArticleId());
                created.setTitle(item.getTitle());
                created.setContent(item.getContent());
                created.setWordCount(item.getWordCount() == null ? 0 : item.getWordCount());
                created.setPublishTime(parsedPublishTime == null ? LocalDateTime.now() : parsedPublishTime);
                articleRepository.save(created);
                newCount++;
            } else {
                existed.setTitle(item.getTitle());
                if (item.getContent() != null && !item.getContent().isBlank()) {
                    existed.setContent(item.getContent());
                }
                existed.setWordCount(item.getWordCount() == null ? existed.getWordCount() : item.getWordCount());
                if (parsedPublishTime != null) {
                    existed.setPublishTime(parsedPublishTime);
                }
                articleRepository.save(existed);
                updatedCount++;
            }
        }

        for (SyncArticlesDTO.SnapshotItem snapshotItem : dto.getSnapshots()) {
            ArticleEntity article = articleRepository.findByUserAndWxId(userId, snapshotItem.getWxArticleId());
            if (article == null) {
                snapshotMissedArticle++;
                continue;
            }
            ArticleSnapshotEntity snapshot = new ArticleSnapshotEntity();
            snapshot.setUserId(userId);
            snapshot.setArticleId(article.getId());
            snapshot.setWxArticleId(snapshotItem.getWxArticleId());
            snapshot.setReadCount(defaultInt(snapshotItem.getReadCount()));
            snapshot.setSendCount(defaultInt(snapshotItem.getSendCount()));
            snapshot.setShareCount(defaultInt(snapshotItem.getShareCount()));
            snapshot.setLikeCount(defaultInt(snapshotItem.getLikeCount()));
            snapshot.setWowCount(defaultInt(snapshotItem.getWowCount()));
            snapshot.setCommentCount(defaultInt(snapshotItem.getCommentCount()));
            snapshot.setSaveCount(defaultInt(snapshotItem.getSaveCount()));
            snapshot.setCompletionRate(normalizeCompletionRate(snapshotItem.getCompletionRate()));
            snapshot.setAvgReadTimeSec(defaultInt(snapshotItem.getAvgReadTimeSec()));
            snapshot.setNewFollowers(defaultInt(snapshotItem.getNewFollowers()));
            snapshot.setTrafficSourcesJson(jsonUtil.toJson(snapshotItem.getTrafficSources() == null ? Map.of() : snapshotItem.getTrafficSources()));
            snapshot.setSnapshotTime(LocalDateTime.now());
            snapshotRepository.save(snapshot);
            snapshotSaved++;

            int readCount = defaultInt(snapshotItem.getReadCount());
            int sendCount = defaultInt(snapshotItem.getSendCount());
            int shareCount = defaultInt(snapshotItem.getShareCount());
            int likeCount = defaultInt(snapshotItem.getLikeCount()) + defaultInt(snapshotItem.getWowCount());
            int followCount = defaultInt(snapshotItem.getNewFollowers());

            snapshotReadTotal += readCount;
            snapshotSendTotal += sendCount;
            snapshotShareTotal += shareCount;
            snapshotLikeTotal += likeCount;
            snapshotFollowTotal += followCount;

            if (readCount == 0 && sendCount == 0 && shareCount == 0 && likeCount == 0 && followCount == 0) {
                snapshotAllZero++;
            }
        }

        log.info(
            "[tfling] sync/articles done userId={}, newArticles={}, updatedArticles={}, snapshotSaved={}, snapshotMissedArticle={}, snapshotAllZero={}, skippedDeletedArticle={}, readTotal={}, sendTotal={}, shareTotal={}, likeTotal={}, followTotal={}",
            userId, newCount, updatedCount, snapshotSaved, snapshotMissedArticle, snapshotAllZero, skippedDeletedArticle, snapshotReadTotal, snapshotSendTotal, snapshotShareTotal, snapshotLikeTotal, snapshotFollowTotal
        );

        SyncResultVO vo = new SyncResultVO();
        vo.setNewArticles(newCount);
        vo.setUpdatedArticles(updatedCount);
        return vo;
    }

    @Override
    public PageResult<ArticleVO> pageArticles(ArticleListQuery query) {
        Long userId = AuthContext.requiredUserId();
        String range = query.getRange() == null ? "all" : query.getRange();
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
        String realRange = range == null || range.isBlank() ? "all" : range;

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
        metrics.setTotalSend(current.totalSend);
        metrics.setAvgRead(current.avgRead);
        metrics.setCompletionRate(current.completionRate);
        metrics.setTotalShare(current.totalShare);
        metrics.setTotalLike(current.totalLike);
        metrics.setTotalWow(current.totalWow);
        metrics.setTotalComment(current.totalComment);
        metrics.setNewFollowers(current.newFollowers);
        metrics.setAvgReadTimeSec(current.avgReadTimeSec);
        metrics.setFollowRate(current.followRate);
        metrics.setShareRate(current.shareRate);
        metrics.setLikeRate(current.likeRate);
        metrics.setWowRate(current.wowRate);
        metrics.setCommentRate(current.commentRate);
        vo.setMetrics(metrics);

        OverviewVO.Changes changes = new OverviewVO.Changes();
        changes.setTotalRead(pctChange(current.totalRead, previous.totalRead));
        changes.setTotalSend(pctChange(current.totalSend, previous.totalSend));
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
        String realRange = range == null || range.isBlank() ? "all" : range;
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
            vo.setSendCount(latest.getSendCount());
            vo.setShareCount(latest.getShareCount());
            vo.setLikeCount(latest.getLikeCount());
            vo.setWowCount(latest.getWowCount());
            vo.setCommentCount(latest.getCommentCount());
            vo.setSaveCount(latest.getSaveCount());
            vo.setNewFollowers(latest.getNewFollowers());
            vo.setAvgReadTimeSec(latest.getAvgReadTimeSec());
            vo.setCompletionRate(normalizeCompletionRate(latest.getCompletionRate()));
            vo.setTrafficSources(jsonUtil.toIntMap(latest.getTrafficSourcesJson()));
        }
        return vo;
    }

    private MetricsBundle calcMetrics(Long userId, LocalDateTime start, LocalDateTime end) {
        List<ArticleEntity> articles = articleRepository.listByUserAndRange(userId, start, end);
        int totalRead = 0;
        int totalSend = 0;
        int totalShare = 0;
        int totalLike = 0;
        int totalWow = 0;
        int totalComment = 0;
        int newFollowers = 0;
        int avgReadTimeSecSum = 0;
        int avgReadTimeSampleCount = 0;
        BigDecimal completionSum = BigDecimal.ZERO;
        int completionCount = 0;
        Map<String, Integer> trafficCount = new HashMap<>();

        for (ArticleEntity article : articles) {
            ArticleSnapshotEntity latest = snapshotRepository.latestByArticle(article.getId());
            if (latest == null) {
                continue;
            }
            totalRead += defaultInt(latest.getReadCount());
            totalSend += defaultInt(latest.getSendCount());
            totalShare += defaultInt(latest.getShareCount());
            totalLike += defaultInt(latest.getLikeCount());
            totalWow += defaultInt(latest.getWowCount());
            totalComment += defaultInt(latest.getCommentCount());
            newFollowers += defaultInt(latest.getNewFollowers());
            int avgReadTimeSec = defaultInt(latest.getAvgReadTimeSec());
            if (avgReadTimeSec > 0) {
                avgReadTimeSecSum += avgReadTimeSec;
                avgReadTimeSampleCount++;
            }

            BigDecimal completionRate = normalizeCompletionRate(latest.getCompletionRate());
            if (completionRate != null) {
                completionSum = completionSum.add(completionRate);
                completionCount++;
            }

            Map<String, Integer> oneMap = jsonUtil.toIntMap(latest.getTrafficSourcesJson());
            oneMap.forEach((k, v) -> trafficCount.put(k, trafficCount.getOrDefault(k, 0) + defaultInt(v)));
        }

        int articleCount = articles.size();
        int avgRead = articleCount == 0 ? 0 : totalRead / articleCount;
        int avgReadTimeSec = avgReadTimeSampleCount == 0 ? 0 : Math.round((float) avgReadTimeSecSum / avgReadTimeSampleCount);
        double completionRate = completionCount == 0 ? 0 : completionSum.divide(BigDecimal.valueOf(completionCount), 2, RoundingMode.HALF_UP).doubleValue();
        double followRate = pctValue(newFollowers, totalRead);
        double shareRate = pctValue(totalShare, totalRead);
        double likeRate = pctValue(totalLike, totalRead);
        double wowRate = pctValue(totalWow, totalRead);
        double commentRate = pctValue(totalComment, totalRead);

        int trafficTotal = trafficCount.values().stream().mapToInt(Integer::intValue).sum();
        Map<String, Integer> trafficPercent = new HashMap<>();
        if (trafficTotal > 0) {
            trafficCount.forEach((k, v) -> trafficPercent.put(k, (int) Math.round(v * 100.0 / trafficTotal)));
        }

        return new MetricsBundle(
            articleCount,
            totalRead,
            totalSend,
            avgRead,
            completionRate,
            totalShare,
            totalLike,
            totalWow,
            totalComment,
            newFollowers,
            avgReadTimeSec,
            followRate,
            shareRate,
            likeRate,
            wowRate,
            commentRate,
            trafficPercent
        );
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

    private double pctValue(double numerator, double denominator) {
        if (denominator <= 0) {
            return 0D;
        }
        return BigDecimal.valueOf(numerator * 100 / denominator)
            .setScale(2, RoundingMode.HALF_UP)
            .doubleValue();
    }

    private BigDecimal normalizeCompletionRate(Double raw) {
        if (raw == null) {
            return BigDecimal.ZERO;
        }
        return normalizeCompletionRate(BigDecimal.valueOf(raw));
    }

    private BigDecimal normalizeCompletionRate(BigDecimal raw) {
        if (raw == null) {
            return null;
        }
        double value = raw.doubleValue();
        if (!Double.isFinite(value) || value <= 0) {
            return BigDecimal.ZERO;
        }
        double normalized = value <= 1 ? value * 100 : value;
        if (normalized > 100) {
            normalized = 100;
        }
        return BigDecimal.valueOf(normalized).setScale(2, RoundingMode.HALF_UP);
    }

    private LocalDateTime parseDateTime(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String trimmed = text.trim();
        try {
            return OffsetDateTime.parse(trimmed).toLocalDateTime();
        } catch (Exception ignore) {
        }
        try {
            return Instant.parse(trimmed).atZone(ZoneId.systemDefault()).toLocalDateTime();
        } catch (Exception ignore) {
        }
        try {
            return LocalDateTime.parse(trimmed);
        } catch (Exception ignore) {
        }
        if (trimmed.matches("^\\d{10}$")) {
            long seconds = Long.parseLong(trimmed);
            return Instant.ofEpochSecond(seconds).atZone(ZoneId.systemDefault()).toLocalDateTime();
        }
        if (trimmed.matches("^\\d{13}$")) {
            long millis = Long.parseLong(trimmed);
            return Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDateTime();
        }
        for (DateTimeFormatter formatter : LOCAL_DATE_TIME_FORMATTERS) {
            try {
                return LocalDateTime.parse(trimmed, formatter);
            } catch (DateTimeParseException ignore) {
            }
        }
        for (DateTimeFormatter formatter : LOCAL_DATE_FORMATTERS) {
            try {
                return LocalDate.parse(trimmed, formatter).atStartOfDay();
            } catch (DateTimeParseException ignore) {
            }
        }
        return null;
    }

    private boolean shouldSkipArticle(String title) {
        if (title == null) {
            return true;
        }
        String normalized = title.trim();
        if (normalized.isEmpty()) {
            return true;
        }
        return normalized.startsWith("已删除")
            || normalized.startsWith("内容已删除")
            || normalized.startsWith("该内容已被发布者删除")
            || normalized.startsWith("已下架")
            || normalized.startsWith("已失效")
            || normalized.contains("[已删除]")
            || normalized.contains("(已删除)")
            || normalized.contains("（已删除）");
    }

    private record MetricsBundle(
        int articleCount,
        int totalRead,
        int totalSend,
        int avgRead,
        double completionRate,
        int totalShare,
        int totalLike,
        int totalWow,
        int totalComment,
        int newFollowers,
        int avgReadTimeSec,
        double followRate,
        double shareRate,
        double likeRate,
        double wowRate,
        double commentRate,
        Map<String, Integer> trafficPercent
    ) {}
}
