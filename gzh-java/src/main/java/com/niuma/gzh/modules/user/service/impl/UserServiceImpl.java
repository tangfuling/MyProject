package com.niuma.gzh.modules.user.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.ai.AiModelProvider;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import com.niuma.gzh.modules.article.repository.ArticleRepository;
import com.niuma.gzh.modules.user.model.entity.TokenLogEntity;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.model.vo.TokenLogVO;
import com.niuma.gzh.modules.user.model.vo.UserProfileVO;
import com.niuma.gzh.modules.user.repository.TokenLogRepository;
import com.niuma.gzh.modules.user.repository.UserRepository;
import com.niuma.gzh.modules.user.service.UserService;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserServiceImpl extends BaseService implements UserService {
    private final UserRepository userRepository;
    private final TokenLogRepository tokenLogRepository;
    private final ArticleRepository articleRepository;

    public UserServiceImpl(UserRepository userRepository,
                           TokenLogRepository tokenLogRepository,
                           ArticleRepository articleRepository) {
        this.userRepository = userRepository;
        this.tokenLogRepository = tokenLogRepository;
        this.articleRepository = articleRepository;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public UserEntity findOrCreateByPhone(String phone) {
        UserEntity existed = userRepository.findByPhone(phone);
        if (existed != null) {
            return existed;
        }
        UserEntity created = new UserEntity();
        created.setPhone(phone);
        created.setAiModel("qwen");
        created.setBalanceCent(0);
        created.setFreeQuotaCent(100);
        userRepository.save(created);
        return created;
    }

    @Override
    public UserEntity getById(Long userId) {
        UserEntity entity = userRepository.findById(userId);
        if (entity == null) {
            throw new BizException(ErrorCode.NOT_FOUND.getCode(), "用户不存在");
        }
        return entity;
    }

    @Override
    public UserProfileVO profile() {
        Long userId = AuthContext.requiredUserId();
        UserEntity user = getById(userId);
        UserProfileVO vo = new UserProfileVO();
        vo.setId(user.getId());
        vo.setPhone(user.getPhone());
        vo.setAiModel(user.getAiModel());
        vo.setBalanceCent(user.getBalanceCent());
        vo.setFreeQuotaCent(user.getFreeQuotaCent());
        vo.setArticleCount(articleRepository.countByUser(userId));
        return vo;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateAiModel(String model) {
        Long userId = AuthContext.requiredUserId();
        UserEntity user = getById(userId);
        user.setAiModel(AiModelProvider.fromCode(model).getCode());
        userRepository.save(user);
    }

    @Override
    public PageResult<TokenLogVO> tokenLogs(long page, long size) {
        Long userId = AuthContext.requiredUserId();
        Page<TokenLogEntity> result = tokenLogRepository.pageByUser(userId, page, size);
        List<TokenLogVO> items = result.getRecords().stream().map(record -> {
            TokenLogVO vo = new TokenLogVO();
            vo.setId(record.getId());
            vo.setBizType(record.getBizType());
            vo.setBizId(record.getBizId());
            vo.setAiModel(record.getAiModel());
            vo.setInputTokens(record.getInputTokens());
            vo.setOutputTokens(record.getOutputTokens());
            vo.setCostCent(record.getCostCent());
            vo.setCreatedAt(record.getCreatedAt());
            return vo;
        }).toList();
        return new PageResult<>(page, size, result.getTotal(), items);
    }

    @Override
    public void logTokenCost(Long userId, String bizType, String bizId, String aiModel, int inputTokens, int outputTokens, int costCent) {
        TokenLogEntity log = new TokenLogEntity();
        log.setUserId(userId);
        log.setBizType(bizType);
        log.setBizId(bizId);
        log.setAiModel(aiModel);
        log.setInputTokens(inputTokens);
        log.setOutputTokens(outputTokens);
        log.setCostCent(costCent);
        tokenLogRepository.save(log);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deductCost(Long userId, int costCent) {
        if (costCent <= 0) {
            return;
        }
        UserEntity user = getById(userId);
        int freeQuota = user.getFreeQuotaCent() == null ? 0 : user.getFreeQuotaCent();
        int balance = user.getBalanceCent() == null ? 0 : user.getBalanceCent();
        int available = freeQuota + balance;
        if (available < costCent) {
            throw new BizException(ErrorCode.BALANCE_NOT_ENOUGH);
        }

        int usedFree = Math.min(freeQuota, costCent);
        int usedBalance = costCent - usedFree;
        user.setFreeQuotaCent(freeQuota - usedFree);
        user.setBalanceCent(balance - usedBalance);
        userRepository.save(user);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void recharge(Long userId, int amountCent) {
        UserEntity user = getById(userId);
        user.setBalanceCent((user.getBalanceCent() == null ? 0 : user.getBalanceCent()) + amountCent);
        userRepository.save(user);
    }
}
