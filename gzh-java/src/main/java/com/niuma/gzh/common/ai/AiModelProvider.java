package com.niuma.gzh.common.ai;

import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;

public enum AiModelProvider {
    QWEN("qwen", 200, 600),
    DOUBAO("doubao", 300, 900),
    GPT("gpt", 1000, 3000),
    CLAUDE("claude", 1500, 7500);

    private final String code;
    private final int inputPerMillionCent;
    private final int outputPerMillionCent;

    AiModelProvider(String code, int inputPerMillionCent, int outputPerMillionCent) {
        this.code = code;
        this.inputPerMillionCent = inputPerMillionCent;
        this.outputPerMillionCent = outputPerMillionCent;
    }

    public String getCode() {
        return code;
    }

    public int calcCostCent(int inputTokens, int outputTokens) {
        long inputCost = (long) inputTokens * inputPerMillionCent;
        long outputCost = (long) outputTokens * outputPerMillionCent;
        long total = inputCost + outputCost;
        long cent = (total + 999_999L) / 1_000_000L;
        return (int) Math.max(1, cent);
    }

    public static AiModelProvider fromCode(String code) {
        for (AiModelProvider value : values()) {
            if (value.code.equalsIgnoreCase(code)) {
                return value;
            }
        }
        throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "不支持的 AI 模型: " + code);
    }
}
