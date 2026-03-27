package com.niuma.gzh.modules.payment.service.impl;

import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.cache.CacheKey;
import com.niuma.gzh.common.cache.RedisClient;
import com.niuma.gzh.common.security.AuthContext;
import com.niuma.gzh.common.util.IdUtil;
import com.niuma.gzh.common.util.JsonUtil;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import com.niuma.gzh.integrations.alipay.AlipaySignUtil;
import com.niuma.gzh.modules.payment.model.dto.CreatePaymentDTO;
import com.niuma.gzh.modules.payment.model.entity.PaymentOrderEntity;
import com.niuma.gzh.modules.payment.model.vo.CreatePaymentVO;
import com.niuma.gzh.modules.payment.repository.PaymentOrderRepository;
import com.niuma.gzh.modules.payment.service.PaymentService;
import com.niuma.gzh.modules.user.service.UserService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentServiceImpl extends BaseService implements PaymentService {
    private final PaymentOrderRepository paymentOrderRepository;
    private final UserService userService;
    private final JsonUtil jsonUtil;
    private final RedisClient redisClient;

    private final String gatewayUrl;
    private final String appId;
    private final String privateKey;
    private final String alipayPublicKey;
    private final String notifyUrl;
    private final String returnUrl;

    public PaymentServiceImpl(PaymentOrderRepository paymentOrderRepository,
                              UserService userService,
                              JsonUtil jsonUtil,
                              RedisClient redisClient,
                              @Value("${app.payment.alipay.gateway-url}") String gatewayUrl,
                              @Value("${app.payment.alipay.app-id}") String appId,
                              @Value("${app.payment.alipay.private-key}") String privateKey,
                              @Value("${app.payment.alipay.alipay-public-key}") String alipayPublicKey,
                              @Value("${app.payment.alipay.notify-url}") String notifyUrl,
                              @Value("${app.payment.alipay.return-url}") String returnUrl) {
        this.paymentOrderRepository = paymentOrderRepository;
        this.userService = userService;
        this.jsonUtil = jsonUtil;
        this.redisClient = redisClient;
        this.gatewayUrl = gatewayUrl;
        this.appId = appId;
        this.privateKey = privateKey;
        this.alipayPublicKey = alipayPublicKey;
        this.notifyUrl = notifyUrl;
        this.returnUrl = returnUrl;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public CreatePaymentVO create(CreatePaymentDTO dto) {
        if (appId == null || appId.isBlank() || privateKey == null || privateKey.isBlank()) {
            throw new BizException(ErrorCode.THIRD_PARTY_ERROR.getCode(), "支付宝配置不完整");
        }
        Long userId = AuthContext.requiredUserId();
        String orderNo = IdUtil.orderNo();

        PaymentOrderEntity order = new PaymentOrderEntity();
        order.setUserId(userId);
        order.setOrderNo(orderNo);
        order.setAmountCent(dto.getAmountCent());
        order.setStatus("PENDING");
        order.setSubject(dto.getSubject() == null || dto.getSubject().isBlank() ? "公众号助手充值" : dto.getSubject());
        order.setCreatedAt(LocalDateTime.now());
        order.setUpdatedAt(LocalDateTime.now());

        String payUrl = buildPayUrl(order);
        order.setPayUrl(payUrl);
        paymentOrderRepository.save(order);

        CreatePaymentVO vo = new CreatePaymentVO();
        vo.setOrderNo(orderNo);
        vo.setPayUrl(payUrl);
        return vo;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public String notify(Map<String, String> params) {
        String sign = params.get("sign");
        if (sign == null || sign.isBlank()) {
            return "failure";
        }
        if (!AlipaySignUtil.verify(params, alipayPublicKey, sign)) {
            return "failure";
        }

        String outTradeNo = params.get("out_trade_no");
        String tradeStatus = params.get("trade_status");
        String tradeNo = params.get("trade_no");

        if (outTradeNo == null || outTradeNo.isBlank()) {
            return "failure";
        }

        String idempotentKey = CacheKey.paymentIdempotent(outTradeNo);
        Boolean first = redisClient.setIfAbsent(idempotentKey, "1", Duration.ofHours(24));
        if (Boolean.FALSE.equals(first)) {
            return "success";
        }

        PaymentOrderEntity order = paymentOrderRepository.findByOrderNo(outTradeNo);
        if (order == null) {
            redisClient.delete(idempotentKey);
            return "failure";
        }

        if ("PAID".equals(order.getStatus())) {
            return "success";
        }

        if ("TRADE_SUCCESS".equals(tradeStatus) || "TRADE_FINISHED".equals(tradeStatus)) {
            order.setStatus("PAID");
            order.setAlipayTradeNo(tradeNo);
            order.setUpdatedAt(LocalDateTime.now());
            paymentOrderRepository.save(order);
            userService.recharge(order.getUserId(), order.getAmountCent());
            return "success";
        }

        redisClient.delete(idempotentKey);
        return "failure";
    }

    private String buildPayUrl(PaymentOrderEntity order) {
        String bizContent = jsonUtil.toJson(Map.of(
            "out_trade_no", order.getOrderNo(),
            "product_code", "FAST_INSTANT_TRADE_PAY",
            "total_amount", centToYuan(order.getAmountCent()),
            "subject", order.getSubject()
        ));

        Map<String, String> params = new LinkedHashMap<>();
        params.put("app_id", appId);
        params.put("method", "alipay.trade.page.pay");
        params.put("format", "JSON");
        params.put("charset", "utf-8");
        params.put("sign_type", "RSA2");
        params.put("timestamp", LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
        params.put("version", "1.0");
        params.put("notify_url", notifyUrl);
        params.put("return_url", returnUrl);
        params.put("biz_content", bizContent);

        String sign = AlipaySignUtil.sign(params, privateKey);
        params.put("sign", sign);

        return gatewayUrl + "?" + AlipaySignUtil.toQueryString(params);
    }

    private String centToYuan(int amountCent) {
        return BigDecimal.valueOf(amountCent)
            .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP)
            .toPlainString();
    }
}
