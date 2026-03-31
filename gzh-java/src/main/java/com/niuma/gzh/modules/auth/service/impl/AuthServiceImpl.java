package com.niuma.gzh.modules.auth.service.impl;

import com.niuma.gzh.common.base.BaseService;
import com.niuma.gzh.common.cache.CacheKey;
import com.niuma.gzh.common.cache.RedisClient;
import com.niuma.gzh.common.security.JwtService;
import com.niuma.gzh.common.util.PhoneUtil;
import com.niuma.gzh.common.web.BizException;
import com.niuma.gzh.common.web.ErrorCode;
import com.niuma.gzh.integrations.sms.SmsClient;
import com.niuma.gzh.modules.auth.model.dto.LoginDTO;
import com.niuma.gzh.modules.auth.model.dto.SendCodeDTO;
import com.niuma.gzh.modules.auth.model.vo.LoginVO;
import com.niuma.gzh.modules.auth.service.AuthService;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import com.niuma.gzh.modules.user.service.UserService;
import java.time.Duration;
import java.util.Random;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AuthServiceImpl extends BaseService implements AuthService {
    private final RedisClient redisClient;
    private final SmsClient smsClient;
    private final UserService userService;
    private final JwtService jwtService;
    private final boolean debugMode;
    private final Random random = new Random();

    public AuthServiceImpl(RedisClient redisClient,
                           SmsClient smsClient,
                           UserService userService,
                           JwtService jwtService,
                           @Value("${app.auth.debug-mode:false}") boolean debugMode) {
        this.redisClient = redisClient;
        this.smsClient = smsClient;
        this.userService = userService;
        this.jwtService = jwtService;
        this.debugMode = debugMode;
    }

    @Override
    public void sendCode(SendCodeDTO dto) {
        String phone = dto.getPhone();
        String cooldownKey = CacheKey.authCodeCooldown(phone);
        if (redisClient.exists(cooldownKey)) {
            throw new BizException(ErrorCode.RATE_LIMIT.getCode(), "验证码发送过于频繁，请 60 秒后再试");
        }

        String code = String.format("%06d", random.nextInt(1_000_000));
        if (!debugMode) {
            smsClient.sendCode(phone, code);
        }
        redisClient.set(CacheKey.authCode(phone), code, Duration.ofMinutes(5));
        redisClient.set(cooldownKey, "1", Duration.ofSeconds(60));
    }

    @Override
    public LoginVO login(LoginDTO dto) {
        if (!debugMode) {
            String cachedCode = redisClient.get(CacheKey.authCode(dto.getPhone()));
            if (cachedCode == null || !cachedCode.equals(dto.getCode())) {
                throw new BizException(ErrorCode.INVALID_PARAM.getCode(), "验证码错误或已过期");
            }
            redisClient.delete(CacheKey.authCode(dto.getPhone()));
        }

        UserEntity user = userService.findOrCreateByPhone(dto.getPhone());
        LoginVO vo = new LoginVO();
        vo.setToken(jwtService.generateToken(user.getId()));

        LoginVO.UserInfoVO userVO = new LoginVO.UserInfoVO();
        userVO.setId(user.getId());
        userVO.setPhone(PhoneUtil.mask(user.getPhone()));
        userVO.setBalance(user.getBalanceCent());
        userVO.setFreeQuota(user.getFreeQuotaCent());
        userVO.setAiModel(user.getAiModel());
        vo.setUser(userVO);
        return vo;
    }
}
