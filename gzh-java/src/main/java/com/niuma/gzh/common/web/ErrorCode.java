package com.niuma.gzh.common.web;

public enum ErrorCode {
    INVALID_PARAM(40001, "参数错误"),
    RATE_LIMIT(40002, "请求太频繁，请稍后重试"),
    UNAUTHORIZED(40101, "未登录或登录已过期"),
    FORBIDDEN(40301, "无权限访问"),
    NOT_FOUND(40401, "资源不存在"),
    BALANCE_NOT_ENOUGH(40901, "余额不足，请先充值"),
    THIRD_PARTY_ERROR(50201, "第三方服务调用失败"),
    SYSTEM_BUSY(50000, "系统繁忙，请稍后重试");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }
}
