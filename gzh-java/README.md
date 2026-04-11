# gzh-java

公众号数据运营助手后端（Spring Boot 2.7 + MyBatis-Plus）。

## 1) 初始化数据库

执行 SQL:

- `../docs/Sql/navicat-init.sql`

数据库名默认 `gzh`（可通过 `MYSQL_URL` 修改）。

## 2) 环境变量

复制 `.env.example` 并注入到运行环境（IDE / shell / deploy system）。

必须配置：

- MySQL / Redis
- `JWT_SECRET`
- 短信服务配置（`SMS_ENDPOINT` 等）
- 支付宝配置（`ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY`）

## 3) 启动

```bash
# 机器需已安装 Maven
mvn spring-boot:run
```

运行环境：Java 8（推荐 1.8.0_202+）。

默认端口 `8081`。
