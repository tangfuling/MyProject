package com.niuma.gzh.common.security;

import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class TokenAuthInterceptor implements HandlerInterceptor {

    private static final List<String> OPEN_PATH_PREFIX = com.niuma.gzh.common.util.J8.listOf(
        "/auth/",
        "/payment/notify",
        "/uploads/",
        "/actuator/",
        "/swagger-ui",
        "/v3/api-docs",
        "/error"
    );

    private final JwtService jwtService;

    public TokenAuthInterceptor(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod()) || isPublicPath(request.getRequestURI())) {
            return true;
        }
        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        String token = authHeader.substring("Bearer ".length()).trim();
        if (token.trim().isEmpty()) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        try {
            Long userId = jwtService.parseUserId(token);
            AuthContext.setUserId(userId);
            return true;
        } catch (JwtException | IllegalArgumentException ex) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        AuthContext.clear();
    }

    private boolean isPublicPath(String path) {
        return OPEN_PATH_PREFIX.stream().anyMatch(path::startsWith);
    }
}
