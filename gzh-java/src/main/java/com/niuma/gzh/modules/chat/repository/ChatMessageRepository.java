package com.niuma.gzh.modules.chat.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.chat.mapper.ChatMessageMapper;
import com.niuma.gzh.modules.chat.model.entity.ChatMessageEntity;
import java.util.List;
import org.springframework.stereotype.Repository;

@Repository
public class ChatMessageRepository extends BaseRepository {
    private final ChatMessageMapper chatMessageMapper;

    public ChatMessageRepository(ChatMessageMapper chatMessageMapper) {
        this.chatMessageMapper = chatMessageMapper;
    }

    public void save(ChatMessageEntity entity) {
        chatMessageMapper.insert(entity);
    }

    public List<ChatMessageEntity> listBySession(Long userId, String sessionId, int limit) {
        return chatMessageMapper.selectList(new LambdaQueryWrapper<ChatMessageEntity>()
            .eq(ChatMessageEntity::getUserId, userId)
            .eq(ChatMessageEntity::getSessionId, sessionId)
            .orderByDesc(ChatMessageEntity::getCreatedAt)
            .last("limit " + limit));
    }
}
