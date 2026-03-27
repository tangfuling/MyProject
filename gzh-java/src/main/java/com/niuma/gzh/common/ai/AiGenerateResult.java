package com.niuma.gzh.common.ai;

public record AiGenerateResult(
    String content,
    int inputTokens,
    int outputTokens
) {
}
