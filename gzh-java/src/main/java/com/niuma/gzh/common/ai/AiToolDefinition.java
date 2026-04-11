package com.niuma.gzh.common.ai;

import java.util.Map;

public class AiToolDefinition {
    private final String name;
    private final String description;
    private final Map<String, Object> jsonSchema;

    public AiToolDefinition(String name, String description, Map<String, Object> jsonSchema) {
        this.name = name;
        this.description = description;
        this.jsonSchema = jsonSchema;
    }

    public String name() {
        return name;
    }

    public String description() {
        return description;
    }

    public Map<String, Object> jsonSchema() {
        return jsonSchema;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public Map<String, Object> getJsonSchema() {
        return jsonSchema;
    }
}
