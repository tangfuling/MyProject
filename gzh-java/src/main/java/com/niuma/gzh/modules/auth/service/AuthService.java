package com.niuma.gzh.modules.auth.service;

import com.niuma.gzh.modules.auth.model.dto.LoginDTO;
import com.niuma.gzh.modules.auth.model.dto.SendCodeDTO;
import com.niuma.gzh.modules.auth.model.vo.LoginVO;

public interface AuthService {
    void sendCode(SendCodeDTO dto);

    LoginVO login(LoginDTO dto);
}
