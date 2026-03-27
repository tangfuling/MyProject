package com.niuma.gzh.common.ai;

import java.util.List;

public record AiGenerateRequest(
    String systemPrompt,
    String userPrompt,
    List<AiMessage> history,
    List<AiToolDefinition> tools
) {
    public AiGenerateRequest(String systemPrompt, String userPrompt, List<AiMessage> history) {
        this(systemPrompt, userPrompt, history, List.of());
    }

    public List<AiMessage> safeHistory() {
        return history == null ? List.of() : history;
    }

    public List<AiToolDefinition> safeTools() {
        return tools == null ? List.of() : tools;
    }
}
