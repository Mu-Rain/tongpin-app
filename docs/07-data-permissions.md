# 07 · 数据权限与安全红线（答辩必看）

> v1.0（2026-10-18）：把「谁能读、谁能写、哪些字段永远不下发」一次性写清。
> 这份文档解决一个具体隐患：**如果某个集合的权限被设成"任何人可读"，配合"能按任意字段查询"，理论上可以把手机号、密码哈希一条条捞出来。**

---

## 1. 三句话讲清我们的权限模型

1. **所有写操作都只走云函数**，客户端对数据库**一律不可写**（DB Schema 的 `create / update / delete` 全为 `false`）。
2. **读操作也只走云函数**：客户端不直接 `db.collection(...).get()`，一律 `uniCloud.callFunction(...)`。
3. 因此**真正的权限闸门在云函数的代码里**：每个返回用户的云函数都有一份**字段白名单**（`USER_FIELDS` / `PUBLIC_FIELDS`），白名单之外的字段（`password`、`salt`、`token`、`phone`）永远不出云。

> 换句话说：我们把"表级权限"让位给"函数级白名单"。好处是控制最细；代价是**每加一个字段、每加一个返回用户的函数，都必须检查白名单**（踩坑记录第 8 条，第 7 天为此付过代价）。

---

## 2. 集合清单与风险分级

| 集合 | 存什么 | 敏感度 | 谁能读 | 谁能写 |
|---|---|---|---|---|
| `uni-id-users` | 账号、手机号、**密码哈希+salt**、信誉分、认证状态、`role`/`is_admin` | 🔴 极高 | **只有云函数**，且只返回白名单字段 | `user-register` / `verify-review` / `set-admin` 等 |
| `verify_requests` | 学生证照片 fileID、真实姓名、学号 | 🔴 极高 | **只有 `verify-review` 且校验 `is_admin`** | `verify-submit` / `verify-review` |
| `cards` | 搭子卡片（标题、描述、时间地点） | 🟡 中 | 云函数返回，**`owner_id` / `school_id` / `city_code` 外发前删除** | `card-publish` / `card-apply` |
| `applications` | 申请记录 | 🟡 中 | 只有卡片双方（`card-detail` 按身份分支） | `card-apply` |
| `conversations` / `conversation_members` | 会话与成员 | 🟡 中 | 只有成员（`message-*` 先查 `conversation_members`） | `card-apply` / `buddy-invite` |
| `messages` | 聊天内容 | 🔴 高 | 只有该会话成员 | `message-send` |
| `buddy_relations` | 搭子关系 + 标签 | 🟡 中 | **标签是私有备注，只下发「我给对方起的」那一侧** | `buddy-tag` / `buddy-invite` / `card-apply` |
| `buddy_invites` | 定向邀请 | 🟡 中 | 只有发起方与接收方 | `buddy-invite` |
| `schools` / `tags` | 学校名单、标签字典 | 🟢 低 | 公开 | 只有 `*-seed` |
| `notifications` | 站内通知 | 🟡 中 | 只有接收者 | 各业务函数 |

---

## 3. 「永远不下发」的字段（红名单）

以下字段**绝不能出现在任何云函数的返回值里**：

```
password        —— scrypt 哈希（格式 salt:hash）
salt            —— 若单独存放
token           —— 会话令牌
tokenExpire     —— 令牌有效期
phone           —— 手机号（只有在「切换账号」的账号簿里出现，且是用户自己的设备本地）
real_name       —— 真实姓名（只有 verify-review 给管理员看）
student_no      —— 学号（同上）
photo_file_id / chsi_file_id —— 证件原图（只有 verify-review 给管理员看临时链接）
```

### 核查方法（每次改完云函数跑一次）

```powershell
# 在 app 目录下执行，检查所有云函数的返回值里有没有 accidentally 带出敏感字段
Select-String -Path uniCloud-alipay\cloudfunctions\*\index.js -Pattern "password|salt|tokenExpire"
```

只应命中：`user-register`（写入时构造）、`user-login`（校验时读取）、`user-auto-login`、`user-me`、`user-tags`（后三个用于校验 `tokenExpire`）。**命中在 `return` / `data:` 附近就是漏洞。**

### ✅ 2026-10-18 实测结论：目前没有泄露

对全部 21 个碰用户表的云函数做了逐一核查，结果分两类：

**A. 只把用户对象当「内部变量」用，从不返回** —— 安全。
`buddy-invite` / `buddy-tag` / `card-apply` / `card-publish` / `message-send` / `user-auto-login` / `user-login` / `user-tags` / `migrate-pairkey` 都是 `where({ token })` 取到用户后只在内存里读 `_id` / 信誉分 / 角色，然后自己拼一个干净的返回对象。**这类不加 `.field()` 也不会泄露**，加了只是省流量。所以我没有改它们——避免为了"看起来规范"去动 9 个已经验收过的文件。

**B. 需要额外注意的（已核查，目前正确）**
- `user-me`：查出整行，但**返回值是手写的 12 个字段**，没有 `password` / `salt` / `token`。✅
- `verify-review`：5 处用户查询**全部带 `.field()` 白名单**，管理员也只能看到昵称/学校/认证状态。✅
- `verify-submit`：2 处查询都带 `.field()`。✅

**结论：真正的闸门是「返回时手写字段」，而不是「查询时投影字段」。** 以后新写云函数时：只要**不把查询到的 user 对象整个 return 出去**，就不会出事。

---

## 4. 越权校验必须在云函数里做（DB Schema 挡不住的）

DB Schema 的 `permission` 只能回答"这个集合能不能读写"，**不能回答"这一行该不该给这个人读"**。所以下面这些检查都在代码里：

| 检查 | 在哪 |
|---|---|
| 只有会话成员能读消息 | `message-list` / `message-send` 先查 `conversation_members` |
| 只有卡片双方能看申请记录 | `card-detail` 按 `is_mine` / `my_application` 分支组装 |
| 只有管理员能审核 | `verify-review` 第一行 `isAdmin` 闸门 |
| 只有关系当事人能改标签 | `buddy-tag` 校验 `relation.user_a_id / user_b_id` 含我 |
| 只有卡片发布者能同意申请 | `card-apply` accept 分支校验 `card.owner_id === me._id` |
| 已下架的卡片只有发布者能看 | `card-detail` 对 `status === 'removed'` 返回 403 |
| 别人的信誉分只给区间 | `user-profile` 的 `creditBand()` 返回「极好/很好/良好/一般/较低」，不给精确数字 |

---

## 5. 三个仍在的技术债（心里有数，答辩时主动说）

1. **令牌是存在用户文档里的裸 token**，不是 JWT，没有签名校验。安全性依赖"只有云函数能读库"。以后可换 `uni-id` 的标准方案。
2. **证件原图不自动删除**。计划是"认证通过后 30 天清理"，但定时清理需要触发器，本期未做。目前只有管理员能拿到临时链接。
3. **同意申请时的 5 个连锁写操作没有包事务**（`db.startTransaction`）。当前是顺序执行 + 每步校验，单人演示足够；并发量上来必须改。

---

## 6. 一条自查命令（改完任何云函数都跑）

```powershell
$node = "C:\Users\lenov\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
Get-ChildItem uniCloud-alipay\cloudfunctions\*\index.js | ForEach-Object {
  & $node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { Write-Output ("FAIL: " + $_.FullName) }
}
```
