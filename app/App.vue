<script>
import { settleIfDue, clearSession } from '@/common/pomodoro/session.js'

export default {
  onLaunch() {
    console.log('[同频] App Launch')
    // 冷启动时先试着用本地 token 自动登录，再决定落在哪一页。
    // 注意：onLaunch 里不能 await（不能阻塞启动），所以走回调/事件通知首页。
    this.tryAutoLogin()
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

      // 情况 1：没登录过
      if (!token) {
        uni.setStorageSync('autoLogin', { state: 'none', at: Date.now() })
        return
      }

      if (typeof uniCloud === 'undefined') {
        // H5 端没配代理时 uniCloud 不可用，不要卡住启动
        uni.setStorageSync('autoLogin', { state: 'none', at: Date.now() })
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
          uni.setStorageSync('autoLogin', { state: 'ok', at: Date.now() })
          console.log('[同频] 自动登录成功：' + r.data.user.nickname)
        } else {
          // 情况 3：token 失效/被封禁，清干净
          uni.removeStorageSync('token')
          uni.removeStorageSync('userInfo')
          uni.setStorageSync('autoLogin', {
            state: 'fail',
            msg: r.msg || '',
            at: Date.now()
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
          at: Date.now()
        })
        console.log('[同频] 自动登录调用失败：' + (e.message || ''))
      }
    }
  }
}
</script>

<style>
/* ===========================================================
   同频 · 全局设计变量
   统一用 CSS 变量，页面里写 var(--tf-primary) 即可。
   这样不依赖 sass 编译插件，第一次运行最不容易出问题。
   =========================================================== */
page {
  --tf-primary: #FF6B4A;
  --tf-primary-soft: #FFF1ED;
  --tf-text: #1F2329;
  --tf-text-2: #646A73;
  --tf-text-3: #8F959E;
  --tf-bg: #F5F6F8;
  --tf-card: #FFFFFF;
  --tf-line: #EFF0F2;
  --tf-success: #12B76A;
  --tf-danger: #F04438;

  background-color: var(--tf-bg);
  color: var(--tf-text);
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue",
    "PingFang SC", "Microsoft YaHei", sans-serif;
}
</style>
