package com.niuma.gzh.modules.workspace.model.vo;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import lombok.Data;

@Data
public class WorkspaceOverviewVO {
    private String range;
    private Header header;
    private DataPanel dataPanel;
    private AnalysisPanel analysisPanel;
    private List<ArticleCard> articles;
    private List<String> quickQuestions;

    @Data
    public static class Header {
        private String accountName;
        private String phoneMasked;
        private String aiModel;
        private Integer balanceCent;
        private Integer freeQuotaCent;
        private Integer articleCount;
        private LocalDateTime lastSyncAt;
    }

    @Data
    public static class DataPanel {
        private Metrics metrics;
        private Changes changes;
        private Map<String, Integer> trafficSummary;
        private List<TrendPoint> trend;
    }

    @Data
    public static class Metrics {
        private Integer totalRead;
        private Integer avgRead;
        private Double completionRate;
        private Integer totalShare;
        private Integer totalLike;
        private Integer newFollowers;
    }

    @Data
    public static class Changes {
        private Double totalRead;
        private Double avgRead;
        private Double completionRate;
        private Double totalShare;
        private Double totalLike;
        private Double newFollowers;
    }

    @Data
    public static class TrendPoint {
        private String label;
        private Integer readCount;
    }

    @Data
    public static class AnalysisPanel {
        private Long reportId;
        private String rangeCode;
        private LocalDateTime createdAt;
        private String aiModel;
        private Integer inputTokens;
        private Integer outputTokens;
        private Integer costCent;
        private String summary;
        private List<String> actionSuggestions;
        private List<String> suggestedQuestions;
        private String content;
    }

    @Data
    public static class ArticleCard {
        private Long id;
        private String wxArticleId;
        private String title;
        private LocalDateTime publishTime;
        private Integer readCount;
        private Integer sendCount;
        private Integer shareCount;
        private Integer likeCount;
        private Integer wowCount;
        private Integer commentCount;
        private Integer saveCount;
        private Integer newFollowers;
        private BigDecimal completionRate;
        private Map<String, Integer> trafficSources;
    }
}
