package com.niuma.gzh.modules.chat.model.vo;

import java.time.LocalDateTime;
import lombok.Data;

@Data
public class ChatMessageVO {
    private Long id;
    private String sessionId;
    private Long reportId;
    private String role;
    private String content;
    private String aiModel;
    private Integer inputTokens;
    private Integer outputTokens;
    private Integer costCent;
    private LocalDateTime createdAt;
}
