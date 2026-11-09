<template>
  <view class="page">

    <!-- 导航：标题跟着 type 变 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">{{ docTitle }}</text>
    </view>

    <view class="head">
      <text class="head-title">{{ docTitle }}</text>
      <text class="head-sub">{{ docSub }}</text>
    </view>

    <view class="doc">
      <view class="sec" v-for="(s, i) in sections" :key="i">
        <text class="sec-h">{{ i + 1 }}. {{ s.h }}</text>
        <text class="sec-p">{{ s.p }}</text>
      </view>
    </view>

    <view class="foot">
      <text class="foot-t">更新日期 2026-11-02</text>
    </view>
  </view>
</template>

<script>
/**
 * 三份文档都写死在本地，不走云函数。
 * 为什么：条款是随版本走的静态文本，放云函数反而多一次网络请求和一次失败可能；
 * 这里内容即页面，断网也能读，审核时也能直接对着文件看。
 */
const DOCS = {
  terms: {
    title: '用户协议',
    sub: '用同频之前，请先花两分钟读一遍',
    sections: [
      {
        h: '服务说明',
        p: '同频是一个只对在校学生开放的搭子平台，提供按标签找人、发布搭子卡片、聊天、动态等能力。我们不提供线下活动的组织、代收费或人身担保，所有搭子关系由你自行判断和建立。若你不同意本协议的任何一条，请停止使用本服务。'
      },
      {
        h: '账号与实名',
        p: '本服务使用手机号加验证码登录，一个手机号对应一个账号，请勿转让或出借。上传学生证等材料完成学生认证后，才会显示「已认证」标识，认证信息仅用于身份核验，不会公开展示。你应保证提交的材料真实有效，冒用他人身份一经发现将封禁账号。'
      },
      {
        h: '用户行为规范',
        p: '你在使用过程中不得发布骚扰、辱骂、人身攻击、歧视性言论，不得冒充他人、伪造学历或身份，不得发布虚假搭子信息骗取他人时间与财物。不得利用本服务从事推销、拉群、刷单、代写代考等与搭子无关的商业或违规行为。你在平台上发布的文字、图片由你自行负责，平台不对其内容的真实性作出保证。'
      },
      {
        h: '内容与搭子关系',
        p: '你发布在平台上的动态、卡片、聊天内容，你保留著作权，同时授权平台为展示和推荐之目的在站内使用。搭子关系建立在双方自愿基础上，任何一方都可以随时拒绝或终止，拒绝不需要理由。发布的内容如涉及他人肖像或隐私，请先取得对方同意。'
      },
      {
        h: '免责与风险提示',
        p: '线下见面存在客观风险，请你自行判断对方身份、选择公共场所、告知亲友行程，并注意人身与财产安全。平台会尽量通过学生认证、信誉分、举报机制降低风险，但无法对任何线下见面的过程和结果承担责任。因你自身疏忽或第三方行为造成的损失，平台在法律允许的范围内不承担赔偿责任。'
      },
      {
        h: '违约处理',
        p: '如你违反本协议，平台可视情节采取提示整改、删除内容、限制功能、扣减信誉分、封禁账号等措施。因严重违规被封禁的账号，其发布的内容和搭子关系将一并失效。涉嫌违法犯罪的行为，平台会配合司法机关提供必要的信息。'
      },
      {
        h: '条款变更',
        p: '本协议可能随功能调整而更新，更新后的条款会在本页面公布并标注生效日期。若变更涉及你的重大权益，我们会在站内以更明显的方式提示。变更生效后你继续使用本服务，视为接受新的条款。'
      }
    ]
  },
  privacy: {
    title: '隐私政策',
    sub: '我们收集什么、拿来做什么、你怎么管',
    sections: [
      {
        h: '我们收集哪些信息',
        p: '为了让你能正常使用，我们会收集：手机号（用于登录和找回账号）、昵称与头像、学校与专业信息、你主动发布的搭子卡片与动态、你上传的学生认证材料，以及必要的访问日志（时间、接口、错误码、设备类型）。我们不会收集你的通讯录、短信、相册内容或精确地理位置。'
      },
      {
        h: '这些信息用来做什么',
        p: '手机号只用于登录、安全校验和必要的账号通知；学校和专业用于同校匹配与搭子推荐；昵称、头像和发布内容用于在站内展示。访问日志仅用于排查故障、防范刷接口等异常行为，不用于向你推送广告。我们不会把你的手机号展示给其他用户，账号相关页面一律脱敏显示。'
      },
      {
        h: '存储与保护',
        p: '你的数据存储在云服务商提供的服务器上，传输过程使用 HTTPS 加密。我们按照最小必要原则控制内部访问权限，只有处理故障和违规内容必需的人员才能在授权范围内查看。手机号等敏感字段在展示层统一做脱敏处理，客户端不会保存你的登录凭证之外的敏感信息。'
      },
      {
        h: '第三方服务',
        p: '我们使用云服务商（uniCloud 支付宝云）提供数据库、文件存储和云函数能力，数据在其机房内处理。短信验证码由第三方短信服务商下发，我们仅向其提供手机号这一必要字段。除法律法规要求或你本人授权外，我们不会向其他第三方出售或共享你的个人信息。'
      },
      {
        h: '你的权利',
        p: '你可以随时在「账号与安全」和「隐私设置」里查看和更正昵称、头像、学校、动态可见范围等信息。你可以删除自己发布的内容，也可以在「账号与安全」里退出登录以停止本机保存登录态。如需删除账号内的全部数据，请通过举报入口或站内反馈联系我们，我们会在核实身份后处理。'
      },
      {
        h: '未成年人',
        p: '本服务面向年满 16 周岁的在校学生。未满 16 周岁的用户请在监护人陪同下阅读本政策，并在取得监护人同意后使用。若我们发现账号属于未满 16 周岁的用户且未取得监护人同意，会停止提供服务并删除相关信息。'
      }
    ]
  },
  community: {
    title: '社区公约',
    sub: '同频的底线：真实、尊重、安全',
    sections: [
      {
        h: '真实身份，互相尊重',
        p: '请用你真实的身份参与：不冒充他人、不伪造学校与经历、不使用引人误解的头像和昵称。尊重每一个来找搭子的人，不因性别、年级、专业、外貌、地域而区别对待。你可以拒绝任何人，但拒绝时不需要贬低对方。'
      },
      {
        h: '禁止骚扰与歧视',
        p: '不发送对方明确拒绝的搭讪、追问和私信，不连续多次申请好友来施压。禁止任何形式的辱骂、人身攻击、地域与性别歧视、以及涉及身体羞辱的言论。被拉黑或被举报后，请停止一切联系行为。'
      },
      {
        h: '禁止广告、诈骗与引流',
        p: '禁止在卡片、动态、聊天里发布卖课、招代理、刷单、代写代考、贷款、博彩等内容。禁止以搭子为名索要钱财、红包、押金或引导到站外支付。发现疑似诈骗请立刻举报，不要先行转账。'
      },
      {
        h: '线下见面安全提醒',
        p: '第一次见面请选择图书馆、食堂、咖啡馆等公共场所，并把时间地点告诉一位朋友。不要独自前往陌生住处、偏僻场所，不要接受来源不明的饮料食物。涉及金钱往来时保持警惕，任何要求先付款的搭子邀约都应直接拒绝并向平台举报。'
      },
      {
        h: '内容举报渠道',
        p: '在聊天页、动态详情页和对方主页的右上角菜单里都有「举报」入口，可选择骚扰谩骂、虚假信息、广告推销等具体原因并补充说明。举报会进入后台人工审核队列，我们会在收到举报后尽快处理，并对举报人身份保密。恶意举报同样会影响你的信誉分。'
      },
      {
        h: '违规处理',
        p: '违规内容会被删除，视情节给予警告、限制发布、扣减信誉分、限制私信直至封禁账号。涉及诈骗、侵害未成年人等严重情形，我们会保留证据并配合公安机关处理。对处理结果有异议，可以通过反馈渠道申诉，我们会重新核查。'
      }
    ]
  }
}

const TYPES = ['terms', 'privacy', 'community']

export default {
  data() {
    return {
      type: 'terms'
    }
  },
  computed: {
    // 非法 type 一律回落到用户协议：宁可多显示一份条款，也不要空白页
    doc() {
      return DOCS[this.type] || DOCS.terms
    },
    docTitle() {
      return this.doc.title
    },
    docSub() {
      return this.doc.sub
    },
    sections() {
      return this.doc.sections
    }
  },
  onLoad(options) {
    const t = options && options.type ? String(options.type) : ''
    this.type = TYPES.indexOf(t) >= 0 ? t : 'terms'
    uni.setNavigationBarTitle({ title: this.docTitle })
  },
  methods: {
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    }
  }
}
</script>

<style>
/* ==========================================================================
   协议 / 政策 / 公约页
   --------------------------------------------------------------------------
   长文阅读：正文行高 1.9、段间距 28rpx、小标题加粗并用主色深调做锚点。
   不用卡片包裹每一段 —— 条款页要的是一整块可连续读的纸面感。
   ========================================================================== */
.page {
  min-height: 100vh;
  background: var(--tf-bg);
  padding-bottom: 80rpx;
}

/* 导航 */
.nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  padding-top: var(--status-bar-height);
}
.nav-back {
  position: absolute;
  left: 20rpx;
  top: calc(var(--status-bar-height) + 10rpx);
  width: 68rpx;
  height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-back-arw {
  font-size: 48rpx;
  color: var(--tf-text);
  line-height: 1;
  margin-top: -4rpx;
}
.nav-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}

/* 页头 */
.head {
  padding: 32rpx 40rpx 8rpx;
  display: flex;
  flex-direction: column;
}
.head-title {
  font-size: 44rpx;
  font-weight: 700;
  color: var(--tf-text);
  letter-spacing: 0.01em;
}
.head-sub {
  margin-top: 12rpx;
  font-size: 23rpx;
  color: var(--tf-text-3);
}

/* 正文 */
.doc {
  margin: 16rpx 24rpx 0;
  padding: 8rpx 24rpx 36rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
}
.sec {
  display: flex;
  flex-direction: column;
  padding-top: 32rpx;
}
.sec-h {
  font-size: 29rpx;
  font-weight: 700;
  color: var(--tf-text);
  line-height: 1.5;
}
.sec-p {
  margin-top: 12rpx;
  font-size: 25rpx;
  line-height: 1.9;
  color: var(--tf-text-2);
  text-align: justify;
}

/* 页脚 */
.foot {
  display: flex;
  justify-content: center;
  padding: 40rpx 40rpx 0;
}
.foot-t {
  font-size: 21rpx;
  color: var(--tf-text-3);
}
</style>
