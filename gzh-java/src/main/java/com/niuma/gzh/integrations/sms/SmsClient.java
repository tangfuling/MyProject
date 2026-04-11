package com.niuma.gzh.integrations.sms;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class SmsClient {
    private static final int TIMEOUT_MS = 10_000;

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
        this.objectMapper = objectMapper;
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.signName = signName;
        this.templateCode = templateCode;
    }

    public void sendCode(String phone, String code) {
        if (isBlank(endpoint) || endpoint.contains("sms.example.com")) {
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "短信服务未配置，请设置 SMS_ENDPOINT");
        }
        try {
            Map<String, Object> payloadMap = new LinkedHashMap<String, Object>();
            payloadMap.put("phone", phone);
            payloadMap.put("code", code);
            payloadMap.put("signName", signName);
            payloadMap.put("templateCode", templateCode);
            String payload = objectMapper.writeValueAsString(payloadMap);

            Map<String, String> headers = new LinkedHashMap<String, String>();
            headers.put("X-API-KEY", apiKey == null ? "" : apiKey);
            headers.put("X-API-SECRET", apiSecret == null ? "" : apiSecret);
            HttpResult response = postJson(endpoint, payload, headers);
            if (response.statusCode < 200 || response.statusCode >= 300) {
                throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "短信发送失败: " + response.body);
            }
        } catch (BizException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "短信发送失败: " + ex.getMessage());
        }
    }

    private HttpResult postJson(String url, String payload, Map<String, String> headers) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            if (headers != null) {
                for (Map.Entry<String, String> header : headers.entrySet()) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
            }

            byte[] bytes = payload == null ? new byte[0] : payload.getBytes(StandardCharsets.UTF_8);
            connection.setRequestProperty("Content-Length", String.valueOf(bytes.length));
            OutputStream outputStream = connection.getOutputStream();
            try {
                outputStream.write(bytes);
                outputStream.flush();
            } finally {
                outputStream.close();
            }

            int statusCode = connection.getResponseCode();
            String body = readResponseBody(connection, statusCode);
            return new HttpResult(statusCode, body);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String readResponseBody(HttpURLConnection connection, int statusCode) throws Exception {
        InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (stream == null) {
            return "";
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try {
            byte[] buffer = new byte[1024];
            int read;
            while ((read = stream.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } finally {
            stream.close();
        }
    }

    private boolean isBlank(String text) {
        return text == null || text.trim().isEmpty();
    }

    private static final class HttpResult {
        private final int statusCode;
        private final String body;

        private HttpResult(int statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }
    }
}
