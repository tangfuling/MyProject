package com.niuma.demo.common.db;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@MapperScan("com.niuma.demo.modules.**.mapper")
public class MybatisPlusConfig {
}
