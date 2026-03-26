package com.niuma.demo.integrations.client;

import org.springframework.stereotype.Component;

@Component
public class InventoryClient {
    public boolean reserve(Long skuId, Integer quantity) {
        return true;
    }
}
