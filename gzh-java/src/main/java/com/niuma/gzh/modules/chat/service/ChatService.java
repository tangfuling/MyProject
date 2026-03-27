package com.niuma.gzh.modules.chat.service;

import com.niuma.gzh.modules.chat.model.dto.ChatSendDTO;
import com.niuma.gzh.modules.chat.model.vo.ChatMessageVO;
import java.util.List;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

public interface ChatService {
    SseEmitter send(ChatSendDTO dto);

    List<ChatMessageVO> history(String sessionId);
}
