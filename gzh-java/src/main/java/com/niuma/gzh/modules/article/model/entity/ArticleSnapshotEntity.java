package com.niuma.gzh.modules.article.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("gzh_article_snapshot")
public class ArticleSnapshotEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private Long articleId;
    private String wxArticleId;
    private Integer readCount;
    private Integer sendCount;
    private Integer shareCount;
    private Integer likeCount;
    private Integer wowCount;
    private Integer commentCount;
    private Integer saveCount;
    private BigDecimal completionRate;
    private Integer avgReadTimeSec;
    private Integer newFollowers;
    private String trafficSourcesJson;
    private LocalDateTime snapshotTime;
    private LocalDateTime createdAt;
    @TableLogic
    @TableField("deleted")
    private Integer deleted;
}
