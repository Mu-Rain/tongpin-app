<script>
/* 关闭原生启动图。App 端用 plus.navigator；其它端没有这个对象，直接跳过。
   只在启动链路调用，重复调用是安全的（内部状态机自己会忽略）。 */
function closeNativeSplash() {
  try {
    if (typeof plus !== 'undefined' && plus.navigator && plus.navigator.closeSplashscreen) {
      plus.navigator.closeSplashscreen()
    }
  } catch (e) {
    // 关不掉不影响业务
  }
}

import { settleIfDue, clearSession } from '@/common/pomodoro/session.js'
import { registerPush, bindPushTap } from '@/common/push.js'

export default {
  onLaunch() {
    // ★ 构建标记：改了代码却没生效时，靠这一行就能判断是不是包没换（见交付说明）
    console.log('[同频] App Launch · build 2026-11-04-23')
    uni.setStorageSync('appBuild', '2026-11-04-23')
    // 本次启动的标识。登录页要靠它区分「上一次启动留下的 autoLogin」和「这一次的判定结果」：
    // 不区分的话，冷启动读到的旧状态会被当成已有结论（详见 login.vue readAutoLogin）。
    uni.setStorageSync('bootId', String(Date.now()))
    // 冷启动时先试着用本地 token 自动登录，再决定落在哪一页。
    // 注意：onLaunch 里不能 await（不能阻塞启动），所以走回调/事件通知首页。
    // 推送注册放在自动登录之后：fire-and-forget，绝不 await —— 启动不能被 push 拖慢或带崩。
    // 挂回调而不是直接调用，是因为绑定要读 token，而冷启动的 token 正是 tryAutoLogin 写进去的；
    // 两个分支都注册：自动登录失败（断网 / 没登过）时也先把 cid 缓存下来，等登录成功再补绑。
    this.tryAutoLogin().then(registerPush, registerPush)
    // 点通知进会话：监听是一次性的、不需要 token，所以同步绑在这里，不等自动登录
    bindPushTap()
    // 原生启动图设成了「不自动关闭」（manifest app-plus.splashscreen.autoclose=false），
    // 由落地页渲染完再关，这样启动图 → 首页之间不会出现一帧白屏。
    // 这里再加一道 4 秒兜底：任何异常导致页面没关成功，也不会把用户永久卡在启动图上。
    setTimeout(closeNativeSplash, 4000)
    /* tab 预热：趁启动这段没人催的空档，把另外三个 tab 的页面实例提前建好，
       用户第一次点 tab 时省掉一次页面初始化（模板产物解析 + 首帧布局）。
       三条纪律：
       1) 延后 800ms：启动这一刻 CPU/IO 全在首屏上，这时的 preload 会和首屏抢资源 ——
          那就把「启动变慢」换成了「切 tab 变快」，不划算。800ms 落在首屏基本稳定、
          启动图也已经关掉（首页 onReady 关 / 这里 4 秒兜底）之后。
       2) typeof 判断 + try/catch：preloadPage 只有较新基础库/部分端才有，
          不支持就静默跳过；抛错也只吞掉，绝不弹提示、绝不进业务分支。
       3) 不 await、不挂业务回调：预热失败等于没预热，启动流程不能被它拖住或带崩。 */
    setTimeout(() => this.preloadOtherTabs(), 800)
  },
  onShow() {
    // 番茄钟兜底结算：不在学习页时学习页的 onShow 不会触发，靠这里补记
    this.settlePomodoro()
  },
  onHide() {},

  methods: {
    /**
     * 番茄钟兜底结算（D1）
     * ============================================================
     * 为什么放在 App.vue：
     *   番茄是「离开页面也在走」的。用户点开始后切到别的页面，计时照样跑到 0，
     *   但只有学习页的 onShow 会结算 —— 回页面前清缓存、或者换台设备，这条记录就永久丢了。
     *   所以这里再挂一个入口：App 回到前台时补一次。
     *
     * 三条纪律：
     *   1. 只做兜底：学习页在场时它自己会结算，这里直接跳过，避免同一条会话被写两次。
     *   2. 只有云函数回 code=0 才 clearSession：写库成功才让会话消失，
     *      学习页之后 onShow 就读不到它了，这是「不双记」的关键一步。
     *   3. 静默 + 严格 try/catch：结算失败只丢一条记录，不能弹窗打扰用户，
     *      更不能影响 onLaunch 里的自动登录和页面渲染。
     */
    async settlePomodoro() {
      try {
        // 1. 当前就在学习页：交给页面自己结算（它马上会 onShow）
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
        const cur = pages && pages.length ? pages[pages.length - 1] : null
        const route = cur && cur.route ? String(cur.route) : ''
        if (route.indexOf('study/study') >= 0) return

        // 2. 读会话并判断是否已到点（纯本地操作，没会话/没到点都返回 null）
        const due = settleIfDue()
        if (!due) return

        // 3. 没登录、或云服务在这端不可用：会话原样留在本地，不写也不清
        const token = uni.getStorageSync('token')
        if (!token) return
        if (typeof uniCloud === 'undefined') return

        const res = await uniCloud.callFunction({
          name: 'study-pomodoro',
          data: {
            token: token,
            action: 'record',
            minutes: due.minutes,
            completed: true,
            started_at: due.startedAt,
            finished_at: due.finishedAt
          }
        })
        const r = (res && res.result) || {}
        if (r.code === 0) {
          clearSession()
          console.log('[同频] 后台补记番茄成功：' + due.minutes + ' 分钟')
        } else {
          // 业务失败（token 过期、时长非法）：会话留着，回学习页还能再试
          console.log('[同频] 后台补记番茄失败：' + (r.msg || '未知'))
        }
      } catch (e) {
        // settleIfDue 内部抛错、callFunction reject、uniCloud 调用异常都到这里为止。
        // 这里只打日志、不 rethrow：启动流程绝不能被一条番茄记录带崩。
        console.log('[同频] 后台补记番茄异常：' + ((e && e.message) || ''))
      }
    },

    /**
     * 预热其余三个 tab 页（首页已经在用，再 preload 没有意义）
     * ============================================================
     * 为什么值得做：uni-app 的 tab 页是首次 switchTab 时才真正初始化（解析模板产物、
     * 建页面实例、跑 onLoad/首次布局）。用户点 tab 时的「卡一下」里有相当一部分
     * 就是这段初始化，提前在启动空闲里做掉，点击那条路径上就只剩切场动画。
     *
     * 为什么这么写：
     *   1. 先 typeof 判断再逐个 try/catch：不支持的端（含大多数 App 上的旧基础库）
     *      静默跳过 —— 这是纯优化，失败必须完全等于没写这几行。
     *   2. 传 success/fail 而不只传 url：给了回调，uni 就不会返回 promise，
     *      也就不会产生没人接的 unhandled rejection（低端机上那是真会冒红字的）。
     *   3. 单个页面预热失败不中断其余页面，更不影响启动。
     */
    preloadOtherTabs() {
      if (typeof uni.preloadPage !== 'function') return
      const urls = ['/pages/feed/feed', '/pages/messages/messages', '/pages/mine/mine']
      urls.forEach((url) => {
        try {
          uni.preloadPage({
            url: url,
            success() {},
            fail() {
              // 预热失败等于没预热，静默
            }
          })
        } catch (e) {
          // 该端不支持或参数被拒：静默跳过
        }
      })
      console.log('[同频] tab 预热已排入：' + urls.length + ' 页（不支持则自动跳过）')
    },

    /**
     * 自动登录
     * ============================================================
     * 为什么放在 App.vue 而不是首页：
     *   启动页是 pages/login/login，它在 App.vue 的 onLaunch 之后立刻渲染。
     *   如果在首页里判断，用户会先看到登录页闪一下再跳走。
     *   放在 onLaunch 里，能在登录页做判断前就把结果写进本地，
     *   登录页 onShow 时读一次即可，不会闪。
     *
     * 三种结果：
     *   1. 本地没 token        → 什么都不做，正常停在登录页
     *   2. 有 token 且验证通过 → 写 mark=ok + 刷新 userInfo，登录页会直接放行进首页
     *   3. 有 token 但已失效   → 清掉本地脏数据，留在登录页
     */
    async tryAutoLogin() {
      const token = uni.getStorageSync('token')
      // 写 autoLogin 必须带 bootId：登录页只认本次启动写下的结论
      const bid = uni.getStorageSync('bootId') || ''

      // 情况 1：没登录过
      if (!token) {
        uni.setStorageSync('autoLogin', { state: 'none', at: Date.now(), bootId: bid })
        return
      }

      if (typeof uniCloud === 'undefined') {
        // H5 端没配代理时 uniCloud 不可用，不要卡住启动
        uni.setStorageSync('autoLogin', { state: 'none', at: Date.now(), bootId: bid })
        return
      }

      try {
        const res = await uniCloud.callFunction({
          name: 'user-auto-login',
          data: { token }
        })
        const r = res.result || {}

        if (r.code === 0) {
          // 情况 2：验证通过，刷新本地用户信息（可能被管理员改过）
          uni.setStorageSync('token', r.data.token)
          uni.setStorageSync('userInfo', r.data.user)
          uni.setStorageSync('autoLogin', { state: 'ok', at: Date.now(), bootId: bid })
          console.log('[同频] 自动登录成功：' + r.data.user.nickname)
        } else {
          // 情况 3：token 失效/被封禁，清干净
          uni.removeStorageSync('token')
          uni.removeStorageSync('userInfo')
          uni.setStorageSync('autoLogin', {
            state: 'fail',
            msg: r.msg || '',
            at: Date.now(),
            bootId: bid
          })
          console.log('[同频] 自动登录失败：' + (r.msg || '未知'))
        }
      } catch (e) {
        // 云函数没部署 / 断网：不能把用户卡在启动页，标记成 none 让登录页正常显示。
        // 注意这里**不清 token** —— 网络问题的概率远大于 token 真失效，
        // 清掉会让用户白登录一次，而保留的成本只是下次启动多试一遍。
        uni.setStorageSync('autoLogin', {
          state: 'none',
          error: e.message || '',
          at: Date.now(),
          bootId: bid
        })
        console.log('[同频] 自动登录调用失败：' + (e.message || ''))
      }
    }
  }
}
</script>

<style>
/* 称号皮肤：轮廓固定、内部自由，称号墙与资料卡共用这一份 */
@import "./styles/title-skins.css";

/* ===========================================================
   同频 · 全局设计变量
   -----------------------------------------------------------
   依据：搭子App-UI整改执行文档 §2（P0-A）

   ★ 变量名保留旧名 --tf-*，只换值。
     全站 1049 处 var(--tf-*) 因此自动生效，不用逐个改。
     SCSS 版在 app/styles/tokens.scss，两边值必须一致。

   ★ 三条硬规则（文档 §2）：
     1. 主色 #ff6b35 只出现在主 CTA 和关键数字上
     2. 页面底色全 App 统一纯色 #fff8ef，禁止每页一套渐变
     3. 玻璃/毛玻璃只给悬浮层（tabbar、弹窗），内容卡片一律实色白卡
   =========================================================== */
page {
  /* —— 品牌色：唯一主色，只给主 CTA 和关键数字 —— */
  /* 晴空暖阳：主色从橙换成蝶翅明黄 */
  --tf-primary:      #F9D038;
  --tf-primary-deep: #8A5A00;
  --tf-primary-soft: #FFF3C8;

  /* —— 色卡全套：不要只用黄，每个页面挑一个当主角 ——
     首页=暖黄（阳光）、同频圈=晴空蓝（发现）、聊天=草绿（舒适）、我的=紫蝶（独特） */
  --sky:        #3B7ADB;   /* 晴空蓝 */
  --sky-deep:   #3570CC;   /* 深一档，需要白字的蓝底 */
  --sky-soft:   #D6E4FA;   /* 浅蓝底 */
  --iris:       #593CC9;   /* 紫蝶 */
  --iris-soft:  #E4DCFA;   /* 浅紫底 */
  --grass:      #C4D888;   /* 浅草绿 */
  --grass-deep: #7A9A46;   /* 草绿深调，文字用 */
  --grass-soft: #E8F0D0;   /* 浅绿底 */
  --peach:      #F2A479;   /* 浅橙腮红 */
  --peach-soft: #FDE6D6;   /* 浅橙底 */
  --sun:        #F9D038;   /* 蝶翅明黄（= primary） */
  --sun-soft:   #FFF3C8;

  /* —— AI 专属身份色：全线固定，不解释也能懂这是 AI —— */
  --tf-ai:           #ffd84d;
  --tf-ai-soft:      #fff8d9;

  /* —— 功能标签色：只用于分类贴纸，不做大面积 —— */
  --tf-tag-1:        #d9f3ec;   /* 学习 */
  --tf-tag-2:        #e3ecff;   /* 运动 */
  --tf-tag-3:        #ffd8e4;   /* 干饭 */
  --tf-tag-4:        #ffe9b8;   /* 玩乐 */

  /* —— 文字：暖墨，不用纯黑 —— */
  --tf-text:   #2d2a26;                     /* 主文字 */
  --tf-text-1: #2d2a26;                     /* 兼容历史写法 */
  --tf-text-2: #6b6259;                     /* 次级 */
  --tf-text-3: #9a9186;                     /* 辅助（对比度 ≥4.5:1，见 §12.2）*/

  /* —— 底与玻璃 —— */
  --tf-bg:          #fff8ef;
  /* 卡片一律实色白。文档 §2.6：玻璃拟态只允许出现在悬浮层，
     页面内容卡片不许半透明 —— 否则背后的底色会干扰正文可读性。 */
  --tf-card:        #ffffff;
  --tf-card-strong: #ffffff;
  --tf-line:        rgba(45, 42, 38, 0.08);
  --tf-line-soft:   rgba(45, 42, 38, 0.06);
  --tf-card-line:   rgba(45, 42, 38, 0.08);      /* 卡片描边 $border-card */

  /* —— 浮起（lift）—— */
  /* 文档 §2.3：投影改成柔和弥散，不再用粗野主义的实心偏移 */
  --tf-lift:        0 10rpx 28rpx rgba(80, 60, 30, 0.16);   /* 浮起：弹窗 / 悬浮条 */
  --tf-lift-sm:     0 6rpx 16rpx rgba(80, 60, 30, 0.08);    /* 卡片 */
  --tf-lift-line:   rgba(45, 42, 38, 0.08);

  /* —— 语义色 —— */
  --tf-mist:   #d9f3ec;    /* 正向状态浅底 */
  --tf-mint:   #2f8f72;    /* 已认证 / 信誉正向 */
  --tf-success: #2f8f72;
  --tf-gold:   #ffe9b8;    /* 称号 / 徽章浅底 */
  --tf-danger: #c0392b;    /* 危险操作，只在确认弹窗里出现 */

  /* —— 液态玻璃 —— */
  /* 只给悬浮层（tabbar / 底部弹窗）用，内容卡片不要用 */
  --tf-glass-blur: blur(20px) saturate(1.4);
  --tf-glass-shadow: 0 10rpx 28rpx rgba(80, 60, 30, 0.16);

  /* —— 动效（文档 §11）：三档时长 + 统一缓动 ——
     150ms 微交互（按下、切换）/ 250ms 页面转场 / 300ms 卡片入场
     缓动只有一条：cubic-bezier(0.22, 0.61, 0.36, 1) */
  --dur-micro: 150ms;
  --dur-page:  250ms;
  --dur-enter: 300ms;
  --ease-std:  cubic-bezier(0.22, 0.61, 0.36, 1);

  /* —— 圆角：文档 §2.3 规定卡片 24rpx、按钮 20rpx、胶囊 999rpx ——
     保留 4 档是因为现有页面按 sm/md/lg/xl 写了引用，
     值统一收拢到 24/24/32/40，视觉上归到「大圆角但不夸张」 */
  --tf-r-sm: 20rpx;
  --tf-r-md: 24rpx;
  --tf-r-lg: 24rpx;
  --tf-r-xl: 32rpx;

  /* —— 画布：文档 §2.6 要求全 App 统一纯色，删除每页一套渐变 ——
     原来那套四角光斑 + 线性渐变已经删掉：每页各调一个背景，
     正是「看不出是同一个 App」的根源。 */
  background-color: #fff8ef;

  color: var(--tf-text);
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue",
    "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ===========================================================
   玻璃卡公共类
   -----------------------------------------------------------
   必须放在非 scoped 的 <style> 里，页面才能用到；
   写进组件的 <style scoped> 里会因作用域编译而失效。

   border 用 2rpx 不是 1rpx：2rpx 在 390 宽的机型上约等于 1px，
   写 1rpx 在部分安卓上会渲染成半像素，白边变灰色虚线。
   =========================================================== */
.tf-glass {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

/* 短文本 / 工具栏用更实一点的玻璃 */
.tf-glass-strong {
  background: var(--tf-card-strong);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

/* 数字等宽：信誉分 / 同频个数 / 倒计时 / 未读数，读数不跳 */
.tf-num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

/* 默认头像：所有头像的二选一分支（有链接用 <image src>，没有用这张图）。
   尺寸由各页面自己的头像类提供，这里只保证图片是块级、不被行内基线拉出缝隙。 */
.avatar-def {
  display: block;
}
</style>
