package com.niuma.gzh.modules.auth.model.vo;

import lombok.Data;

@Data
public class LoginVO {
    private String token;
    private UserInfoVO user;

    @Data
    public static class UserInfoVO {
        private Long id;
        private String phone;
        private String displayName;
        private String mpAccountName;
        private String avatarUrl;
        private Integer balance;
        private Integer freeQuota;
        private String aiModel;
    }
}
