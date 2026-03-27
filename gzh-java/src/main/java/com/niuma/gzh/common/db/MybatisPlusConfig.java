package com.niuma.gzh.common.db;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@MapperScan("com.niuma.gzh.modules.**.mapper")
public class MybatisPlusConfig {
}
