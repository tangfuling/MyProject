# gzh-java

公众号数据运营助手后端（Spring Boot 3 + MyBatis-Plus）。

## 1) 初始化数据库

执行 SQL:

- `src/main/resources/db/schema-mysql.sql`

数据库名默认 `gzh`（可通过 `MYSQL_URL` 修改）。

## 2) 环境变量

复制 `.env.example` 并注入到运行环境（IDE / shell / deploy system）。

必须配置：

- MySQL / Redis
- `JWT_SECRET`
- 至少一个 AI 模型 key（如 `QWEN_API_KEY`）
- 短信服务配置（`SMS_ENDPOINT` 等）
- 支付宝配置（`ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY`）

## 3) 启动

```bash
# 机器需已安装 Maven
mvn spring-boot:run
```

默认端口 `8081`。
