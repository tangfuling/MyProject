package com.niuma.gzh.modules.order.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.niuma.gzh.modules.order.model.entity.OrderEntity;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface OrderMapper extends BaseMapper<OrderEntity> {
}
