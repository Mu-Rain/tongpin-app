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
| `credit_events` | `idx_user_time` | `user_id` ↑, `created_at` ↓ | 否 | 信誉分明细页的主查询：我的流水按时间倒序翻页 |
| `credit_rules` | `idx_code` | `code` ↑ | **是** | 按 reason_code 查分值。唯一键防止同一个 code 配出两条不同分值，云函数随机命中 |
| `user_titles` | `idx_user_title` | `user_id` ↑, `title_id` ↑ | **是** | 发称号前查「有没有过」+ 佩戴前查「获得过没有」。唯一键同时是**防重复发**的最后一道闸（并发进页面时后到那次被挡） |
| `user_titles` | `idx_user` | `user_id` ↑ | 否 | 称号墙一次拉该用户全部已获得 |
| `titles` | `idx_code` | `code` ↑ | **是** | 按 code 查名字/文案；唯一键防止同一个 code 配出两条 |
| `encyclopedia` | `idx_publish_date` | `publish_date` ↑ | **是** | 「一天一条」的唯一真相。首页每天取今天那条靠它命中；唯一键防止同一日期灌出两条互相打架的百科 |

### 🟢 P2 · 其他（数据量小，但顺手建了不亏）

| 集合 | 索引名 | 字段 | 唯一 | 为什么 |
|---|---|---|---|---|
| `uni-id-users` | `idx_token` | `token` ↑ | 否 | **每个云函数的第一件事都是 `where({ token })` 找用户**，这是全项目调用次数最多的查询 |
| `uni-id-users` | `idx_uid` | `uid` ↑ | **是** | 8 位数字的对外唯一身份号，加好友时唯一的搜索键。唯一索引是「不撞号」的最终裁决者，注册写入撞了就换号重试 |
| `uni-id-users` | `idx_phone` | `phone` ↑ | 否 | 手机号**只是登录凭据**，不再对外搜索，所以取消唯一约束；保留普通索引是因为每次登录都要 `where({ phone })`，没索引就是全表扫 |
| `notifications` | `idx_user_time` | `user_id` ↑, `created_at` ↓ | 否 | 站内通知列表。**字段名是 `user_id` 不是 `to_user_id`**：`card-apply` 第 137-145 行写入的就是 `user_id`，docs/03 第 213 行同口径；照旧名建索引等于建在空字段上 |
| `user_tags` | `idx_user` | `user_id` ↑ | 否 | 匹配时取「我的标签」 |
| `user_tags` | `idx_tag` | `tag_id` ↑ | 否 | 按标签反查人（匹配候选集） |
| `verify_requests` | `idx_status_time` | `status` ↑, `created_at` ↑ | 否 | 管理员的待审队列（先到先审） |
| `tags` | `idx_category_active` | `category` ↑, `active` ↑ | 否 | 标签字典按分类分组显示 |
| `schools` | `idx_active` | `active` ↑ | 否 | 学校搜索只查启用的 |

### 🟣 P1.5 · 好友、匹配与备注（2026-10-19 / 10-21 新增，均为新集合）

> 这几个集合是好友、匹配、备注功能上线时才加的，**第一次写入才会出现在控制台列表里**——先跑一遍「加好友 → 同意」「一键匹配」「设置一个备注」再回来建。

| 集合 | 索引名 | 字段 | 唯一 | 为什么 |
|---|---|---|---|---|
| `friendships` | `idx_pair` | `user_a_id` ↑, `user_b_id` ↑ | **是** | 好友唯一性键。约定 `user_a_id < user_b_id`，落库前用 orderPair() 排序，所以这一条唯一索引就能挡住「同一对好友存两条」 |
| `friendships` | `idx_user_a` | `user_a_id` ↑ | 否 | `friend-list` 与 `message-conversations` 都按「我作为 a」查一遍（**不能合并成 or**，原因见本小节末尾） |
| `friendships` | `idx_user_b` | `user_b_id` ↑ | 否 | 同上，另一侧 |
| `friend_unlinks` | `idx_pair` | `user_a_id` ↑, `user_b_id` ↑ | **是（可选兜底）** | 一对人只该有一行解除记录。**正确性不依赖它**：`saveUnlink` 已改成「读全部行 → 保留最早一行 → 删掉多出来的」，没建索引也不会留下重复行；这条唯一索引只是让并发写直接报错、少一次收敛动作，**建与不建功能都正确** |
| `friend_unlinks` | `idx_a` | `user_a_id` ↑ | 否 | `message-conversations` 建 `unlinkSet` 时按「我作为 a 侧」批量查 |
| `friend_unlinks` | `idx_b` | `user_b_id` ↑ | 否 | 同上，另一侧（`user-profile` 用 pair 精确查，走 `idx_pair`） |
| `friend_requests` | `idx_to_status` | `to_user_id` ↑, `status` ↑ | 否 | 好友页「待处理 N」角标就是这条：`where({to_user_id, status:'pending'}).count()` |
| `friend_requests` | `idx_from_status` | `from_user_id` ↑, `status` ↑ | 否 | 「我发出去的申请」列表；也是发申请前的重复 pending 判重 |
| `matches` | `idx_user_time` | `user_id` ↑, `created_at` ↓ | 否 | 一键匹配每次写一条，用来排除「已匹配过的卡片」 |
| `user_remarks` | `idx_owner_target` | `owner_id` ↑, `target_user_id` ↑ | **是** | 用户名备注的逻辑唯一键：一个人给同一个人只该有一条备注。唯一索引能挡住并发下的重复行（`user-remark` 的 upsert 是「先 get 查有无旧行，再 add 或 update」，**不能靠 update 返回的 updated 条数判断**：把备注改成同值会得到 updated=0，会被误判成没有旧行而再 add 一条。唯一索引是这条逻辑的最后一道保险） |

### 🟣 P1.6 · 黑名单与举报（2026-10-22 新增，均为新集合）

> `user_blocks` 与 `reports` 同样是**第一次写入才出现在控制台**——先在主页拉黑一个人、再举报一条，然后回来建索引。

| 集合 | 索引名 | 字段 | 唯一 | 为什么 |
|---|---|---|---|---|
| `user_blocks` | `idx_owner_target` | `owner_id` ↑, `target_id` ↑ | **是** | 拉黑逻辑唯一键。`user-block` 的 add 是「先 get 查有无旧行，再 add」，并发下仍可能插两条，唯一索引是最后一道保险 |
| `user_blocks` | `idx_target` | `target_id` ↑ | 否 | 判断「**他拉黑了我**」只能按 target 查：`message-send` 每次发消息都要查一次，`user-profile` 的 `blocked_me` 也走这条 |
| `user_blocks` | `idx_owner` | `owner_id` ↑ | 否 | `message-conversations` 每次拉会话列表都要 `where({owner_id:我}).limit(200)` 收 blockSet，不建就是全表扫 |
| `reports` | `idx_reporter_target` | `reporter_id` ↑, `target_type` ↑, `target_id` ↑ | **是** | 「同一个人对同一个对象只能举报一次」的唯一键。`report-submit` 写库前先 get 查重，唯一索引兜底 |
| `reports` | `idx_status_time` | `status` ↑, `created_at` ↓ | 否 | 后台待处理列表（本期无后台页，先建着不亏） |

> **为什么 `user_blocks` 要三个索引**：这个表被三个方向读——「我拉黑了谁」（owner）、「谁拉黑了我」（target）、「我拉黑他和没」（owner+target 精确查）。少任何一个都有一次查询会退化成全表扫，而 `message-send` 是每条消息都跑的。

> **为什么好友要分两次查而不是用 or**：`or([{user_a_id:我},{user_b_id:我}])` 一旦字段写反，陌生人会被当成好友，界面直接给出错误的操作按钮。分两次查各有索引兜底，代价只是多一次查询。

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
