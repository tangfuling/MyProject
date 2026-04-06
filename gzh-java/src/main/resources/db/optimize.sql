SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

USE gzh;

-- 1) 补齐空值，避免 JSON 解析失败
UPDATE gzh_article_snapshot
SET traffic_sources_json = '{}'
WHERE traffic_sources_json IS NULL
   OR TRIM(traffic_sources_json) = '';

-- 2) 统一历史流量来源口径到 7 个标准渠道：
--    朋友圈 / 公众号消息 / 推荐 / 公众号主页 / 聊天会话 / 搜一搜 / 其它
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

SET FOREIGN_KEY_CHECKS = 1;
