# 同频 · App 工程（uni-app + Vue3）

> 这是可以在 HBuilderX 里直接打开的 uni-app 项目根目录。
> 打开路径：`HBuilderX → 文件 → 打开目录 → 选中本目录（dazi-app\app）`

## 目前有什么（骨架版）

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | App 名称、图标、版本、安卓权限；`appid` 留空，HBuilderX 会提示重新获取 |
| `pages.json` | 页面登记表：登录页 / 首页，以及全局导航栏样式 |
| `App.vue` | 全局样式变量（主色 #FF6B4A 等），所有页面共用 |
| `main.js` | Vue3 入口，以后注册全局插件的地方 |
| `pages/login/login.vue` | 登录页界面（手机号 + 密码），登录按钮暂未接接口 |
| `pages/index/index.vue` | 首页骨架：4 个功能入口 + 每日百科占位 |
| `common/chat/transport.js` | 聊天传输层接缝：先轮询（3 秒），以后可换 WebSocket |

## 怎么跑起来

1. **装 HBuilderX**（App 开发版，官网下载）
2. 打开目录：`dazi-app\app`
3. 右上角 `运行 → 运行到手机或模拟器`（安卓手机需开 USB 调试；没有手机就先用 `运行到浏览器` 看界面）
4. 真机运行会自动生成调试基座，第一次会比较慢（5–10 分钟）
5. 出正式安装包：`发行 → 原生App-云打包`（打完给一个 APK，直接装到同学手机上）

> 现在没有 `node_modules`、没有 npm：uni-app 的编译由 HBuilderX 自带，装不装 Node 都不影响你跑起来。

## 编码约定（写页面时照着来）

- 单位用 `rpx`（750rpx = 屏幕宽）；不要用 `vw`、`rem`
- 标签只用 `view` / `text` / `image` / `input` / `scroll-view` / `button` / `navigator`，不要 `div` / `span` / `img`
- 点击事件用 `@tap`，不要 `@click`
- 布局用 Flex，不用 CSS Grid（App 端兼容性差）
- 颜色写 `#RRGGBB`，不要写 `oklch()` / `color-mix()`
- 字体用系统字体栈（见 `App.vue`），不引外部字体
- 调接口、存数据、跳页面统一用 `uni.*`：`uni.request`、`uni.setStorageSync`、`uni.navigateTo`
- 需要区分平台时用条件编译（`#ifdef APP-PLUS` / `#ifndef H5`）

## 下一步（第 1–2 天）

- 第 1 天：装 HBuilderX，把本项目在手机上跑出登录页和首页
- 第 2 天：注册 uniCloud 服务空间，写第一个云函数 `user-login`，把登录按钮接上真接口
