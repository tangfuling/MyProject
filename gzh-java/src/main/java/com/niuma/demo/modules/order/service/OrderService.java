package com.niuma.demo.modules.order.service;

import com.niuma.demo.modules.order.model.dto.PayOrderDTO;
import com.niuma.demo.modules.order.model.vo.OrderVO;

public interface OrderService {
    OrderVO detail(Long id);

    void pay(PayOrderDTO dto);
}
