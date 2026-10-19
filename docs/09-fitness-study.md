# 09 · 健身 / 学习板块设计（v1.0）

> 本文档定义健身与学习两块的数据模型与分层策略。
> **核心约束（2026-10-18，用户定）**：这两块的内容深度要对标「训记」，但**界面先做轻量**。
> 所以文档的重点不是"这期做多少"，而是"这期不做的东西，以后能不能直接长出来"。

---

## 0. 一句话原则

> **表结构一次做到位，界面分期往上加。**

界面上少画几个按钮，代价是零；表结构少存一个字段，代价是**用户已有的数据没法升级**——只能清空重来。所以每一张表都按"训记级"的最终形态设计，只是这一期的页面只读其中一部分字段。

---

## 1. 分层：这一期做什么、不做什么

### 1.1 健身（M · MVP 层）

| 能力 | 这一期 | 说明 |
|---|---|---|
| 动作库（按肌群 / 器械 / 关键词浏览） | ✅ 做 | 录 60–80 个覆盖主要肌群的动作，**不做图**，用分类色块 + 文字代替 |
| 官方计划模板（点开套用） | ✅ 做 | 录 5 套经典计划（胸背腿三分化 / 上肢下肢二分化 / 新手全身 / 减脂有氧 / 拉伸恢复） |
| 开始训练 → 逐个动作记组 | ✅ 做 | 这是「训记」的立身之本，缺了就不像 |
| 结束训练 + 打卡日历 | ✅ 做 | 月历高亮已训练日 + 连续天数 |
| 每组重量 / 次数 / 组间休息秒数 | ✅ **存**，界面简显示 | 存了才能算容量和 PR |
| 容量统计 / 部位占比 / PR 曲线 | ❌ 本期不做 | 数据已经在库里，以后纯前端加起来 |
| 人体肌肉分布图 | ❌ 不做 | 要图 |
| 饮食记录（蛋白/碳水/脂肪/水） | ❌ 不做 | 与健身主链无关 |
| 挑战 / 排行榜 / 朋友动态 | ❌ 不做 | 社交玩法 |
| 自定义动作、自定义计划编排 | ❌ 不做 | 表结构已支持（`source: 'custom'`），只差页面 |

### 1.2 学习（番茄钟 + 学习搭子复用大厅）

| 能力 | 这一期 | 说明 |
|---|---|---|
| 番茄钟（预设 15/25/45/60 + 自定义 1-180 分钟） | ✅ 做 | 一个能跑完整轮的计时器 |
| 每轮番茄写一条 `study_pomodoros` | ✅ 做 | 存了才能算"今天专注了几轮、共几分钟" |
| 今日专注次数/分钟、本周柱状 | ✅ 做 | 轻量统计 |
| 学习搭子 | ✅ 已有 | 复用搭子大厅的 `study` 类型筛选，不重复造 |
| 科目分类、白噪音、自习排行、资料共享 | ❌ 不做 | 资料共享本来就在砍单第 1 位 |

---

## 2. 集合设计（五张健身表 + 一张学习表）

> 命名前缀 `fit_` / `study_`，与搭子那套表彻底分开——这两块以后可能被单独抽走，不能和社交表纠缠。
> 所有表 **DB Schema 的 create/update/delete 一律 false**，只允许云函数写（延续 03 文档的红线）。

### 2.1 `fit_exercises` · 动作库

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 固定英文 id，如 `bench_press`，方便种子幂等 |
| `name` | string | 中文名，如「杠铃卧推」 |
| `alias` | array\<string\> | 别名/俗称，搜索用，如 `['卧推','平板卧推']` |
| `muscle` | string | **主练肌群**（枚举见 §2.6），列表左栏按它分组 |
| `muscle_sub` | string | 细分部位，如「中下胸」「前束」。可为空 |
| `equipment` | string | 器械（枚举见 §2.6），列表顶部按它分栏 |
| `mechanics` | string | `compound` 复合 / `isolation` 孤立 |
| `force` | string | `push` 推 / `pull` 拉 / `static` 静力 |
| `level` | string | `beginner` / `intermediate` / `advanced` |
| `default_sets` | number | 建议组数（默认套用值） |
| `default_reps` | string | 建议次数区间，如 `'8-12'`（**用字符串**，因为"8-12"和"力竭"都合法） |
| `default_rest` | number | 建议组间休息秒数 |
| `tip` | string | 一句动作要领（≤60 字） |
| `secondary` | array\<string\> | 辅助肌群 |
| `is_custom` | bool | 是否用户自建（本期全 false，字段预留） |
| `owner_id` | string | 自建动作用（本期空串） |
| `active` | bool | 下架用 |
| `sort` | number | 同肌群内的展示顺序 |
| `created_at` | number | |

索引：`(muscle, sort)`、`(equipment, sort)`、`(active)`

**为什么 `default_reps` 用字符串**：训记这类软件的真实世界里，次数是「8-12 次」「力竭」「30 秒」「20 米」这类东西，用 int 会逼着以后改表。

### 2.2 `fit_plans` · 训练计划（模板与个人计划共用一张表）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 模板用固定 id（如 `tpl_ppl_beginner`），个人计划用自动 id |
| `name` | string | 计划名，如「新手全身三分化」 |
| `goal` | string | `muscle` 增肌 / `fat_loss` 减脂 / `shaping` 塑形 / `stretch` 拉伸 / `strength` 力量 |
| `level` | string | 同动作的 level |
| `days_per_week` | number | 每周几练 |
| `duration_weeks` | number | 周期（周），0 表示不限期 |
| `source` | string | `official` 官方模板 / `custom` 用户自建 |
| `owner_id` | string | 官方模板为空串 |
| `desc` | string | 一句话介绍 |
| `cover_color` | string | 卡片底色（**不做图**，用色块区分） |
| `tags` | array\<string\> | 展示用标签，如 `['男性','减脂']` |
| `active` | bool | |
| `sort` | number | |
| `created_at` | number | |

索引：`(source, active, sort)`、`(owner_id)`

### 2.3 `fit_plan_items` · 计划里的一条动作

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | |
| `plan_id` | string | |
| `day_index` | number | 第几个训练日（1 起）。单日计划固定为 1 |
| `day_name` | string | 训练日名，如「推日」「A 日」。单日计划为空串 |
| `exercise_id` | string | 指向 `fit_exercises._id` |
| `exercise_name` | string | **冗余**动作名（动作库改名后历史计划不受影响） |
| `sets` | number | 组数 |
| `reps` | string | 次数，字符串，同 §2.1 |
| `rest` | number | 组间休息秒 |
| `sort` | number | |

索引：`(plan_id, day_index, sort)`

> **为什么冗余 `exercise_name`**：文档型数据库不能 join；更重要的是——动作库里的「深蹲」以后可能改名或下架，用户三个月前的训练记录不该跟着变。

### 2.4 `fit_sessions` · 一次训练（打卡单位）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | |
| `user_id` | string | |
| `plan_id` | string | 从计划开始则记录，自由训练为空串 |
| `plan_name` | string | 冗余 |
| `log_date` | string | `YYYY-MM-DD`，**"一天一次"的唯一约束靠它**（沿用 03 文档 §2.6 的约定：日期用字符串不用时间戳） |
| `started_at` | number | ms |
| `finished_at` | number | ms，进行中为 0 |
| `duration_sec` | number | 训练时长（结束时算好存下，避免以后每次重算） |
| `total_sets` | number | 总组数（结束时汇总） |
| `total_volume` | number | **总容量 = Σ(重量 × 次数)**（kg），训练量统计的地基 |
| `muscles` | array\<string\> | 这次练到的肌群去重列表（部位概览用） |
| `note` | string | 训练笔记 |
| `status` | string | `ongoing` 进行中 / `done` 已完成 / `abandoned` 放弃 |
| `created_at` / `updated_at` | number | |

索引：`(user_id, log_date)`、`(user_id, status)`、`(user_id, started_at desc)`

> **重点**：`total_volume` 和 `muscles` 是**冗余汇总字段**。以后做"周容量趋势""部位占比"时，一次查询就能出图，不用把几千条 set 明细全捞出来算。这是训记那类软件能秒开的根本原因。

### 2.5 `fit_sets` · 一组记录（最细的颗粒）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | |
| `session_id` | string | 属于哪次训练 |
| `user_id` | string | 冗余，便于"这个动作我历史最好成绩"直接查 |
| `exercise_id` | string | |
| `exercise_name` | string | 冗余 |
| `muscle` | string | 冗余主练肌群（部位统计免 join） |
| `set_index` | number | 第几组（1 起） |
| `weight` | number | 重量 kg，自重动作为 0 |
| `reps` | number | 次数 |
| `rest_sec` | number | 这组之后休息了几秒（可为 0/空） |
| `is_warmup` | bool | 是否热身组（**不算进容量和 PR**） |
| `is_pr` | bool | 写入时判定是否刷新该动作最大重量 |
| `est_1rm` | number | 估算 1RM = `weight × (1 + reps/30)`（Epley），空手为 0 |
| `done_at` | number | |
| `created_at` | number | |

索引：`(session_id, exercise_id, set_index)`、`(user_id, exercise_id, weight desc)`

> **`est_1rm` 现在存下来**：以后做 PR 曲线、RM 计算器（训记「我的」页里那个）直接读，不用回算。用 Epley 公式是因为它对 reps ≤ 12 足够准，且一行代码就能算。

### 2.6 枚举（前后端必须一致）

```js
// 肌群（列表左栏顺序，与训记的归类一致）
MUSCLES = [
  'chest',      // 胸
  'back',       // 背
  'shoulder',   // 肩
  'biceps',     // 二头
  'triceps',    // 三头
  'legs',       // 腿
  'glutes',     // 臀
  'core',       // 核心
  'forearm',    // 前臂
  'calf',       // 小腿
  'cardio',     // 有氧
  'stretch'     // 拉伸
]

// 器械（列表顶部栏顺序）
EQUIPMENTS = [
  'barbell',    // 杠铃
  'dumbbell',   // 哑铃
  'machine',    // 器械
  'cable',      // 绳索
  'bodyweight', // 自重
  'kettlebell', // 壶铃
  'band',       // 弹力带
  'other'       // 其他（有氧 / 拉伸）
]
```

### 2.7 `study_pomodoros` · 番茄钟记录

> 命名用 `study_` 前缀而不是文档里原来的 `pomodoro_sessions`，理由：和健身那套保持一致的命名空间隔离。

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | |
| `user_id` | string | |
| `minutes` | number | 这一轮设定的分钟数（25 / 45 / 自定义） |
| `started_at` | number | ms |
| `finished_at` | number | ms |
| `completed` | bool | 是否跑完（中途放弃 = false，**仍然存**，用于算完成率） |
| `subject` | string | 学科（可空，本期界面不做但字段留着） |
| `log_date` | string | `YYYY-MM-DD`，按天汇总用 |
| `created_at` | number | |

索引：`(user_id, log_date)`、`(user_id, started_at desc)`

---

## 3. 云函数清单

| 云函数 | action | 说明 |
|---|---|---|
| `fit-exercise` | `list` / `detail` | 动作库查询。`list` 支持 `muscle` / `equipment` / `keyword` 过滤 |
| `fit-seed` | — | **一次性灌数据**（管理员），写入动作库 + 官方模板，幂等 |
| `fit-plan` | `list` / `detail` | 计划列表 / 计划详情（带动作明细，按训练日分组） |
| `fit-session` | `start` / `addSet` / `delSet` / `finish` / `list` / `detail` / `stats` | 训练会话主链路 |
| `study-pomodoro` | `record` / `stats` | 番茄钟写入 / 统计 |

> **为什么 `fit-session` 一个函数装 7 个 action**：它们共享同一套"这个人是不是这次训练的主人"的校验。拆开就要把这段校验复制七遍——这是项目里已经踩过的坑（见 `card-apply` 的注释）。

---

## 4. 界面（轻量版）

### 4.1 `pages/fitness/fitness` · 健身首页
1. 顶部：本周训练 N 次 / 连续 N 天 / 总容量
2. 「今天练什么」：官方计划卡片流（色块 + 名称 + 每周几练 + 一句话）
3. 入口：动作库 → / 开始自由训练
4. 打卡日历（当月，已训练日高亮）

### 4.2 `pages/exercise/exercise` · 动作库
- 顶部搜索框
- 横向器械分栏（杠铃/哑铃/器械/绳索/自重/其他）
- 左侧竖排肌群导航 + 右侧动作卡（名称 + 器械角标 + 建议组次 + 一句要领）
- 点动作卡 → 弹层看详情

### 4.3 `pages/workout/workout` · 训练记录
- 从计划进入：自动列出该训练日的所有动作
- 每个动作一个卡片：已做组数 / 建议组次 / 「＋ 记一组」
- 记一组：弹层输入重量、次数（默认为上一组的值）
- 底部：结束训练 → 写 `fit_sessions.total_*` 汇总并打卡

### 4.4 `pages/study/study` · 学习
- 番茄钟表盘（25 / 45 / 自定义）
- 开始 / 暂停 / 放弃
- 今日：完成 N 轮 · 共 N 分钟
- 本周柱状图（纯 CSS，不用图表库）
- 入口：去找学习搭子 → 大厅 `?type=study`

---

## 5. 以后往上加时，改动面有多大

| 要加的功能 | 需要动什么 |
|---|---|
| 容量趋势 / 部位雷达 | **只改前端**，读 `fit_sessions.total_volume` 与 `muscles` |
| PR 曲线 / RM 计算器 | **只改前端**，读 `fit_sets` 的 `est_1rm` 与 `is_pr` |
| 动作配图 | 给 `fit_exercises` 加 `image_url` 字段 + 换卡片渲染，**表不用改结构** |
| 自定义计划编排 | 新增 `fit-plan` 的 `save` action，`fit_plans.source='custom'` 已预留 |
| 自定义动作 | `fit_exercises.is_custom / owner_id` 已预留 |
| 饮食记录 | 新增 `fit_meals` 表，与现有表无耦合 |
| 挑战 / 排行 | 新增 `fit_challenges`，只读 `fit_sessions` 汇总 |

**这就是"界面轻量、结构不轻量"的收益**——每一个以后要加的功能，落点都已经在表里了。
