package com.niuma.gzh.common.ai.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.niuma.gzh.common.ai.AiClient;
import com.niuma.gzh.common.ai.AiGenerateRequest;
import com.niuma.gzh.common.ai.AiGenerateResult;
import com.niuma.gzh.common.ai.AiMessage;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public abstract class BaseHttpAiClient implements AiClient {

    protected final HttpClient httpClient;
    protected final ObjectMapper objectMapper;
    protected final int timeoutMs;

    protected BaseHttpAiClient(ObjectMapper objectMapper, int timeoutMs) {
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        this.objectMapper = objectMapper;
        this.timeoutMs = timeoutMs;
    }

    protected AiGenerateResult callOpenAiCompatible(String endpoint, String apiKey, String model, AiGenerateRequest request,
                                                     Map<String, String> extraHeaders) {
        try {
            List<Map<String, Object>> messages = new ArrayList<>();
            if (request.systemPrompt() != null && !request.systemPrompt().isBlank()) {
                messages.add(Map.of("role", "system", "content", request.systemPrompt()));
            }
            if (request.history() != null) {
                for (AiMessage item : request.history()) {
                    messages.add(Map.of("role", item.role(), "content", item.content()));
                }
            }
            messages.add(Map.of("role", "user", "content", request.userPrompt()));

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", model);
            body.put("messages", messages);
            body.put("temperature", 0.7);

            String payload = objectMapper.writeValueAsString(body);
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .timeout(Duration.ofMillis(timeoutMs))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(payload));
            for (Map.Entry<String, String> header : extraHeaders.entrySet()) {
                builder.header(header.getKey(), header.getValue());
            }
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "模型调用失败: " + response.body());
            }

            JsonNode json = objectMapper.readTree(response.body());
            String content = json.path("choices").path(0).path("message").path("content").asText("");
            int inputTokens = json.path("usage").path("prompt_tokens").asInt(estimateTokens(request.userPrompt()));
            int outputTokens = json.path("usage").path("completion_tokens").asInt(estimateTokens(content));
            return new AiGenerateResult(content, inputTokens, outputTokens);
        } catch (IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "模型调用失败: " + e.getMessage());
        }
    }

    protected AiGenerateResult callClaude(String endpoint, String apiKey, String model, AiGenerateRequest request) {
        try {
            List<Map<String, Object>> messages = new ArrayList<>();
            if (request.history() != null) {
                for (AiMessage item : request.history()) {
                    messages.add(Map.of("role", item.role(), "content", item.content()));
                }
            }
            messages.add(Map.of("role", "user", "content", request.userPrompt()));

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", model);
            body.put("system", request.systemPrompt());
            body.put("messages", messages);
            body.put("max_tokens", 2048);

            String payload = objectMapper.writeValueAsString(body);
            HttpRequest requestObj = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .timeout(Duration.ofMillis(timeoutMs))
                .header("Content-Type", "application/json")
                .header("x-api-key", apiKey)
                .header("anthropic-version", "2023-06-01")
                .POST(HttpRequest.BodyPublishers.ofString(payload))
                .build();
            HttpResponse<String> response = httpClient.send(requestObj, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "Claude 调用失败: " + response.body());
            }

            JsonNode json = objectMapper.readTree(response.body());
            String content = json.path("content").path(0).path("text").asText("");
            int inputTokens = json.path("usage").path("input_tokens").asInt(estimateTokens(request.userPrompt()));
            int outputTokens = json.path("usage").path("output_tokens").asInt(estimateTokens(content));
            return new AiGenerateResult(content, inputTokens, outputTokens);
        } catch (IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "Claude 调用失败: " + e.getMessage());
        }
    }

    protected int estimateTokens(String text) {
        if (text == null || text.isBlank()) {
            return 0;
        }
        return Math.max(1, text.length() / 2);
    }
}
