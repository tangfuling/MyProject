package com.niuma.gzh.modules.user.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.user.mapper.TokenLogMapper;
import com.niuma.gzh.modules.user.model.entity.TokenLogEntity;
import java.util.List;
import org.springframework.stereotype.Repository;

@Repository
public class TokenLogRepository extends BaseRepository {
    private final TokenLogMapper tokenLogMapper;

    public TokenLogRepository(TokenLogMapper tokenLogMapper) {
        this.tokenLogMapper = tokenLogMapper;
    }

    public void save(TokenLogEntity entity) {
        tokenLogMapper.insert(entity);
    }

    public Page<TokenLogEntity> pageByUser(Long userId, long pageNo, long pageSize) {
        return tokenLogMapper.selectPage(new Page<>(pageNo, pageSize),
            new LambdaQueryWrapper<TokenLogEntity>()
                .eq(TokenLogEntity::getUserId, userId)
                .orderByDesc(TokenLogEntity::getCreatedAt));
    }

    public List<TokenLogEntity> listRecentByUser(Long userId, int limit) {
        return tokenLogMapper.selectList(new LambdaQueryWrapper<TokenLogEntity>()
            .eq(TokenLogEntity::getUserId, userId)
            .orderByDesc(TokenLogEntity::getCreatedAt)
            .last("limit " + limit));
    }
}
