package com.niuma.demo.modules.order.model.query;

public class OrderQuery {
    private long current = 1;
    private long size = 20;

    public long getCurrent() {
        return current;
    }

    public void setCurrent(long current) {
        this.current = current;
    }

    public long getSize() {
        return size;
    }

    public void setSize(long size) {
        this.size = size;
    }
}
