package com.niuma.gzh.modules.article.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.article.mapper.ArticleMapper;
import com.niuma.gzh.modules.article.model.entity.ArticleEntity;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Repository;

@Repository
public class ArticleRepository extends BaseRepository {
    private final ArticleMapper articleMapper;

    public ArticleRepository(ArticleMapper articleMapper) {
        this.articleMapper = articleMapper;
    }

    public ArticleEntity findByUserAndWxId(Long userId, String wxArticleId) {
        return articleMapper.selectOne(new LambdaQueryWrapper<ArticleEntity>()
            .eq(ArticleEntity::getUserId, userId)
            .eq(ArticleEntity::getWxArticleId, wxArticleId)
            .last("limit 1"));
    }

    public void save(ArticleEntity entity) {
        if (entity.getId() == null) {
            articleMapper.insert(entity);
        } else {
            articleMapper.updateById(entity);
        }
    }

    public Page<ArticleEntity> pageByUserAndRange(Long userId, LocalDateTime start, LocalDateTime end, long pageNo, long pageSize) {
        return articleMapper.selectPage(new Page<>(pageNo, pageSize),
            new LambdaQueryWrapper<ArticleEntity>()
                .eq(ArticleEntity::getUserId, userId)
                .between(start != null && end != null, ArticleEntity::getPublishTime, start, end)
                .orderByDesc(ArticleEntity::getPublishTime)
                .orderByDesc(ArticleEntity::getId));
    }

    public List<ArticleEntity> listByUserAndRange(Long userId, LocalDateTime start, LocalDateTime end) {
        return articleMapper.selectList(new LambdaQueryWrapper<ArticleEntity>()
            .eq(ArticleEntity::getUserId, userId)
            .between(start != null && end != null, ArticleEntity::getPublishTime, start, end)
            .orderByDesc(ArticleEntity::getPublishTime)
            .orderByDesc(ArticleEntity::getId));
    }

    public int countByUser(Long userId) {
        return Math.toIntExact(articleMapper.selectCount(new LambdaQueryWrapper<ArticleEntity>().eq(ArticleEntity::getUserId, userId)));
    }
}
