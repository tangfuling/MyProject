package com.niuma.gzh.common.config;

import com.niuma.gzh.common.ai.AiModelProvider;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import javax.annotation.PostConstruct;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "app.ai.pricing")
public class AiPricingProperties {
    private BigDecimal chargeMultiplier = BigDecimal.valueOf(5);
    private Map<String, ModelPricing> models = defaultModels();

    @PostConstruct
    public void init() {
        if (chargeMultiplier == null || chargeMultiplier.compareTo(BigDecimal.ZERO) <= 0) {
            chargeMultiplier = BigDecimal.ONE;
        }
        if (models == null || models.isEmpty()) {
            models = defaultModels();
        }

        Map<String, ModelPricing> normalized = new LinkedHashMap<>();
        for (Map.Entry<String, ModelPricing> entry : models.entrySet()) {
            String modelCode = normalizeModelCode(entry.getKey());
            if (modelCode.trim().isEmpty() || entry.getValue() == null) {
                continue;
            }
            ModelPricing pricing = entry.getValue();
            normalizeTierOrder(pricing);
            normalized.put(modelCode, pricing);
        }

        normalized.putIfAbsent(AiModelProvider.QWEN_3_5.getCode(), defaultQwen35Pricing());
        normalized.putIfAbsent(AiModelProvider.QWEN_3_6.getCode(), defaultQwen36Pricing());
        models = normalized;
    }

    public ModelPricing requiredModelPricing(String modelCode) {
        String normalized = normalizeModelCode(modelCode);
        ModelPricing pricing = models.get(normalized);
        if (pricing == null || pricing.getTiers() == null || pricing.getTiers().isEmpty()) {
            throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "未配置模型计费规则: " + modelCode);
        }
        return pricing;
    }

    private void normalizeTierOrder(ModelPricing pricing) {
        if (pricing.getTiers() == null) {
            pricing.setTiers(new ArrayList<>());
        }
        pricing.getTiers().removeIf(item -> item == null || item.getMaxInputTokens() <= 0);
        pricing.getTiers().sort(Comparator.comparingLong(TierPricing::getMaxInputTokens));
        if (pricing.getTiers().isEmpty()) {
            throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "计费阶梯不能为空");
        }
    }

    private String normalizeModelCode(String code) {
        return code == null ? "" : code.trim().toLowerCase(Locale.ROOT);
    }

    private static Map<String, ModelPricing> defaultModels() {
        Map<String, ModelPricing> defaults = new LinkedHashMap<>();
        defaults.put(AiModelProvider.QWEN_3_5.getCode(), defaultQwen35Pricing());
        defaults.put(AiModelProvider.QWEN_3_6.getCode(), defaultQwen36Pricing());
        return defaults;
    }

    private static ModelPricing defaultQwen35Pricing() {
        ModelPricing pricing = new ModelPricing();
        pricing.setTiers(new ArrayList<>(com.niuma.gzh.common.util.J8.listOf(
            tier(131072, 20, 200),
            tier(262144, 80, 800),
            tier(1_000_000, 120, 1200)
        )));
        return pricing;
    }

    private static ModelPricing defaultQwen36Pricing() {
        ModelPricing pricing = new ModelPricing();
        pricing.setTiers(new ArrayList<>(com.niuma.gzh.common.util.J8.listOf(
            tier(262144, 200, 1200),
            tier(1_000_000, 800, 4800)
        )));
        return pricing;
    }

    private static TierPricing tier(long maxInputTokens, int inputPerMillionCent, int outputPerMillionCent) {
        TierPricing tier = new TierPricing();
        tier.setMaxInputTokens(maxInputTokens);
        tier.setInputPerMillionCent(inputPerMillionCent);
        tier.setOutputPerMillionCent(outputPerMillionCent);
        return tier;
    }

    @Data
    public static class ModelPricing {
        private List<TierPricing> tiers = new ArrayList<>();
    }

    @Data
    public static class TierPricing {
        private long maxInputTokens;
        private int inputPerMillionCent;
        private int outputPerMillionCent;
    }
}
