package com.niuma.gzh.modules.chat.model.dto;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import lombok.Data;

@Data
public class ChatSendDTO {
    private String sessionId;
    private Long reportId;

    @NotBlank(message = "消息不能为空")
    private String message;

    @Pattern(regexp = "^(7d|30d|60d|90d|all)?$", message = "range 仅支持 7d/30d/60d/90d/all")
    private String range = "30d";
}
