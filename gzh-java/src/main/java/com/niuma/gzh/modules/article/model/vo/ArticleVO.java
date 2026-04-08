package com.niuma.gzh.modules.article.model.vo;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;
import lombok.Data;

@Data
public class ArticleVO {
    private Long id;
    private String wxArticleId;
    private String title;
    private String content;
    private Integer wordCount;
    private LocalDateTime publishTime;
    private Integer readCount;
    private Integer sendCount;
    private Integer shareCount;
    private Integer likeCount;
    private Integer wowCount;
    private Integer commentCount;
    private Integer saveCount;
    private Integer avgReadTimeSec;
    private Integer newFollowers;
    private BigDecimal completionRate;
    private Map<String, Integer> trafficSources;
    private Map<String, Double> trafficSourceRates;
}
