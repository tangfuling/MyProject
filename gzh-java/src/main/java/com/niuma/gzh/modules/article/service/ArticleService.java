package com.niuma.gzh.modules.article.service;

import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.modules.article.model.dto.SyncArticlesDTO;
import com.niuma.gzh.modules.article.model.query.ArticleListQuery;
import com.niuma.gzh.modules.article.model.vo.ArticleVO;
import com.niuma.gzh.modules.article.model.vo.OverviewVO;
import com.niuma.gzh.modules.article.model.vo.SyncResultVO;
import java.util.List;

public interface ArticleService {
    SyncResultVO syncArticles(SyncArticlesDTO dto);

    PageResult<ArticleVO> pageArticles(ArticleListQuery query);

    OverviewVO overview(String range);

    List<ArticleVO> listRangeArticles(String range, int limit);
}
