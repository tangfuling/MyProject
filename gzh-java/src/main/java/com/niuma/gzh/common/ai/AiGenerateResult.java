package com.niuma.gzh.common.ai;

import java.util.Collections;
import java.util.List;

public class AiGenerateResult {
    private final String content;
    private final int inputTokens;
    private final int outputTokens;
    private final List<AiToolCall> toolCalls;

    public AiGenerateResult(String content, int inputTokens, int outputTokens, List<AiToolCall> toolCalls) {
        this.content = content;
        this.inputTokens = inputTokens;
        this.outputTokens = outputTokens;
        this.toolCalls = toolCalls;
    }

    public AiGenerateResult(String content, int inputTokens, int outputTokens) {
        this(content, inputTokens, outputTokens, Collections.emptyList());
    }

    public String content() {
        return content;
    }

    public int inputTokens() {
        return inputTokens;
    }

    public int outputTokens() {
        return outputTokens;
    }

    public List<AiToolCall> toolCalls() {
        return toolCalls;
    }

    public List<AiToolCall> safeToolCalls() {
        return toolCalls == null ? Collections.<AiToolCall>emptyList() : toolCalls;
    }

    public boolean hasToolCalls() {
        return !safeToolCalls().isEmpty();
    }

    public String getContent() {
        return content;
    }

    public int getInputTokens() {
        return inputTokens;
    }

    public int getOutputTokens() {
        return outputTokens;
    }

    public List<AiToolCall> getToolCalls() {
        return toolCalls;
    }
}
