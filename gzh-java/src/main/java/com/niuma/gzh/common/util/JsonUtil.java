package com.niuma.gzh.common.util;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import java.util.Collections;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class JsonUtil {
    private final ObjectMapper objectMapper;

    public JsonUtil(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.SYSTEM_BUSY.getCode(), "JSON 序列化失败");
        }
    }

    public <T> T fromJson(String json, Class<T> clazz) {
        try {
            return objectMapper.readValue(json, clazz);
        } catch (JsonProcessingException e) {
            throw new BizException(ErrorCode.SYSTEM_BUSY.getCode(), "JSON 解析失败");
        }
    }

    public Map<String, Integer> toIntMap(String json) {
        if (json == null || json.trim().isEmpty()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Integer>>() {});
        } catch (JsonProcessingException e) {
            return Collections.emptyMap();
        }
    }

    public Map<String, Double> toDoubleMap(String json) {
        if (json == null || json.trim().isEmpty()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, Double>>() {});
        } catch (JsonProcessingException e) {
            return Collections.emptyMap();
        }
    }
}
