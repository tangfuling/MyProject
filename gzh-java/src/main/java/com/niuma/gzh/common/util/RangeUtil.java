package com.niuma.gzh.common.util;

import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import java.time.LocalDateTime;

public final class RangeUtil {
    private RangeUtil() {
    }

    public static int toDays(String range) {
        switch (range) {
            case "7d":
                return 7;
            case "30d":
                return 30;
            case "60d":
                return 60;
            case "90d":
                return 90;
            case "all":
                return 36500;
            default:
                throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "不支持的时间范围");
        }
    }

    public static LocalDateTime rangeStart(String range) {
        int days = toDays(range);
        return LocalDateTime.now().minusDays(days);
    }
}
