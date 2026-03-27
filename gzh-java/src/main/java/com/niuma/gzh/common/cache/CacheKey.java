package com.niuma.gzh.common.cache;

public final class CacheKey {
    private CacheKey() {
    }

    public static String orderDetail(Long orderId) {
        return "order:detail:" + orderId;
    }
}
