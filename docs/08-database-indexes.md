# 08 · 数据库索引清单（支付宝云）

> v1.0（2026-10-18）。索引不是"以后优化"，是**现在就建**——它是免费的，而不建只会让 App 越用越慢。
> 支付宝云从 2026-03-25 起内置库已切回**标准 MongoDB**，索引语法就是标准 MongoDB 那套。

---

## 1. 为什么必须建（一句话）

云数据库没有索引时，每次查询都要**把整张集合从头扫一遍**（全表扫描）。聊天页每 3 秒查一次消息，如果 `messages` 有一万条，这 3 秒里就要扫一万条——**一次聊天等于几百次全表扫描**，额度与响应时间都会崩。

建了索引之后，同一次查询只碰几行。

---

## 2. 怎么建（只在第一次做，10 分钟）

1. 打开 uniCloud 网页控制台 → 左边选 **云数据库** → 选 **`tongpin-dev`** 空间。
2. 左边列表里点中要建索引的**集合名**。
3. 上方切到 **「索引」** 标签页 → 点 **「新建索引」**。
4. 按下面表格填 **索引名** 与 **字段**，**顺序必须一致**（复合索引的字段顺序决定它能不能被用上）：
   - 唯一索引：把「唯一」开关打开。
   - 其余保持默认（非唯一、升序）。
5. 点确定。建索引很快，一般秒级完成。

> **重要的坑**：集合第一次被写入时才会出现。如果你在列表里找不到某个集合，说明还没发过那条数据——先按第 07 天清单的操作跑一遍业务（发消息、发卡片、申请等），集合就会自动出现。

---

## 3. 必须建的索引（按优先级排序）

### 🔴 P0 · 聊天链路（每 3 秒都在跑，不建必卡）

| 集合 | 索引名 | 字段（按顺序） | 唯一 | 为什么 |
|---|---|---|---|---|
| `messages` | `idx_conv_time` | `conversation_id` ↑, `created_at` ↑ | 否 | 聊天页每次轮询都按「会话 + 时间」拉新消息（`message-list` 第 105-110 行） |
| `messages` | `idx_conv_client` | `conversation_id` ↑, `client_msg_id` ↑ | 否 | 发送时判重，防同一条消息写两遍（`message-send` 第 80-83 行） |
| `conversation_members` | `idx_user_conv` | `user_id` ↑, `conversation_id` ↑ | 否 | 消息列表要一次查出「我参与的全部会话」；收发消息都要校验成员身份 |
| `conversations` | `idx_pair_key` | `user_pair_key` ↑ | 否 | **一对人全局只有一条会话**的判重依据（丙方案的核心约束） |

### 🟠 P1 · 搭子主链

| 集合 | 索引名 | 字段 | 唯一 | 为什么 |
|---|---|---|---|---|
| `cards` | `idx_status_type_time` | `status` ↑, `type` ↑, `created_at` ↓ | 否 | 大厅列表的主查询：按状态 + 类型筛、按时间排 |
| `cards` | `idx_owner_status` | `owner_id` ↑, `status` ↑ | 否 | 判断「我今天发了几条」（每日 5 条限额）、「我的卡片」 |
| `applications` | `idx_card_status` | `card_id` ↑, `status` ↑ | 否 | 详情页要列出这张卡的全部申请（含已同意） |
| `applications` | `idx_card_applicant` | `card_id` ↑, `applicant_id` ↑ | 否 | 防重复申请——文档型数据库没有「联合唯一约束」，只能靠这里查 + 云函数拦 |
| `buddy_relations` | `idx_user_a_status` | `user_a_id` ↑, `status` ↑ | 否 | 我的搭子列表（约定 `user_a_id < user_b_id`，所以两侧都要查） |
| `buddy_relations` | `idx_user_b_status` | `user_b_id` ↑, `status` ↑ | 否 | 同上，另一侧 |
| `buddy_relations` | `idx_pair_cat` | `user_a_id` ↑, `user_b_id` ↑, `category` ↑, `status` ↑ | 否 | 同一对人**同一类**搭子只能有一条 active 关系 |
| `buddy_invites` | `idx_to_status` | `to_user_id` ↑, `status` ↑ | 否 | 消息页「收到的邀请」区块 |
| `buddy_invites` | `idx_from_time` | `from_user_id` ↑, `created_at` ↓ | 否 | 24 小时内最多发 3 条邀请的限额判定 |

### 🟢 P2 · 其他（数据量小，但顺手建了不亏）

| 集合 | 索引名 | 字段 | 唯一 | 为什么 |
|---|---|---|---|---|
| `uni-id-users` | `idx_token` | `token` ↑ | 否 | **每个云函数的第一件事都是 `where({ token })` 找用户**，这是全项目调用次数最多的查询 |
| `uni-id-users` | `idx_phone` | `phone` ↑ | **是** | 注册查重、手机号登录。唯一索引顺便防同号注册两次 |
| `notifications` | `idx_user_time` | `to_user_id` ↑, `created_at` ↓ | 否 | 站内通知列表 |
| `user_tags` | `idx_user` | `user_id` ↑ | 否 | 匹配时取「我的标签」 |
| `user_tags` | `idx_tag` | `tag_id` ↑ | 否 | 按标签反查人（匹配候选集） |
| `verify_requests` | `idx_status_time` | `status` ↑, `created_at` ↑ | 否 | 管理员的待审队列（先到先审） |
| `tags` | `idx_category_active` | `category` ↑, `active` ↑ | 否 | 标签字典按分类分组显示 |
| `schools` | `idx_active` | `active` ↑ | 否 | 学校搜索只查启用的 |

> **`messages` 的 `idx_conv_time` 是最重要的一条**。如果只来得及建一个索引，就建它。

---

## 4. 建完怎么确认生效

1. 控制台该集合的「索引」页里能看到索引名，状态是「正常」。
2. 更硬的证据：在云函数日志里看慢查询。支付宝云的日志会标出耗时；建索引前后对比同一个聊天页的 `message-list` 耗时，通常从几十毫秒降到几毫秒。

---

## 5. 一个反直觉的点（答辩可能会被问）

Q：**为什么 `messages` 的 `_id` 不能当时间线用？**
A：云数据库的 `_id` 是**随机字符串**，不保证递增。所以「拉比某条更新的消息」不能用 `_id > lastId`，必须用 `created_at` 比较（`message-list` 第 92-110 行就是这么做的：先用 `_id` 查出那条的 `created_at` 当锚点，再按 `created_at` 过滤）。这也是为什么 `idx_conv_time` 的第二个字段必须是 `created_at`。

Q：**为什么不给 `conversation_id` 单独建一个索引？**
A：复合索引 `(conversation_id, created_at)` 的**最左前缀**就是 `conversation_id`，单查它也能走这个索引。单独再建一个纯属浪费写入性能。
