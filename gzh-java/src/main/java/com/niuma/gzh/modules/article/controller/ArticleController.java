package com.niuma.gzh.modules.article.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.modules.article.model.dto.SyncArticlesDTO;
import com.niuma.gzh.modules.article.model.query.ArticleListQuery;
import com.niuma.gzh.modules.article.model.vo.ArticleVO;
import com.niuma.gzh.modules.article.model.vo.OverviewVO;
import com.niuma.gzh.modules.article.model.vo.SyncResultVO;
import com.niuma.gzh.modules.article.service.ArticleService;
import javax.validation.Valid;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping
public class ArticleController extends BaseController {
    private final ArticleService articleService;

    public ArticleController(ArticleService articleService) {
        this.articleService = articleService;
    }

    @PostMapping("/sync/articles")
    public ApiResponse<SyncResultVO> sync(@RequestBody @Valid SyncArticlesDTO dto) {
        return ApiResponse.success(articleService.syncArticles(dto));
    }

    @GetMapping("/articles")
    public ApiResponse<PageResult<ArticleVO>> articles(@Valid ArticleListQuery query) {
        return ApiResponse.success(articleService.pageArticles(query));
    }

    @GetMapping("/articles/overview")
    public ApiResponse<OverviewVO> overview(@RequestParam(value = "range", required = false) String range) {
        return ApiResponse.success(articleService.overview(range));
    }
}
