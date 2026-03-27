package com.niuma.gzh.modules.user.service;

import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.model.vo.TokenLogVO;
import com.niuma.gzh.modules.user.model.vo.UserProfileVO;

public interface UserService {
    UserEntity findOrCreateByPhone(String phone);

    UserEntity getById(Long userId);

    UserProfileVO profile();

    void updateAiModel(String model);

    PageResult<TokenLogVO> tokenLogs(long page, long size);

    void logTokenCost(Long userId, String bizType, String bizId, String aiModel, int inputTokens, int outputTokens, int costCent);

    void deductCost(Long userId, int costCent);

    void recharge(Long userId, int amountCent);
}
