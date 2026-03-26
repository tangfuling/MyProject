package com.niuma.demo.modules.order.controller;

import com.niuma.demo.common.base.ApiResponse;
import com.niuma.demo.common.base.BaseController;
import com.niuma.demo.modules.order.model.dto.PayOrderDTO;
import com.niuma.demo.modules.order.model.vo.OrderVO;
import com.niuma.demo.modules.order.service.OrderService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders")
public class OrderController extends BaseController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping("/{id}")
    public ApiResponse<OrderVO> detail(@PathVariable Long id) {
        return ApiResponse.success(orderService.detail(id));
    }

    @PostMapping("/pay")
    public ApiResponse<Void> pay(@RequestBody @Valid PayOrderDTO dto) {
        orderService.pay(dto);
        return ApiResponse.success(null);
    }
}
