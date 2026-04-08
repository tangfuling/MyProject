package com.niuma.gzh.modules.user.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Data;

@Data
@TableName("gzh_user")
public class UserEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String phone;
    private String displayName;
    private String mpAccountName;
    private String avatarUrl;
    private String aiModel;
    private Integer balanceCent;
    private Integer freeQuotaCent;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    @TableLogic
    @TableField("deleted")
    private Integer deleted;
}
