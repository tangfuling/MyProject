package com.niuma.gzh.modules.payment.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.common.validation.PageParam;
import com.niuma.gzh.modules.payment.model.dto.CreatePaymentDTO;
import com.niuma.gzh.modules.payment.model.vo.CreatePaymentVO;
import com.niuma.gzh.modules.payment.model.vo.PaymentOrderVO;
import com.niuma.gzh.modules.payment.service.PaymentService;
import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.HashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/payment")
public class PaymentController extends BaseController {
    private final PaymentService paymentService;

    public PaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @PostMapping("/create")
    public ApiResponse<CreatePaymentVO> create(@RequestBody @Valid CreatePaymentDTO dto) {
        return ApiResponse.success(paymentService.create(dto));
    }

    @GetMapping("/orders")
    public ApiResponse<PageResult<PaymentOrderVO>> orders(@Valid PageParam pageParam) {
        return ApiResponse.success(paymentService.orders(pageParam.page(), pageParam.size()));
    }

    @PostMapping("/notify")
    public String notify(HttpServletRequest request) {
        Map<String, String> params = new HashMap<>();
        request.getParameterMap().forEach((key, values) -> {
            if (values != null && values.length > 0) {
                params.put(key, values[0]);
            }
        });
        return paymentService.notify(params);
    }
}
