package com.niuma.gzh.common.ai;

import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;

public enum AiModelProvider {
    QWEN_3_5("qwen_3_5"),
    QWEN_3_6("qwen_3_6"),
    DOUBAO("doubao"),
    GPT("gpt"),
    CLAUDE("claude");

    private final String code;

    AiModelProvider(String code) {
        this.code = code;
    }

    public String getCode() {
        return code;
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
