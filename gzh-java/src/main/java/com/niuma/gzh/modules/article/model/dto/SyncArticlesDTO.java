package com.niuma.gzh.modules.article.model.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import lombok.Data;

@Data
public class SyncArticlesDTO {
    @Valid
    @NotNull
    private List<ArticleItem> articles = new ArrayList<>();

    @Valid
    @NotNull
    private List<SnapshotItem> snapshots = new ArrayList<>();

    @Data
    public static class ArticleItem {
        @NotNull
        private String wxArticleId;
        @NotNull
        private String title;
        private String content;
        private Integer wordCount;
        @NotNull
        private String publishTime;
    }

    @Data
    public static class SnapshotItem {
        @NotNull
        private String wxArticleId;
        private Integer readCount;
        private Integer sendCount;
        private Integer shareCount;
        private Integer likeCount;
        private Integer wowCount;
        private Integer commentCount;
        private Integer saveCount;
        private Double completionRate;
        private Integer avgReadTimeSec;
        private Map<String, Integer> trafficSources;
        private Integer newFollowers;
    }
}
