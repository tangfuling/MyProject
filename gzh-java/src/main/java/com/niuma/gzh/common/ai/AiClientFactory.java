package com.niuma.gzh.common.ai;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AiClientFactory {
    private final Map<AiModelProvider, AiClient> clientMap = new EnumMap<>(AiModelProvider.class);
    private final AiModelProvider defaultProvider;

    public AiClientFactory(List<AiClient> clients,
                           @Value("${app.ai.default-model:qwen}") String defaultModel) {
        for (AiClient client : clients) {
            clientMap.put(client.provider(), client);
        }
        this.defaultProvider = AiModelProvider.fromCode(defaultModel);
    }

    public AiClient getByModelCode(String modelCode) {
        AiModelProvider provider = modelCode == null || modelCode.isBlank() ? defaultProvider : AiModelProvider.fromCode(modelCode);
        return clientMap.get(provider);
    }

    public AiModelProvider getProvider(String modelCode) {
        return modelCode == null || modelCode.isBlank() ? defaultProvider : AiModelProvider.fromCode(modelCode);
    }

    public AiModelProvider getDefaultProvider() {
        return defaultProvider;
    }
}
