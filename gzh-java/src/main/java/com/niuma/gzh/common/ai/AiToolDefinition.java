package com.niuma.gzh.common.ai;

import java.util.Map;

public record AiToolDefinition(
    String name,
    String description,
    Map<String, Object> jsonSchema
) {
}
