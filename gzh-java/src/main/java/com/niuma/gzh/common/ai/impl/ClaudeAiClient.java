package com.niuma.gzh.common.ai.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.niuma.gzh.common.ai.AiGenerateRequest;
import com.niuma.gzh.common.ai.AiGenerateResult;
import com.niuma.gzh.common.ai.AiModelProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class ClaudeAiClient extends BaseHttpAiClient {
    private final String endpoint;
    private final String apiKey;
    private final String model;

    public ClaudeAiClient(ObjectMapper objectMapper,
                          @Value("${app.ai.timeout-ms:30000}") int timeoutMs,
                          @Value("${app.ai.claude.endpoint}") String endpoint,
                          @Value("${app.ai.claude.api-key}") String apiKey,
                          @Value("${app.ai.claude.model}") String model) {
        super(objectMapper, timeoutMs);
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.model = model;
    }

    @Override
    public AiModelProvider provider() {
        return AiModelProvider.CLAUDE;
    }

    @Override
    public AiGenerateResult generate(AiGenerateRequest request) {
        return callClaude(endpoint, apiKey, model, request);
    }
}
