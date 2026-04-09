package com.niuma.gzh.common.ai;

import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AiClientFactory {
    private static final Set<AiModelProvider> SUPPORTED_QWEN_MODELS = Set.of(
        AiModelProvider.QWEN_3_5,
        AiModelProvider.QWEN_3_6
    );

    private final Map<AiModelProvider, AiClient> clientMap = new EnumMap<>(AiModelProvider.class);
    private final AiModelProvider defaultProvider;

    public AiClientFactory(List<AiClient> clients,
                           @Value("${app.ai.default-model:qwen_3_5}") String defaultModel) {
        for (AiClient client : clients) {
            clientMap.put(client.provider(), client);
        }
        AiModelProvider configuredProvider = AiModelProvider.fromCode(defaultModel);
        if (!SUPPORTED_QWEN_MODELS.contains(configuredProvider)) {
            throw new IllegalArgumentException("app.ai.default-model 仅支持 qwen_3_5 或 qwen_3_6");
        }
        this.defaultProvider = configuredProvider;
    }

    public AiClient getByModelCode(String modelCode) {
        AiModelProvider provider = resolveProvider(modelCode);
        AiClient client = clientMap.get(provider);
        if (client != null) {
            return client;
        }
        throw new BizException(ErrorCode.SYSTEM_BUSY.getCode(), "未配置可用的模型客户端: " + provider.getCode());
    }

    public AiModelProvider getProvider(String modelCode) {
        return resolveProvider(modelCode);
    }

    public AiModelProvider getDefaultProvider() {
        return defaultProvider;
    }

    private AiModelProvider resolveProvider(String modelCode) {
        if (modelCode == null || modelCode.isBlank()) {
            return defaultProvider;
        }
        AiModelProvider provider = AiModelProvider.fromCode(modelCode);
        if (!SUPPORTED_QWEN_MODELS.contains(provider)) {
            throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "当前仅支持 qwen_3_5 和 qwen_3_6");
        }
        return provider;
    }
}
