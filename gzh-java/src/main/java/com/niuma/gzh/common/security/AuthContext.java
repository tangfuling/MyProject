package com.niuma.gzh.common.security;

import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;

public final class AuthContext {
    private static final ThreadLocal<Long> CURRENT_USER = new ThreadLocal<>();

    private AuthContext() {
    }

    public static void setUserId(Long userId) {
        CURRENT_USER.set(userId);
    }

    public static Long currentUserId() {
        return CURRENT_USER.get();
    }

    public static Long requiredUserId() {
        Long userId = CURRENT_USER.get();
        if (userId == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        return userId;
    }

    public static void clear() {
        CURRENT_USER.remove();
    }
}
