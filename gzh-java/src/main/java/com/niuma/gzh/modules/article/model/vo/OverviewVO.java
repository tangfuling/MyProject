package com.niuma.gzh.modules.article.model.vo;

import java.util.Map;
import lombok.Data;

@Data
public class OverviewVO {
    private String range;
    private Integer articleCount;
    private Metrics metrics;
    private Changes changes;
    private Map<String, Integer> trafficSummary;

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
}
