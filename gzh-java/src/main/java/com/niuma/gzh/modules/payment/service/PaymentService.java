package com.niuma.gzh.modules.payment.service;

import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.modules.payment.model.dto.CreatePaymentDTO;
import com.niuma.gzh.modules.payment.model.vo.CreatePaymentVO;
import com.niuma.gzh.modules.payment.model.vo.PaymentOrderVO;
import java.util.Map;

public interface PaymentService {
    CreatePaymentVO create(CreatePaymentDTO dto);

    PageResult<PaymentOrderVO> orders(long page, long size);

    String notify(Map<String, String> params);
}
