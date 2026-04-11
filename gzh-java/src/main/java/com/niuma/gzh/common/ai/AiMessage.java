package com.niuma.gzh.common.ai;

public class AiMessage {
    private final String role;
    private final String content;

    public AiMessage(String role, String content) {
        this.role = role;
        this.content = content;
    }

    public String role() {
        return role;
    }

    public String content() {
        return content;
    }

    public String getRole() {
        return role;
    }

    public String getContent() {
        return content;
    }
}
