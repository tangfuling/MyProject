package com.niuma.gzh.modules.analysis.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("gzh_analysis_report")
public class AnalysisReportEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String rangeCode;
    private Integer articleCount;
    private Integer inputTokens;
    private Integer outputTokens;
    private Integer costCent;
    private String aiModel;
    private String content;
    private String suggestedQuestionsJson;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @TableLogic
    @TableField("deleted")
    private Integer deleted;
}
