package com.niuma.gzh.common.base;

public class ApiResponse<T> {
    private final Integer code;
    private final String message;
    private final T data;

    public ApiResponse(Integer code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(0, "OK", data);
    }

    public static <T> ApiResponse<T> fail(Integer code, String message) {
        return new ApiResponse<>(code, message, null);
    }

    public Integer code() {
        return code;
    }

    public String message() {
        return message;
    }

    public T data() {
        return data;
    }

    public Integer getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    public T getData() {
        return data;
    }
}
