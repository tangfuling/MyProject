package com.niuma.gzh.modules.analysis.model.vo;

import lombok.Data;

@Data
public class AnalysisEstimateVO {
    private String range;
    private Integer articleCount;
    private Integer estimatedInputTokens;
    private Integer estimatedOutputTokens;
    private Integer estimatedCostCent;
    private String aiModel;
}
