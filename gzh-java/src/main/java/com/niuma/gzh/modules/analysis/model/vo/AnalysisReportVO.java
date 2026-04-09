package com.niuma.gzh.modules.analysis.model.vo;

import java.time.LocalDateTime;
import java.util.List;
import lombok.Data;

@Data
public class AnalysisReportVO {
    private Long id;
    private String rangeCode;
    private Integer articleCount;
    private Integer inputTokens;
    private Integer outputTokens;
    private Integer costCent;
    private String aiModel;
    private String content;
    private String stage;
    private List<String> findings;
    private List<String> actionSuggestions;
    private String rhythm;
    private String riskHint;
    private List<String> suggestedQuestions;
    private LocalDateTime createdAt;
}
