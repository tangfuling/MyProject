package com.niuma.gzh.modules.analysis.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.analysis.mapper.AnalysisReportMapper;
import com.niuma.gzh.modules.analysis.model.entity.AnalysisReportEntity;
import org.springframework.stereotype.Repository;

@Repository
public class AnalysisReportRepository extends BaseRepository {
    private final AnalysisReportMapper analysisReportMapper;

    public AnalysisReportRepository(AnalysisReportMapper analysisReportMapper) {
        this.analysisReportMapper = analysisReportMapper;
    }

    public void save(AnalysisReportEntity entity) {
        if (entity.getId() == null) {
            analysisReportMapper.insert(entity);
        } else {
            analysisReportMapper.updateById(entity);
        }
    }

    public AnalysisReportEntity findById(Long id) {
        return analysisReportMapper.selectById(id);
    }

    public Page<AnalysisReportEntity> pageByUser(Long userId, long pageNo, long pageSize) {
        return analysisReportMapper.selectPage(new Page<>(pageNo, pageSize),
            new LambdaQueryWrapper<AnalysisReportEntity>()
                .eq(AnalysisReportEntity::getUserId, userId)
                .orderByDesc(AnalysisReportEntity::getCreatedAt));
    }

    public AnalysisReportEntity latestByUser(Long userId) {
        return analysisReportMapper.selectOne(new LambdaQueryWrapper<AnalysisReportEntity>()
            .eq(AnalysisReportEntity::getUserId, userId)
            .orderByDesc(AnalysisReportEntity::getCreatedAt)
            .last("limit 1"));
    }
}
