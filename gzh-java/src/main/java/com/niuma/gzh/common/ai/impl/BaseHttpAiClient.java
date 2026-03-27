package com.niuma.gzh.common.ai.impl;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.niuma.gzh.common.ai.AiClient;
import com.niuma.gzh.common.ai.AiGenerateRequest;
import com.niuma.gzh.common.ai.AiGenerateResult;
import com.niuma.gzh.common.ai.AiMessage;
import com.niuma.gzh.common.ai.AiToolCall;
import com.niuma.gzh.common.ai.AiToolDefinition;
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

    protected AiGenerateResult callOpenAiCompatible(String endpoint,
                                                     String apiKey,
                                                     String model,
                                                     AiGenerateRequest request,
                                                     Map<String, String> extraHeaders) {
        ensureApiKey(apiKey);
        try {
            List<Map<String, Object>> messages = buildOpenAiMessages(request);

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", model);
            body.put("messages", messages);
            body.put("temperature", 0.7);

            List<Map<String, Object>> tools = buildOpenAiTools(request.safeTools());
            if (!tools.isEmpty()) {
                body.put("tools", tools);
                body.put("tool_choice", "auto");
            }

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
            JsonNode messageNode = json.path("choices").path(0).path("message");
            String content = messageNode.path("content").isMissingNode() || messageNode.path("content").isNull()
                ? ""
                : messageNode.path("content").asText("");

            List<AiToolCall> toolCalls = new ArrayList<>();
            JsonNode toolCallsNode = messageNode.path("tool_calls");
            if (toolCallsNode.isArray()) {
                for (JsonNode call : toolCallsNode) {
                    JsonNode function = call.path("function");
                    String name = function.path("name").asText("");
                    String args = function.path("arguments").isMissingNode()
                        ? "{}"
                        : function.path("arguments").asText("{}");
                    if (!name.isBlank()) {
                        toolCalls.add(new AiToolCall(name, args));
                    }
                }
            }

            int inputTokens = json.path("usage").path("prompt_tokens").asInt(estimateTokens(request.userPrompt()));
            int outputTokens = json.path("usage").path("completion_tokens").asInt(estimateTokens(content));
            return new AiGenerateResult(content, inputTokens, outputTokens, toolCalls);
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "模型调用失败: " + e.getMessage());
        }
    }

    protected AiGenerateResult callClaude(String endpoint,
                                          String apiKey,
                                          String model,
                                          AiGenerateRequest request) {
        ensureApiKey(apiKey);
        try {
            List<Map<String, Object>> messages = buildClaudeMessages(request);

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", model);
            body.put("system", request.systemPrompt());
            body.put("messages", messages);
            body.put("max_tokens", 2048);

            List<Map<String, Object>> tools = buildClaudeTools(request.safeTools());
            if (!tools.isEmpty()) {
                body.put("tools", tools);
                body.put("tool_choice", Map.of("type", "auto"));
            }

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
            List<AiToolCall> toolCalls = new ArrayList<>();
            StringBuilder contentBuilder = new StringBuilder();
            JsonNode contentNodes = json.path("content");
            if (contentNodes.isArray()) {
                for (JsonNode item : contentNodes) {
                    String type = item.path("type").asText("");
                    if ("text".equals(type)) {
                        contentBuilder.append(item.path("text").asText(""));
                    }
                    if ("tool_use".equals(type)) {
                        String name = item.path("name").asText("");
                        String inputJson = item.path("input").isMissingNode()
                            ? "{}"
                            : objectMapper.writeValueAsString(item.path("input"));
                        if (!name.isBlank()) {
                            toolCalls.add(new AiToolCall(name, inputJson));
                        }
                    }
                }
            }

            String content = contentBuilder.toString();
            int inputTokens = json.path("usage").path("input_tokens").asInt(estimateTokens(request.userPrompt()));
            int outputTokens = json.path("usage").path("output_tokens").asInt(estimateTokens(content));
            return new AiGenerateResult(content, inputTokens, outputTokens, toolCalls);
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "Claude 调用失败: " + e.getMessage());
        }
    }

    private List<Map<String, Object>> buildOpenAiMessages(AiGenerateRequest request) {
        List<Map<String, Object>> messages = new ArrayList<>();
        if (request.systemPrompt() != null && !request.systemPrompt().isBlank()) {
            messages.add(Map.of("role", "system", "content", request.systemPrompt()));
        }
        for (AiMessage item : request.safeHistory()) {
            messages.add(Map.of("role", item.role(), "content", item.content()));
        }
        messages.add(Map.of("role", "user", "content", request.userPrompt()));
        return messages;
    }

    private List<Map<String, Object>> buildClaudeMessages(AiGenerateRequest request) {
        List<Map<String, Object>> messages = new ArrayList<>();
        for (AiMessage item : request.safeHistory()) {
            messages.add(Map.of("role", item.role(), "content", item.content()));
        }
        messages.add(Map.of("role", "user", "content", request.userPrompt()));
        return messages;
    }

    private List<Map<String, Object>> buildOpenAiTools(List<AiToolDefinition> defs) {
        List<Map<String, Object>> tools = new ArrayList<>();
        for (AiToolDefinition def : defs) {
            tools.add(Map.of(
                "type", "function",
                "function", Map.of(
                    "name", def.name(),
                    "description", def.description(),
                    "parameters", def.jsonSchema()
                )
            ));
        }
        return tools;
    }

    private List<Map<String, Object>> buildClaudeTools(List<AiToolDefinition> defs) {
        List<Map<String, Object>> tools = new ArrayList<>();
        for (AiToolDefinition def : defs) {
            tools.add(Map.of(
                "name", def.name(),
                "description", def.description(),
                "input_schema", def.jsonSchema()
            ));
        }
        return tools;
    }

    protected int estimateTokens(String text) {
        if (text == null || text.isBlank()) {
            return 0;
        }
        return Math.max(1, text.length() / 2);
    }

    protected <T> T parseJson(String json, Class<T> clazz) {
        try {
            return objectMapper.readValue(json, clazz);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "工具参数 JSON 解析失败");
        }
    }

    private void ensureApiKey(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "AI API Key 未配置");
        }
    }
}
