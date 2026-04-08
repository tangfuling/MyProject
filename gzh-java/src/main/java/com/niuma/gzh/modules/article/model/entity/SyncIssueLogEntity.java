package com.niuma.gzh.modules.article.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("gzh_sync_issue_log")
public class SyncIssueLogEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String syncSessionId;
    private String issueType;
    private String stage;
    private String wxArticleId;
    private String issueCode;
    private String issueMessage;
    private String detailsJson;
    private LocalDateTime eventTime;
    private LocalDateTime createdAt;
    @TableLogic
    @TableField("deleted")
    private Integer deleted;
}
