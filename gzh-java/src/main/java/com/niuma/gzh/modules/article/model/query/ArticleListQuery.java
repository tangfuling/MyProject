package com.niuma.gzh.modules.article.model.query;

import javax.validation.constraints.Pattern;
import lombok.Data;

@Data
public class ArticleListQuery {
    @Pattern(regexp = "^(7d|30d|60d|90d|all)$", message = "range 仅支持 7d/30d/60d/90d/all")
    private String range = "30d";

    private Long page = 1L;
    private Long size = 20L;
}
