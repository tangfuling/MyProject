package com.niuma.gzh.common.db;

public class PageQuery {
    private final long current;
    private final long size;

    public PageQuery(long current, long size) {
        this.current = current;
        this.size = size;
    }

    public long current() {
        return current;
    }

    public long size() {
        return size;
    }

    public long getCurrent() {
        return current;
    }

    public long getSize() {
        return size;
    }
}
