package com.niuma.gzh.common.base;

import java.util.List;

public record PageResult<T>(
    long page,
    long size,
    long total,
    List<T> records
) {
}
