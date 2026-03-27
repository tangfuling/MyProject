package com.niuma.gzh.modules.user.model.vo;

import lombok.Data;

@Data
public class UserProfileVO {
    private Long id;
    private String phone;
    private Integer balanceCent;
    private Integer freeQuotaCent;
    private String aiModel;
    private Integer articleCount;
}
