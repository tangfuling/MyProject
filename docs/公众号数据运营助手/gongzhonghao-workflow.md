# 公众号后台接口指南

## 鉴权方式

所有后台接口需要两样东西（从浏览器抓包获取）：

1. **token** — URL参数中的 `token=xxx`，登录session级别，过期需重新登录获取
2. **cookies** — 完整cookie字符串，从 `-b '...'` 或 `-H 'cookie: ...'` 中提取

> 用户提供任意一个微信后台请求的curl命令即可提取以上信息。

---

## 一、获取已发布文章列表

**接口**: `/cgi-bin/appmsgpublish`

```
GET https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=10&token={token}&lang=zh_CN
```

| 参数 | 说明 |
|------|------|
| sub | 固定 `list` |
| begin | 分页起始偏移，0开始 |
| count | 每页数量，最大10 |
| token | session token |

**响应**: HTML页面，需从中提取已发布文章的列表数据。

---

## 二、获取草稿箱文章列表

**接口**: `/cgi-bin/appmsg`

```
GET https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token={token}&lang=zh_CN&f=json
```

| 参数 | 说明 |
|------|------|
| type | 固定 `77`（草稿箱类型） |
| action | 固定 `list_card` |
| begin | 分页起始偏移，0开始 |
| count | 每页数量，最大10 |
| f | 设为 `json` 返回JSON格式 |
| token | session token |

**关键请求头**（必须加，否则返回HTML而非JSON）:
```
x-requested-with: XMLHttpRequest
accept: application/json
```

**响应结构**（JSON）:
```json
{
  "app_msg_info": {
    "file_cnt": {
      "draft_count": 9,        // 草稿总数
      "app_msg_sent_cnt": 23   // 已发布总数
    },
    "item": [
      {
        "app_id": 100000236,          // 文章ID（用于获取内容）
        "title": "文章标题",
        "create_time": "1772868769",  // 创建时间戳
        "data_seq": "...",
        "multi_item": [
          {
            "title": "文章标题",
            "digest": "摘要",
            "author": "作者",
            "cover": "封面图URL",
            "cdn_url": "封面CDN URL"
          }
        ]
      }
    ]
  }
}
```

> **分页**: 修改 `begin` 参数（0, 10, 20...）遍历所有草稿。

---

## 三、获取单篇文章内容

### 方式A：草稿箱文章（通过编辑页面）

**接口**: `/cgi-bin/appmsg`（编辑页面）

```
GET https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&share=1&appmsgid={app_id}&token={token}&lang=zh_CN
```

| 参数 | 说明 |
|------|------|
| t | 固定 `media/appmsg_edit_v2` |
| action | 固定 `edit` |
| type | 固定 `77` |
| appmsgid | 从草稿列表获取的 `app_id` |
| token | session token |

**响应**: HTML页面，文章内容嵌在页面JS的JSON数据中。

**内容提取方法**:
```python
import re, json, html

with open("draft_page.html", "r") as f:
    raw = f.read()

# 提取title（JSON编码的字符串）
title_match = re.search(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
title = json.loads('"' + title_match.group(1) + '"')

# 提取content（HTML编码后再JSON编码的字符串）
content_match = re.search(r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
content_html = json.loads('"' + content_match.group(1) + '"')
content_html = html.unescape(content_html)  # 反转HTML实体

# content_html 就是文章的富文本HTML
```

### 方式B：已发布文章（通过公开URL）

```
GET https://mp.weixin.qq.com/s/{article_id}
```

带cookies请求，从返回的HTML中提取：
- **标题**: `var msg_title = '...'`
- **mid**: `var mid = "..."`（用于拉数据）
- **发布时间戳**: `var ct = "..."`（转为 `YYYY-MM-DD`）
- **正文**: `id="js_content"` 内的HTML内容

---

## 四、获取单篇文章阅读数据

**接口**: `/misc/appmsganalysis`

```
GET https://mp.weixin.qq.com/misc/appmsganalysis?action=detailpage&msgid={mid}_1&publish_date={YYYY-MM-DD}&type=int&pageVersion=1&token={token}&lang=zh_CN
```

| 参数 | 说明 |
|------|------|
| action | 固定 `detailpage` |
| msgid | 文章mid + `_1`（从文章页面的 `var mid` 获取） |
| publish_date | 发布日期 `YYYY-MM-DD`（从 `var ct` 时间戳转换） |
| token | session token |

**响应**: HTML页面，数据嵌在JS变量中，需提取以下变量：

### articleData — 核心阅读指标

| 字段 | 含义 |
|------|------|
| article_data_new.read_uv | 阅读人数 |
| article_data_new.share_uv | 分享人数 |
| article_data_new.collection_uv | 收藏人数 |
| article_data_new.like_cnt | 点赞数 |
| article_data_new.zaikan_cnt | 在看数 |
| article_data_new.comment_cnt | 评论数 |
| article_data_new.finished_read_pv_ratio | 完读率（×100%） |
| article_data_new.avg_article_read_time | 平均阅读时长（秒） |
| article_data_new.follow_after_read_uv | 阅读后关注数 |
| subs_transform.send_uv | 送达人数 |

### articleSummaryData — 阅读来源分布

按 scene 字段区分来源：

| scene | 含义 | 统计归类 |
|-------|------|----------|
| 0 | 公众号消息 | 公众号消息 |
| 1 | 聊天会话 | 好友转发 |
| 2 | 朋友圈 | 朋友圈 |
| 4 | 公众号主页 | 其他（合并） |
| 5 | 其它 | 其他（合并） |
| 6 | 推荐 | 推荐 |
| 7 | 搜一搜 | 其他（合并） |
| 9999 | 全部/当日总计 | 跳过 |

> 合并规则：其他 = scene 4 + scene 5 + scene 7
> 推荐占比 = scene6 / 所有scene总量（不含9999）
> 朋友圈占比 = scene2 / 所有scene总量（不含9999）

### detailData — 用户画像

包含年龄分布、性别分布、地域分布。

---

## 五、内容分析报告

**接口**: `/misc/appmsganalysis`

```
GET https://mp.weixin.qq.com/misc/appmsganalysis?action=report&type=daily_v2&token={token}&lang=zh_CN
```

返回整体内容分析数据（非单篇）。

---

## 关键URL汇总

| 功能 | URL模式 | 鉴权 |
|------|---------|------|
| 已发布列表 | `/cgi-bin/appmsgpublish?sub=list&begin=0&count=10&token={token}` | cookies + token |
| 草稿箱列表 | `/cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&f=json&token={token}` | cookies + token + XHR头 |
| 草稿内容 | `/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=77&appmsgid={app_id}&token={token}` | cookies + token |
| 已发布文章 | `/s/{article_id}` | cookies |
| 单篇数据 | `/misc/appmsganalysis?action=detailpage&msgid={mid}_1&publish_date={date}&token={token}` | cookies + token |
| 内容分析 | `/misc/appmsganalysis?action=report&type=daily_v2&token={token}` | cookies + token |

---

## 文件输出规范

### 草稿文章
- 路径: `gongzhonghao/Draft/{标题}.md`
- 格式: Markdown（从HTML转换，保留图片链接）

### 已发布文章
- 路径: `gongzhonghao/Published/{YYYY-MM-DD}-{标题}.md`
- 格式: 标题 + 发布日期 + 公众号名 + 原文链接 + 数据统计表 + 正文

### 运营数据统计
- 路径: `gongzhonghao/Published/公众号文章运营数据统计.md`
- 每篇文章插入到总览表第1行（序号+1），同步更新阅读来源表和详细数据部分
