package com.niuma.gzh.common.ai;

import java.util.List;

public record AiGenerateResult(
    String content,
    int inputTokens,
    int outputTokens,
    List<AiToolCall> toolCalls
) {
    public AiGenerateResult(String content, int inputTokens, int outputTokens) {
        this(content, inputTokens, outputTokens, List.of());
    }

    public List<AiToolCall> safeToolCalls() {
        return toolCalls == null ? List.of() : toolCalls;
    }

    public boolean hasToolCalls() {
        return !safeToolCalls().isEmpty();
    }
}
