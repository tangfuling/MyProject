package com.niuma.gzh.common.security;

import org.springframework.stereotype.Component;

@Component
public class PermissionChecker {
    public boolean hasPermission(String permission) {
        return AuthContext.currentUserId() != null;
    }
}
