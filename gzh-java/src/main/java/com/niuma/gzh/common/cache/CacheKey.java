package com.niuma.gzh.common.cache;

public final class CacheKey {
    private CacheKey() {
    }

    public static String authCode(String phone) {
        return "auth:code:" + phone;
    }

    public static String authCodeCooldown(String phone) {
        return "auth:cooldown:" + phone;
    }

    public static String paymentIdempotent(String orderNo) {
        return "payment:idempotent:" + orderNo;
    }
}
