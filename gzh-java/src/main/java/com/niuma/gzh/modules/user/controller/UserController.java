package com.niuma.gzh.modules.user.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.common.base.PageResult;
import com.niuma.gzh.common.validation.PageParam;
import com.niuma.gzh.modules.user.model.dto.UpdateAiModelDTO;
import com.niuma.gzh.modules.user.model.dto.UpdateProfileDTO;
import com.niuma.gzh.modules.user.model.vo.TokenLogVO;
import com.niuma.gzh.modules.user.model.vo.UserProfileVO;
import com.niuma.gzh.modules.user.service.UserService;
import jakarta.validation.Valid;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Validated
@RestController
@RequestMapping("/user")
public class UserController extends BaseController {
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/profile")
    public ApiResponse<UserProfileVO> profile() {
        return ApiResponse.success(userService.profile());
    }

    @PutMapping("/ai-model")
    public ApiResponse<Void> updateAiModel(@RequestBody @Valid UpdateAiModelDTO dto) {
        userService.updateAiModel(dto.getModel());
        return ApiResponse.success(null);
    }

    @PutMapping("/profile")
    public ApiResponse<Void> updateProfile(@RequestBody @Valid UpdateProfileDTO dto) {
        userService.updateProfile(dto.getDisplayName(), dto.getAvatarUrl());
        return ApiResponse.success(null);
    }

    @PostMapping("/avatar")
    public ApiResponse<String> uploadAvatar(@RequestParam("file") MultipartFile file) {
        return ApiResponse.success(userService.uploadAvatar(file));
    }

    @GetMapping("/token-logs")
    public ApiResponse<PageResult<TokenLogVO>> tokenLogs(@Valid PageParam pageParam) {
        return ApiResponse.success(userService.tokenLogs(pageParam.page(), pageParam.size()));
    }
}
