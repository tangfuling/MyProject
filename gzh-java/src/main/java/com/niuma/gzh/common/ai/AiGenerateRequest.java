package com.niuma.gzh.common.ai;

import java.util.List;

public record AiGenerateRequest(
    String systemPrompt,
    String userPrompt,
    List<AiMessage> history
) {
}
