SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS gzh
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gzh;

CREATE TABLE IF NOT EXISTS gzh_user (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    phone VARCHAR(32) NOT NULL COMMENT '手机号',
    ai_model VARCHAR(32) NOT NULL DEFAULT 'qwen' COMMENT '当前 AI 模型',
    balance_cent INT NOT NULL DEFAULT 0 COMMENT '余额(分)',
    free_quota_cent INT NOT NULL DEFAULT 100 COMMENT '免费额度(分)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    UNIQUE KEY uk_user_phone (phone),
    KEY idx_user_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

CREATE TABLE IF NOT EXISTS gzh_article (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    wx_article_id VARCHAR(128) NOT NULL COMMENT '微信文章ID',
    title VARCHAR(512) NOT NULL COMMENT '标题',
    content LONGTEXT NULL COMMENT '文章全文',
    word_count INT NOT NULL DEFAULT 0 COMMENT '字数',
    publish_time DATETIME NOT NULL COMMENT '发布时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    UNIQUE KEY uk_user_wx_article (user_id, wx_article_id),
    KEY idx_article_user_publish (user_id, publish_time),
    CONSTRAINT fk_article_user FOREIGN KEY (user_id) REFERENCES gzh_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文章表';

CREATE TABLE IF NOT EXISTS gzh_article_snapshot (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    article_id BIGINT UNSIGNED NOT NULL COMMENT '文章ID',
    wx_article_id VARCHAR(128) NOT NULL COMMENT '微信文章ID',
    read_count INT NOT NULL DEFAULT 0 COMMENT '阅读数',
    send_count INT NOT NULL DEFAULT 0 COMMENT '送达人数',
    share_count INT NOT NULL DEFAULT 0 COMMENT '分享数',
    like_count INT NOT NULL DEFAULT 0 COMMENT '点赞数',
    wow_count INT NOT NULL DEFAULT 0 COMMENT '在看数',
    comment_count INT NOT NULL DEFAULT 0 COMMENT '评论数',
    save_count INT NOT NULL DEFAULT 0 COMMENT '收藏数',
    completion_rate DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT '完读率',
    new_followers INT NOT NULL DEFAULT 0 COMMENT '新增关注',
    traffic_sources_json TEXT NULL COMMENT '流量来源JSON',
    snapshot_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '快照时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    KEY idx_snapshot_user_article_time (user_id, article_id, snapshot_time),
    CONSTRAINT fk_snapshot_user FOREIGN KEY (user_id) REFERENCES gzh_user(id),
    CONSTRAINT fk_snapshot_article FOREIGN KEY (article_id) REFERENCES gzh_article(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文章快照表';

CREATE TABLE IF NOT EXISTS gzh_analysis_report (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    range_code VARCHAR(16) NOT NULL COMMENT '分析范围',
    article_count INT NOT NULL DEFAULT 0 COMMENT '分析文章数',
    input_tokens INT NOT NULL DEFAULT 0 COMMENT '输入tokens',
    output_tokens INT NOT NULL DEFAULT 0 COMMENT '输出tokens',
    cost_cent INT NOT NULL DEFAULT 0 COMMENT '费用(分)',
    ai_model VARCHAR(32) NOT NULL COMMENT 'AI模型',
    content LONGTEXT NULL COMMENT '报告内容',
    suggested_questions_json TEXT NULL COMMENT '推荐问题JSON',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    KEY idx_report_user_created (user_id, created_at),
    CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES gzh_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分析报告表';

CREATE TABLE IF NOT EXISTS gzh_chat_message (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    session_id VARCHAR(64) NOT NULL COMMENT '会话ID',
    report_id BIGINT UNSIGNED NULL COMMENT '关联报告ID',
    role VARCHAR(16) NOT NULL COMMENT '角色(user/assistant)',
    content LONGTEXT NOT NULL COMMENT '消息内容',
    ai_model VARCHAR(32) NULL COMMENT '回复模型',
    input_tokens INT NOT NULL DEFAULT 0 COMMENT '输入tokens',
    output_tokens INT NOT NULL DEFAULT 0 COMMENT '输出tokens',
    cost_cent INT NOT NULL DEFAULT 0 COMMENT '费用(分)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    KEY idx_chat_user_session (user_id, session_id, created_at),
    KEY idx_chat_report_id (report_id),
    CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES gzh_user(id),
    CONSTRAINT fk_chat_report FOREIGN KEY (report_id) REFERENCES gzh_analysis_report(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对话消息表';

CREATE TABLE IF NOT EXISTS gzh_token_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    biz_type VARCHAR(16) NOT NULL COMMENT '业务类型(chat/analysis)',
    biz_id VARCHAR(64) NOT NULL COMMENT '业务ID',
    ai_model VARCHAR(32) NOT NULL COMMENT 'AI模型',
    input_tokens INT NOT NULL DEFAULT 0 COMMENT '输入tokens',
    output_tokens INT NOT NULL DEFAULT 0 COMMENT '输出tokens',
    cost_cent INT NOT NULL DEFAULT 0 COMMENT '费用(分)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    KEY idx_token_user_created (user_id, created_at),
    CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES gzh_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='token消费记录表';

CREATE TABLE IF NOT EXISTS gzh_payment_order (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    order_no VARCHAR(64) NOT NULL COMMENT '订单号',
    amount_cent INT NOT NULL COMMENT '充值金额(分)',
    channel VARCHAR(32) NOT NULL DEFAULT 'alipay' COMMENT '支付渠道',
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT '订单状态',
    subject VARCHAR(128) NOT NULL COMMENT '订单标题',
    pay_url TEXT NULL COMMENT '支付链接',
    alipay_trade_no VARCHAR(64) NULL COMMENT '支付宝交易号',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    UNIQUE KEY uk_order_no (order_no),
    KEY idx_payment_user_created (user_id, created_at),
    CONSTRAINT fk_payment_user FOREIGN KEY (user_id) REFERENCES gzh_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付订单表';

SET @gzh_payment_order_channel_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_payment_order'
      AND COLUMN_NAME = 'channel'
);
SET @gzh_payment_order_channel_sql = IF(
    @gzh_payment_order_channel_exists = 0,
    'ALTER TABLE gzh_payment_order ADD COLUMN channel VARCHAR(32) NOT NULL DEFAULT ''alipay'' COMMENT ''支付渠道'' AFTER amount_cent',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_payment_order_channel_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_send_count_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'send_count'
);
SET @gzh_snapshot_send_count_sql = IF(
    @gzh_snapshot_send_count_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN send_count INT NOT NULL DEFAULT 0 COMMENT ''送达人数'' AFTER read_count',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_send_count_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET FOREIGN_KEY_CHECKS = 1;
