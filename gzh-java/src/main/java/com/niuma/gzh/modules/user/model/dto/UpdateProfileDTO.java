package com.niuma.gzh.modules.user.model.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class UpdateProfileDTO {
    @Size(max = 64, message = "displayName max length is 64")
    private String displayName;

    @Size(max = 512, message = "avatarUrl max length is 512")
    private String avatarUrl;
}
