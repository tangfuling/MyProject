package com.niuma.gzh.modules.payment.service;

import com.niuma.gzh.modules.payment.model.dto.CreatePaymentDTO;
import com.niuma.gzh.modules.payment.model.vo.CreatePaymentVO;
import java.util.Map;

public interface PaymentService {
    CreatePaymentVO create(CreatePaymentDTO dto);

    String notify(Map<String, String> params);
}
