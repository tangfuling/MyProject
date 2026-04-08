package com.niuma.gzh.common.web;

import com.niuma.gzh.common.security.TokenAuthInterceptor;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    private final TokenAuthInterceptor tokenAuthInterceptor;
    private final String allowedOrigins;
    private final String avatarUrlPrefix;
    private final Path avatarUploadDir;

    public WebMvcConfig(TokenAuthInterceptor tokenAuthInterceptor,
                        @Value("${app.cors.allowed-origins:*}") String allowedOrigins,
                        @Value("${app.upload.avatar-url-prefix:/uploads/avatars}") String avatarUrlPrefix,
                        @Value("${app.upload.avatar-dir:./storage/avatars}") String avatarUploadDir) {
        this.tokenAuthInterceptor = tokenAuthInterceptor;
        this.allowedOrigins = allowedOrigins;
        this.avatarUrlPrefix = normalizeAvatarUrlPrefix(avatarUrlPrefix);
        this.avatarUploadDir = Paths.get(avatarUploadDir).toAbsolutePath().normalize();
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tokenAuthInterceptor).addPathPatterns("/**");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String[] origins = Arrays.stream(allowedOrigins.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .toArray(String[]::new);

        registry.addMapping("/**")
            .allowedOriginPatterns(origins.length == 0 ? new String[]{"*"} : origins)
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("*")
            .allowCredentials(true)
            .maxAge(3600);
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String location = avatarUploadDir.toUri().toString();
        if (!location.endsWith("/")) {
            location += "/";
        }
        registry.addResourceHandler(avatarUrlPrefix + "/**")
            .addResourceLocations(location);
    }

    private String normalizeAvatarUrlPrefix(String rawPrefix) {
        String prefix = rawPrefix == null ? "" : rawPrefix.trim();
        if (prefix.isEmpty()) {
            prefix = "/uploads/avatars";
        }
        if (!prefix.startsWith("/")) {
            prefix = "/" + prefix;
        }
        while (prefix.endsWith("/")) {
            prefix = prefix.substring(0, prefix.length() - 1);
        }
        return prefix;
    }
}
