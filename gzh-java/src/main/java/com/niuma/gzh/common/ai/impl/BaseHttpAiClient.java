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
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public abstract class BaseHttpAiClient implements AiClient {

    protected final ObjectMapper objectMapper;
    protected final int timeoutMs;

    protected BaseHttpAiClient(ObjectMapper objectMapper, int timeoutMs) {
        this.objectMapper = objectMapper;
        this.timeoutMs = timeoutMs;
    }

    protected AiGenerateResult callOpenAiCompatible(String endpoint,
                                                     String apiKey,
                                                     String model,
                                                     AiGenerateRequest request,
                                                     Map<String, String> extraHeaders) {
        ensureApiKey(apiKey);
        long startedAt = System.currentTimeMillis();
        try {
            List<Map<String, Object>> messages = buildOpenAiMessages(request);

            Map<String, Object> body = new LinkedHashMap<String, Object>();
            body.put("model", model);
            body.put("messages", messages);
            body.put("temperature", 0.7);

            List<Map<String, Object>> tools = buildOpenAiTools(request.safeTools());
            if (!tools.isEmpty()) {
                body.put("tools", tools);
                body.put("tool_choice", "auto");
            }

            String payload = objectMapper.writeValueAsString(body);
            Map<String, String> headers = new LinkedHashMap<String, String>();
            headers.put("Authorization", "Bearer " + apiKey);
            if (extraHeaders != null) {
                headers.putAll(extraHeaders);
            }

            HttpResult response = postJson(endpoint, payload, headers);
            long elapsedMs = System.currentTimeMillis() - startedAt;
            if (response.statusCode < 200 || response.statusCode >= 300) {
                log.warn("[tfling][ai.http] failed provider=openai-compatible, model={}, endpoint={}, status={}, elapsedMs={}, body={}",
                    model,
                    endpoint,
                    response.statusCode,
                    elapsedMs,
                    trimForLog(response.body, 600));
                throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "模型调用失败: " + response.body);
            }

            JsonNode json = objectMapper.readTree(response.body);
            JsonNode messageNode = json.path("choices").path(0).path("message");
            String content = messageNode.path("content").isMissingNode() || messageNode.path("content").isNull()
                ? ""
                : messageNode.path("content").asText("");

            List<AiToolCall> toolCalls = new ArrayList<AiToolCall>();
            JsonNode toolCallsNode = messageNode.path("tool_calls");
            if (toolCallsNode.isArray()) {
                for (JsonNode call : toolCallsNode) {
                    JsonNode function = call.path("function");
                    String name = function.path("name").asText("");
                    String args = function.path("arguments").isMissingNode()
                        ? "{}"
                        : function.path("arguments").asText("{}");
                    if (!isBlank(name)) {
                        toolCalls.add(new AiToolCall(name, args));
                    }
                }
            }

            int inputTokens = json.path("usage").path("prompt_tokens").asInt(estimateTokens(request.userPrompt()));
            int outputTokens = json.path("usage").path("completion_tokens").asInt(estimateTokens(content));
            return new AiGenerateResult(content, inputTokens, outputTokens, toolCalls);
        } catch (IOException e) {
            log.error("[tfling][ai.http] exception provider=openai-compatible, model={}, endpoint={}, elapsedMs={}, message={}",
                model,
                endpoint,
                System.currentTimeMillis() - startedAt,
                e.getMessage());
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "模型调用失败: " + e.getMessage());
        }
    }

    protected AiGenerateResult callClaude(String endpoint,
                                          String apiKey,
                                          String model,
                                          AiGenerateRequest request) {
        ensureApiKey(apiKey);
        long startedAt = System.currentTimeMillis();
        try {
            List<Map<String, Object>> messages = buildClaudeMessages(request);

            Map<String, Object> body = new LinkedHashMap<String, Object>();
            body.put("model", model);
            body.put("system", request.systemPrompt());
            body.put("messages", messages);
            body.put("max_tokens", 2048);

            List<Map<String, Object>> tools = buildClaudeTools(request.safeTools());
            if (!tools.isEmpty()) {
                body.put("tools", tools);
                Map<String, Object> toolChoice = new LinkedHashMap<String, Object>();
                toolChoice.put("type", "auto");
                body.put("tool_choice", toolChoice);
            }

            String payload = objectMapper.writeValueAsString(body);
            Map<String, String> headers = new LinkedHashMap<String, String>();
            headers.put("x-api-key", apiKey);
            headers.put("anthropic-version", "2023-06-01");
            HttpResult response = postJson(endpoint, payload, headers);

            long elapsedMs = System.currentTimeMillis() - startedAt;
            if (response.statusCode < 200 || response.statusCode >= 300) {
                log.warn("[tfling][ai.http] failed provider=claude, model={}, endpoint={}, status={}, elapsedMs={}, body={}",
                    model,
                    endpoint,
                    response.statusCode,
                    elapsedMs,
                    trimForLog(response.body, 600));
                throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "Claude 调用失败: " + response.body);
            }

            JsonNode json = objectMapper.readTree(response.body);
            List<AiToolCall> toolCalls = new ArrayList<AiToolCall>();
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
                        if (!isBlank(name)) {
                            toolCalls.add(new AiToolCall(name, inputJson));
                        }
                    }
                }
            }

            String content = contentBuilder.toString();
            int inputTokens = json.path("usage").path("input_tokens").asInt(estimateTokens(request.userPrompt()));
            int outputTokens = json.path("usage").path("output_tokens").asInt(estimateTokens(content));
            return new AiGenerateResult(content, inputTokens, outputTokens, toolCalls);
        } catch (IOException e) {
            log.error("[tfling][ai.http] exception provider=claude, model={}, endpoint={}, elapsedMs={}, message={}",
                model,
                endpoint,
                System.currentTimeMillis() - startedAt,
                e.getMessage());
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "Claude 调用失败: " + e.getMessage());
        }
    }

    private List<Map<String, Object>> buildOpenAiMessages(AiGenerateRequest request) {
        List<Map<String, Object>> messages = new ArrayList<Map<String, Object>>();
        if (request.systemPrompt() != null && !isBlank(request.systemPrompt())) {
            messages.add(mapOf("role", "system", "content", request.systemPrompt()));
        }
        for (AiMessage item : request.safeHistory()) {
            messages.add(mapOf("role", item.role(), "content", item.content()));
        }
        messages.add(mapOf("role", "user", "content", request.userPrompt()));
        return messages;
    }

    private List<Map<String, Object>> buildClaudeMessages(AiGenerateRequest request) {
        List<Map<String, Object>> messages = new ArrayList<Map<String, Object>>();
        for (AiMessage item : request.safeHistory()) {
            messages.add(mapOf("role", item.role(), "content", item.content()));
        }
        messages.add(mapOf("role", "user", "content", request.userPrompt()));
        return messages;
    }

    private List<Map<String, Object>> buildOpenAiTools(List<AiToolDefinition> defs) {
        List<Map<String, Object>> tools = new ArrayList<Map<String, Object>>();
        for (AiToolDefinition def : defs) {
            Map<String, Object> function = mapOf(
                "name", def.name(),
                "description", def.description(),
                "parameters", def.jsonSchema()
            );
            tools.add(mapOf(
                "type", "function",
                "function", function
            ));
        }
        return tools;
    }

    private List<Map<String, Object>> buildClaudeTools(List<AiToolDefinition> defs) {
        List<Map<String, Object>> tools = new ArrayList<Map<String, Object>>();
        for (AiToolDefinition def : defs) {
            tools.add(mapOf(
                "name", def.name(),
                "description", def.description(),
                "input_schema", def.jsonSchema()
            ));
        }
        return tools;
    }

    protected int estimateTokens(String text) {
        if (isBlank(text)) {
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
        if (isBlank(apiKey)) {
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "AI API Key 未配置");
        }
    }

    private String trimForLog(String text, int maxChars) {
        if (isBlank(text)) {
            return "";
        }
        String normalized = text.replace('\n', ' ').replace('\r', ' ').trim();
        if (normalized.length() <= maxChars) {
            return normalized;
        }
        return normalized.substring(0, maxChars) + "...";
    }

    private HttpResult postJson(String endpoint, String payload, Map<String, String> headers) throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
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

    private String readResponseBody(HttpURLConnection connection, int statusCode) throws IOException {
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

    private Map<String, Object> mapOf(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<String, Object>();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            map.put(String.valueOf(pairs[i]), pairs[i + 1]);
        }
        return map;
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
