package com.niuma.gzh.modules.user.model.vo;

import java.time.LocalDateTime;
import lombok.Data;

@Data
public class UserProfileVO {
    private Long id;
    private String phone;
    private String displayName;
    private String mpAccountName;
    private String avatarUrl;
    private Integer balanceCent;
    private Integer freeQuotaCent;
    private String aiModel;
    private Integer articleCount;
    private LocalDateTime lastSyncAt;
    private LocalDateTime createdAt;
}
