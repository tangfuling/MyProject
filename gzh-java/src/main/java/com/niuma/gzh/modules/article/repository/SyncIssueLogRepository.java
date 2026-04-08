package com.niuma.gzh.modules.article.repository;

import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.article.mapper.SyncIssueLogMapper;
import com.niuma.gzh.modules.article.model.entity.SyncIssueLogEntity;
import org.springframework.stereotype.Repository;

@Repository
public class SyncIssueLogRepository extends BaseRepository {
    private final SyncIssueLogMapper syncIssueLogMapper;

    public SyncIssueLogRepository(SyncIssueLogMapper syncIssueLogMapper) {
        this.syncIssueLogMapper = syncIssueLogMapper;
    }

    public void save(SyncIssueLogEntity entity) {
        syncIssueLogMapper.insert(entity);
    }
}
