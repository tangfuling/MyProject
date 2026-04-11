package com.niuma.gzh.common.ai;

public class AiToolCall {
    private final String name;
    private final String argumentsJson;

    public AiToolCall(String name, String argumentsJson) {
        this.name = name;
        this.argumentsJson = argumentsJson;
    }

    public String name() {
        return name;
    }

    public String argumentsJson() {
        return argumentsJson;
    }

    public String getName() {
        return name;
    }

    public String getArgumentsJson() {
        return argumentsJson;
    }
}
