package com.niuma.gzh.common.ai.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.niuma.gzh.common.ai.AiGenerateRequest;
import com.niuma.gzh.common.ai.AiGenerateResult;
import com.niuma.gzh.common.ai.AiModelProvider;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class QwenAiClient extends BaseHttpAiClient {
    private final String endpoint;
    private final String apiKey;
    private final String model;

    public QwenAiClient(ObjectMapper objectMapper,
                        @Value("${app.ai.timeout-ms:30000}") int timeoutMs,
                        @Value("${app.ai.qwen35.endpoint}") String endpoint,
                        @Value("${app.ai.qwen35.api-key}") String apiKey,
                        @Value("${app.ai.qwen35.model}") String model) {
        super(objectMapper, timeoutMs);
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.model = model;
    }

    @Override
    public AiModelProvider provider() {
        return AiModelProvider.QWEN_3_5;
    }

    @Override
    public AiGenerateResult generate(AiGenerateRequest request) {
        return callOpenAiCompatible(endpoint, apiKey, model, request, com.niuma.gzh.common.util.J8.mapOf());
    }
}
