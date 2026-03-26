package com.niuma.demo.common.base;

import com.niuma.demo.common.log.LoggerUtil;
import java.util.function.Supplier;

public abstract class BaseService {
    protected <T> T execute(String action, Supplier<T> supplier) {
        long start = System.currentTimeMillis();
        try {
            return supplier.get();
        } finally {
            long cost = System.currentTimeMillis() - start;
            LoggerUtil.info("action=" + action + ", costMs=" + cost);
        }
    }
}
