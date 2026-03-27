package com.niuma.gzh.modules.user.model.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class UpdateAiModelDTO {
    @NotBlank(message = "模型不能为空")
    private String model;
}
