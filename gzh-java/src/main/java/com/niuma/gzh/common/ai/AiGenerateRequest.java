package com.niuma.gzh.common.ai;

import java.util.Collections;
import java.util.List;

public class AiGenerateRequest {
    private final String systemPrompt;
    private final String userPrompt;
    private final List<AiMessage> history;
    private final List<AiToolDefinition> tools;

    public AiGenerateRequest(String systemPrompt, String userPrompt, List<AiMessage> history, List<AiToolDefinition> tools) {
        this.systemPrompt = systemPrompt;
        this.userPrompt = userPrompt;
        this.history = history;
        this.tools = tools;
    }

    public AiGenerateRequest(String systemPrompt, String userPrompt, List<AiMessage> history) {
        this(systemPrompt, userPrompt, history, Collections.emptyList());
    }

    public String systemPrompt() {
        return systemPrompt;
    }

    public String userPrompt() {
        return userPrompt;
    }

    public List<AiMessage> history() {
        return history;
    }

    public List<AiToolDefinition> tools() {
        return tools;
    }

    public List<AiMessage> safeHistory() {
        return history == null ? Collections.<AiMessage>emptyList() : history;
    }

    public List<AiToolDefinition> safeTools() {
        return tools == null ? Collections.<AiToolDefinition>emptyList() : tools;
    }

    public String getSystemPrompt() {
        return systemPrompt;
    }

    public String getUserPrompt() {
        return userPrompt;
    }

    public List<AiMessage> getHistory() {
        return history;
    }

    public List<AiToolDefinition> getTools() {
        return tools;
    }
}
