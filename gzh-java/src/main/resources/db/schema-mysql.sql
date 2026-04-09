SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS gzh
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gzh;

CREATE TABLE IF NOT EXISTS gzh_user (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    phone VARCHAR(32) NOT NULL COMMENT '手机号',
    display_name VARCHAR(64) NOT NULL DEFAULT '' COMMENT '显示名称',
    mp_account_name VARCHAR(128) NULL COMMENT '公众号名称(来自插件同步)',
    avatar_url VARCHAR(512) NULL COMMENT '头像地址',
    ai_model VARCHAR(32) NOT NULL DEFAULT 'qwen_3_5' COMMENT '当前 AI 模型',
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
    avg_read_time_sec INT NOT NULL DEFAULT 0 COMMENT '平均阅读时长(秒)',
    new_followers INT NOT NULL DEFAULT 0 COMMENT '新增关注',
    traffic_sources_json TEXT NULL COMMENT '流量来源JSON',
    traffic_source_rates_json TEXT NULL COMMENT '流量来源占比JSON',
    source_friend_count INT NOT NULL DEFAULT 0 COMMENT '来源-朋友圈',
    source_message_count INT NOT NULL DEFAULT 0 COMMENT '来源-公众号消息',
    source_recommend_count INT NOT NULL DEFAULT 0 COMMENT '来源-推荐',
    source_home_count INT NOT NULL DEFAULT 0 COMMENT '来源-公众号主页',
    source_chat_count INT NOT NULL DEFAULT 0 COMMENT '来源-聊天会话',
    source_search_count INT NOT NULL DEFAULT 0 COMMENT '来源-搜一搜',
    source_other_count INT NOT NULL DEFAULT 0 COMMENT '来源-其它',
    snapshot_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '快照时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    KEY idx_snapshot_user_article_time (user_id, article_id, snapshot_time),
    CONSTRAINT fk_snapshot_user FOREIGN KEY (user_id) REFERENCES gzh_user(id),
    CONSTRAINT fk_snapshot_article FOREIGN KEY (article_id) REFERENCES gzh_article(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文章快照表';

CREATE TABLE IF NOT EXISTS gzh_sync_issue_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    user_id BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
    sync_session_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '同步会话ID',
    issue_type VARCHAR(32) NOT NULL COMMENT '问题类型',
    stage VARCHAR(32) NOT NULL DEFAULT '' COMMENT '阶段',
    wx_article_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '微信文章ID',
    issue_code VARCHAR(64) NOT NULL DEFAULT '' COMMENT '问题码',
    issue_message VARCHAR(255) NOT NULL DEFAULT '' COMMENT '问题描述',
    details_json TEXT NULL COMMENT '补充信息JSON',
    event_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件发生时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记',
    PRIMARY KEY (id),
    KEY idx_sync_issue_user_time (user_id, event_time),
    KEY idx_sync_issue_session (user_id, sync_session_id, created_at),
    KEY idx_sync_issue_article (user_id, wx_article_id, created_at),
    CONSTRAINT fk_sync_issue_user FOREIGN KEY (user_id) REFERENCES gzh_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='同步异常日志表';

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

SET @gzh_user_display_name_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_user'
      AND COLUMN_NAME = 'display_name'
);
SET @gzh_user_display_name_sql = IF(
    @gzh_user_display_name_exists = 0,
    'ALTER TABLE gzh_user ADD COLUMN display_name VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''显示名称'' AFTER phone',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_user_display_name_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_user_avatar_url_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_user'
      AND COLUMN_NAME = 'avatar_url'
);
SET @gzh_user_avatar_url_sql = IF(
    @gzh_user_avatar_url_exists = 0,
    'ALTER TABLE gzh_user ADD COLUMN avatar_url VARCHAR(512) NULL COMMENT ''头像地址'' AFTER display_name',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_user_avatar_url_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_user_mp_account_name_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_user'
      AND COLUMN_NAME = 'mp_account_name'
);
SET @gzh_user_mp_account_name_sql = IF(
    @gzh_user_mp_account_name_exists = 0,
    'ALTER TABLE gzh_user ADD COLUMN mp_account_name VARCHAR(128) NULL COMMENT ''公众号名称(来自插件同步)'' AFTER display_name',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_user_mp_account_name_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

UPDATE gzh_user
SET display_name = CONCAT('公众号', RIGHT(phone, 4))
WHERE (display_name IS NULL OR TRIM(display_name) = '');

UPDATE gzh_user
SET mp_account_name = display_name
WHERE (mp_account_name IS NULL OR TRIM(mp_account_name) = '')
  AND display_name IS NOT NULL
  AND TRIM(display_name) <> '';

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

SET @gzh_snapshot_avg_read_time_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'avg_read_time_sec'
);
SET @gzh_snapshot_avg_read_time_sql = IF(
    @gzh_snapshot_avg_read_time_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN avg_read_time_sec INT NOT NULL DEFAULT 0 COMMENT ''平均阅读时长(秒)'' AFTER completion_rate',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_avg_read_time_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_traffic_source_rates_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'traffic_source_rates_json'
);
SET @gzh_snapshot_traffic_source_rates_sql = IF(
    @gzh_snapshot_traffic_source_rates_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN traffic_source_rates_json TEXT NULL COMMENT ''流量来源占比JSON'' AFTER traffic_sources_json',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_traffic_source_rates_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_source_friend_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'source_friend_count'
);
SET @gzh_snapshot_source_friend_sql = IF(
    @gzh_snapshot_source_friend_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN source_friend_count INT NOT NULL DEFAULT 0 COMMENT ''来源-朋友圈'' AFTER traffic_sources_json',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_source_friend_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_source_message_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'source_message_count'
);
SET @gzh_snapshot_source_message_sql = IF(
    @gzh_snapshot_source_message_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN source_message_count INT NOT NULL DEFAULT 0 COMMENT ''来源-公众号消息'' AFTER source_friend_count',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_source_message_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_source_recommend_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'source_recommend_count'
);
SET @gzh_snapshot_source_recommend_sql = IF(
    @gzh_snapshot_source_recommend_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN source_recommend_count INT NOT NULL DEFAULT 0 COMMENT ''来源-推荐'' AFTER source_message_count',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_source_recommend_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_source_home_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'source_home_count'
);
SET @gzh_snapshot_source_home_sql = IF(
    @gzh_snapshot_source_home_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN source_home_count INT NOT NULL DEFAULT 0 COMMENT ''来源-公众号主页'' AFTER source_recommend_count',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_source_home_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_source_chat_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'source_chat_count'
);
SET @gzh_snapshot_source_chat_sql = IF(
    @gzh_snapshot_source_chat_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN source_chat_count INT NOT NULL DEFAULT 0 COMMENT ''来源-聊天会话'' AFTER source_home_count',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_source_chat_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_source_search_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'source_search_count'
);
SET @gzh_snapshot_source_search_sql = IF(
    @gzh_snapshot_source_search_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN source_search_count INT NOT NULL DEFAULT 0 COMMENT ''来源-搜一搜'' AFTER source_chat_count',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_source_search_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

SET @gzh_snapshot_source_other_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'gzh_article_snapshot'
      AND COLUMN_NAME = 'source_other_count'
);
SET @gzh_snapshot_source_other_sql = IF(
    @gzh_snapshot_source_other_exists = 0,
    'ALTER TABLE gzh_article_snapshot ADD COLUMN source_other_count INT NOT NULL DEFAULT 0 COMMENT ''来源-其它'' AFTER source_search_count',
    'SELECT 1'
);
PREPARE gzh_stmt FROM @gzh_snapshot_source_other_sql;
EXECUTE gzh_stmt;
DEALLOCATE PREPARE gzh_stmt;

-- 合并 optimize.sql：补齐空值并统一历史流量来源口径
UPDATE gzh_article_snapshot
SET traffic_sources_json = '{}'
WHERE traffic_sources_json IS NULL
   OR TRIM(traffic_sources_json) = '';

UPDATE gzh_article_snapshot
SET traffic_sources_json = JSON_OBJECT(
    '朋友圈',
      COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"朋友圈\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"friend\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"fromfeed\"')) AS UNSIGNED), 0),
    '公众号消息',
      COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"公众号消息\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"message\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"subscription\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"frommsg\"')) AS UNSIGNED), 0),
    '推荐',
      COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"推荐\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"recommend\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"fromrecommend\"')) AS UNSIGNED), 0),
    '公众号主页',
      COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"公众号主页\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"主页\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"home\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"profile\"')) AS UNSIGNED), 0),
    '聊天会话',
      COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"聊天会话\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"聊天\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"chat\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"session\"')) AS UNSIGNED), 0),
    '搜一搜',
      COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"搜一搜\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"搜\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"search\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"fromsogou\"')) AS UNSIGNED), 0),
    '其它',
      COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"其它\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"其他\"')) AS UNSIGNED), 0)
    + COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"other\"')) AS UNSIGNED), 0)
)
WHERE deleted = 0
  AND JSON_VALID(traffic_sources_json) = 1;

UPDATE gzh_article_snapshot
SET source_friend_count = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"朋友圈\"')) AS UNSIGNED), 0),
    source_message_count = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"公众号消息\"')) AS UNSIGNED), 0),
    source_recommend_count = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"推荐\"')) AS UNSIGNED), 0),
    source_home_count = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"公众号主页\"')) AS UNSIGNED), 0),
    source_chat_count = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"聊天会话\"')) AS UNSIGNED), 0),
    source_search_count = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"搜一搜\"')) AS UNSIGNED), 0),
    source_other_count = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(traffic_sources_json, '$.\"其它\"')) AS UNSIGNED), 0)
WHERE deleted = 0
  AND JSON_VALID(traffic_sources_json) = 1;

SET FOREIGN_KEY_CHECKS = 1;
