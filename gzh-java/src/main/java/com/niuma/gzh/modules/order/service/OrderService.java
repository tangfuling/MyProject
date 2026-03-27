package com.niuma.gzh.modules.order.service;

import com.niuma.gzh.modules.order.model.dto.PayOrderDTO;
import com.niuma.gzh.modules.order.model.vo.OrderVO;

public interface OrderService {
    OrderVO detail(Long id);

    void pay(PayOrderDTO dto);
}
