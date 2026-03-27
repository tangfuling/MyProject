package com.niuma.gzh.modules.user.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.niuma.gzh.common.base.BaseRepository;
import com.niuma.gzh.modules.user.mapper.UserMapper;
import com.niuma.gzh.modules.user.model.entity.UserEntity;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository extends BaseRepository {
    private final UserMapper userMapper;

    public UserRepository(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    public UserEntity findByPhone(String phone) {
        return userMapper.selectOne(new LambdaQueryWrapper<UserEntity>()
            .eq(UserEntity::getPhone, phone)
            .last("limit 1"));
    }

    public UserEntity findById(Long id) {
        return userMapper.selectById(id);
    }

    public void save(UserEntity entity) {
        if (entity.getId() == null) {
            userMapper.insert(entity);
        } else {
            userMapper.updateById(entity);
        }
    }

    public int countUsers() {
        return Math.toIntExact(userMapper.selectCount(null));
    }
}
