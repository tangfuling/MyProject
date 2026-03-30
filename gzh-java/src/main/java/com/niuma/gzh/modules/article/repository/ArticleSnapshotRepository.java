package com.niuma.gzh.modules.article.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.article.mapper.ArticleSnapshotMapper;
import com.niuma.gzh.modules.article.model.entity.ArticleSnapshotEntity;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

@Repository
public class ArticleSnapshotRepository extends BaseRepository {
    private final ArticleSnapshotMapper articleSnapshotMapper;

    public ArticleSnapshotRepository(ArticleSnapshotMapper articleSnapshotMapper) {
        this.articleSnapshotMapper = articleSnapshotMapper;
    }

    public void save(ArticleSnapshotEntity entity) {
        articleSnapshotMapper.insert(entity);
    }

    public ArticleSnapshotEntity latestByArticle(Long articleId) {
        return articleSnapshotMapper.selectOne(new LambdaQueryWrapper<ArticleSnapshotEntity>()
            .eq(ArticleSnapshotEntity::getArticleId, articleId)
            .orderByDesc(ArticleSnapshotEntity::getSnapshotTime)
            .last("limit 1"));
    }

    public ArticleSnapshotEntity latestByUser(Long userId) {
        return articleSnapshotMapper.selectOne(new LambdaQueryWrapper<ArticleSnapshotEntity>()
            .eq(ArticleSnapshotEntity::getUserId, userId)
            .orderByDesc(ArticleSnapshotEntity::getSnapshotTime)
            .last("limit 1"));
    }

    public Map<Long, ArticleSnapshotEntity> latestByArticleIds(List<Long> articleIds) {
        Map<Long, ArticleSnapshotEntity> map = new HashMap<>();
        for (Long articleId : articleIds) {
            ArticleSnapshotEntity latest = latestByArticle(articleId);
            if (latest != null) {
                map.put(articleId, latest);
            }
        }
        return map;
    }
}
