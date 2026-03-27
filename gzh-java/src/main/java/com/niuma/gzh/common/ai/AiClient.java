package com.niuma.gzh.common.ai;

public interface AiClient {
    AiModelProvider provider();

    AiGenerateResult generate(AiGenerateRequest request);
}
