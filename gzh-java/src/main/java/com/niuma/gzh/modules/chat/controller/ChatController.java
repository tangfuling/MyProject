package com.niuma.gzh.modules.chat.controller;

import com.niuma.gzh.common.base.ApiResponse;
import com.niuma.gzh.common.base.BaseController;
import com.niuma.gzh.modules.chat.model.dto.ChatSendDTO;
import com.niuma.gzh.modules.chat.model.vo.ChatMessageVO;
import com.niuma.gzh.modules.chat.service.ChatService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/chat")
public class ChatController extends BaseController {
    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @PostMapping("/send")
    public SseEmitter send(@RequestBody @Valid ChatSendDTO dto) {
        return chatService.send(dto);
    }

    @GetMapping("/history")
    public ApiResponse<List<ChatMessageVO>> history(@RequestParam("sessionId") String sessionId) {
        return ApiResponse.success(chatService.history(sessionId));
    }
}
