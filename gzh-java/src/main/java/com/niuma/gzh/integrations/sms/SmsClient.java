package com.niuma.gzh.integrations.sms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class SmsClient {
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final String endpoint;
    private final String apiKey;
    private final String apiSecret;
    private final String signName;
    private final String templateCode;

    public SmsClient(ObjectMapper objectMapper,
                     @Value("${app.sms.endpoint}") String endpoint,
                     @Value("${app.sms.api-key:}") String apiKey,
                     @Value("${app.sms.api-secret:}") String apiSecret,
                     @Value("${app.sms.sign-name}") String signName,
                     @Value("${app.sms.template-code}") String templateCode) {
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        this.objectMapper = objectMapper;
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.signName = signName;
        this.templateCode = templateCode;
    }

    public void sendCode(String phone, String code) {
        if (endpoint == null || endpoint.isBlank() || endpoint.contains("sms.example.com")) {
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "短信服务未配置，请设置 SMS_ENDPOINT");
        }
        try {
            String payload = objectMapper.writeValueAsString(Map.of(
                "phone", phone,
                "code", code,
                "signName", signName,
                "templateCode", templateCode
            ));
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .header("X-API-KEY", apiKey == null ? "" : apiKey)
                .header("X-API-SECRET", apiSecret == null ? "" : apiSecret)
                .POST(HttpRequest.BodyPublishers.ofString(payload))
                .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "短信发送失败: " + response.body());
            }
        } catch (BizException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "短信发送失败: " + ex.getMessage());
        }
    }
}
