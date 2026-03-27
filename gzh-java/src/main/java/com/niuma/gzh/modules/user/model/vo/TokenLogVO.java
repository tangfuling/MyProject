package com.niuma.gzh.modules.user.model.vo;

import java.time.LocalDateTime;
import lombok.Data;

@Data
public class TokenLogVO {
    private Long id;
    private String bizType;
    private String bizId;
    private String aiModel;
    private Integer inputTokens;
    private Integer outputTokens;
    private Integer costCent;
    private LocalDateTime createdAt;
}
