package com.niuma.gzh.modules.auth.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.modules.auth.model.dto.LoginDTO;
import com.niuma.gzh.modules.auth.model.dto.SendCodeDTO;
import com.niuma.gzh.modules.auth.model.vo.LoginVO;
import com.niuma.gzh.modules.auth.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class AuthController extends BaseController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/send-code")
    public ApiResponse<Void> sendCode(@RequestBody @Valid SendCodeDTO dto) {
        authService.sendCode(dto);
        return ApiResponse.success(null);
    }

    @PostMapping("/login")
    public ApiResponse<LoginVO> login(@RequestBody @Valid LoginDTO dto) {
        return ApiResponse.success(authService.login(dto));
    }
}
