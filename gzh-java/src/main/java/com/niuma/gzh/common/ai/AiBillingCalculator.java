package com.niuma.gzh.common.ai;

import com.niuma.gzh.common.config.AiPricingProperties;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class AiBillingCalculator {
    private static final BigDecimal ONE_MILLION = BigDecimal.valueOf(1_000_000L);
    private final AiPricingProperties pricingProperties;

    public AiBillingCalculator(AiPricingProperties pricingProperties) {
        this.pricingProperties = pricingProperties;
    }

    public int calcCostCent(AiModelProvider provider, int inputTokens, int outputTokens) {
        return calcCostCent(provider.getCode(), inputTokens, outputTokens);
    }

    public int calcCostCent(String modelCode, int inputTokens, int outputTokens) {
        long weightedCent = weightedCent(modelCode, inputTokens, outputTokens);
        return toChargeCent(weightedCent);
    }

    public int calcTotalCostCent(AiModelProvider provider, List<TokenUsage> usages) {
        return calcTotalCostCent(provider.getCode(), usages);
    }

    public int calcTotalCostCent(String modelCode, List<TokenUsage> usages) {
        if (usages == null || usages.isEmpty()) {
            return 0;
        }
        long weightedSum = 0L;
        for (TokenUsage usage : usages) {
            if (usage == null) {
                continue;
            }
            weightedSum += weightedCent(modelCode, usage.inputTokens(), usage.outputTokens());
        }
        return toChargeCent(weightedSum);
    }

    private long weightedCent(String modelCode, int inputTokens, int outputTokens) {
        int safeInput = Math.max(0, inputTokens);
        int safeOutput = Math.max(0, outputTokens);
        if (safeInput == 0 && safeOutput == 0) {
            return 0L;
        }

        AiPricingProperties.ModelPricing modelPricing = pricingProperties.requiredModelPricing(modelCode);
        List<AiPricingProperties.TierPricing> tiers = modelPricing.getTiers();

        long tierInput = Math.max(1, safeInput);
        AiPricingProperties.TierPricing tier = tiers.get(tiers.size() - 1);
        for (AiPricingProperties.TierPricing candidate : tiers) {
            if (tierInput <= candidate.getMaxInputTokens()) {
                tier = candidate;
                break;
            }
        }

        return (long) safeInput * tier.getInputPerMillionCent()
            + (long) safeOutput * tier.getOutputPerMillionCent();
    }

    private int toChargeCent(long weightedCent) {
        if (weightedCent <= 0L) {
            return 0;
        }
        BigDecimal charge = BigDecimal.valueOf(weightedCent)
            .multiply(pricingProperties.getChargeMultiplier())
            .divide(ONE_MILLION, 0, RoundingMode.CEILING);
        if (charge.compareTo(BigDecimal.ONE) < 0) {
            return 1;
        }
        if (charge.compareTo(BigDecimal.valueOf(Integer.MAX_VALUE)) > 0) {
            return Integer.MAX_VALUE;
        }
        return charge.intValue();
    }

    public record TokenUsage(int inputTokens, int outputTokens) {
    }
}
