package com.niuma.demo.modules.order.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.niuma.demo.modules.order.model.entity.OrderEntity;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface OrderMapper extends BaseMapper<OrderEntity> {
}
