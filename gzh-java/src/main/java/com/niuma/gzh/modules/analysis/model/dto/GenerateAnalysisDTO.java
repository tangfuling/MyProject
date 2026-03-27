package com.niuma.gzh.modules.analysis.model.dto;

import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class GenerateAnalysisDTO {
    @Pattern(regexp = "^(7d|30d|90d|all)$", message = "range 仅支持 7d/30d/90d/all")
    private String range = "30d";
}
