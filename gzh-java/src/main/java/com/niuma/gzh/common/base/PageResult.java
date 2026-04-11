package com.niuma.gzh.common.base;

import java.util.List;

public class PageResult<T> {
    private final long page;
    private final long size;
    private final long total;
    private final List<T> records;

    public PageResult(long page, long size, long total, List<T> records) {
        this.page = page;
        this.size = size;
        this.total = total;
        this.records = records;
    }

    public long page() {
        return page;
    }

    public long size() {
        return size;
    }

    public long total() {
        return total;
    }

    public List<T> records() {
        return records;
    }

    public long getPage() {
        return page;
    }

    public long getSize() {
        return size;
    }

    public long getTotal() {
        return total;
    }

    public List<T> getRecords() {
        return records;
    }
}
