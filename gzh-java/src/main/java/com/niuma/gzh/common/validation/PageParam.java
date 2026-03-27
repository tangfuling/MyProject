package com.niuma.gzh.common.validation;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

public class PageParam {
    @Min(value = 1, message = "page 最小为 1")
    private Long page = 1L;

    @Min(value = 1, message = "size 最小为 1")
    @Max(value = 100, message = "size 最大为 100")
    private Long size = 20L;

    public long page() {
        return page == null ? 1L : page;
    }

    public long size() {
        return size == null ? 20L : size;
    }

    public Long getPage() {
        return page;
    }

    public void setPage(Long page) {
        this.page = page;
    }

    public Long getSize() {
        return size;
    }

    public void setSize(Long size) {
        this.size = size;
    }
}
