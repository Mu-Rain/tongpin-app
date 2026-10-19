'use strict'

/**
 * 卡片详情 —— 一次拿齐"看详情页需要的一切"
 *
 * 入参：{ token 可选, card_id }
 * 出参：{
 *   code, msg,
 *   data: {
 *     card: { ..., owner: {...}, tags: [...], common_tags: [...] },
 *     apply_state: {
 *       can_apply:      bool   —— 能不能申请（按钮亮不亮）
 *       reason:         string —— 不能申请时的人话原因
 *       my_application: { _id, status, message, created_at } | null
 *       pending_count:  number —— 这张卡当前待处理申请数（仅发布者可见）
 *       applications:   [...]  —— 仅发布者可见的申请人列表
 *     }
 *   }
 * }
 *
 * 为什么详情单独一个云函数、不复用 card-list：
 *   列表只要摘要，详情要发布者完整资料 + 我的申请状态 + （如果是我的卡）申请人列表。
 *   塞进列表会让大厅每翻一页都多查好几次，列表就该只干列表的事。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'

const USER_FIELDS = {
  _id: true,
  nickname: true,
  avatar_url: true,
  avatar: true,
  school: true,
  schoolVerified: true,
  is_verified: true,
  credit: true,
  credit_score: true,
  user_no: true,
  bio: true,
  grade: true
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

exports.main = async (event) => {
  try {
    const cardId = str(event.card_id)
    const token = str(event.token)
    if (!cardId) return { code: 400, msg: '缺少 card_id' }

    // —— 0. 我是谁（可选）——
    let me = null
    if (token) {
      const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
      if (r.data.length) me = r.data[0]
    }

    // —— 1. 卡片 ——
    const cardRes = await db.collection('cards').doc(cardId).get()
    if (!cardRes.data || !cardRes.data.length) {
      return { code: 404, msg: '这张卡片不存在或已被删除' }
    }
    const card = cardRes.data[0]

    // removed 的卡片只有发布者本人和管理员能看
    if (card.status === 'removed' && (!me || me._id !== card.owner_id)) {
      return { code: 403, msg: '这张卡片已被下架' }
    }

    const isMine = !!(me && me._id === card.owner_id)

    // —— 2. 发布者 ——
    const ownerRes = await db
      .collection(DB_USERS)
      .where({ _id: card.owner_id })
      .field(USER_FIELDS)
      .limit(1)
      .get()
    const o = ownerRes.data[0] || {}
    const owner = {
      _id: o._id || '',
      nickname: o.nickname || '同学',
      avatar_url: o.avatar_url || o.avatar || '',
      school: o.school || '',
      // 兼容两套字段名：第 1 天注册写的是 schoolVerified/credit，03 文档设计的是 is_verified/credit_score
      is_verified: !!(o.is_verified || o.schoolVerified),
      credit_score: typeof o.credit_score === 'number' ? o.credit_score : typeof o.credit === 'number' ? o.credit : 80,
      user_no: o.user_no || '',
      bio: o.bio || '',
      grade: o.grade || ''
    }

    // —— 3. 卡片标签 + 我的标签（算重合）——
    const ctRes = await db.collection('card_tags').where({ card_id: cardId }).get()
    const cardTagIds = ctRes.data.map((x) => x.tag_id)

    const tagMap = {}
    if (cardTagIds.length) {
      const tRes = await db.collection('tags').where({ _id: dbCmd.in(cardTagIds) }).get()
      tRes.data.forEach((t) => {
        tagMap[t._id] = t
      })
    }
    const tags = cardTagIds
      .map((id) => tagMap[id])
      .filter(Boolean)
      .map((t) => ({ _id: t._id, name: t.name, category: t.category }))

    let myTagIds = []
    if (me) {
      const myRes = await db.collection('user_tags').where({ user_id: me._id }).get()
      myTagIds = myRes.data.map((x) => x.tag_id)
    }
    const commonTags = cardTagIds.filter((id) => myTagIds.indexOf(id) >= 0)

    // 共同标签明细（前端展示"你们都喜欢…"）
    const commonDetail = commonTags
      .map((id) => tagMap[id])
      .filter(Boolean)
      .map((t) => ({ _id: t._id, name: t.name, category: t.category }))

    // —— 4. 申请状态 ——
    const canApply = { can_apply: false, reason: '', my_application: null, pending_count: 0, applications: [] }

    if (!me) {
      canApply.reason = '登录后才能申请'
    } else if (isMine) {
      canApply.reason = '这是你自己发布的卡片'
    } else if (card.status !== 'open') {
      canApply.reason = card.status === 'matched' ? '这张卡片已经找到搭子了' : '这张卡片已经关闭'
    } else if (owner.credit_score < 60) {
      canApply.reason = '对方信誉分过低，暂不支持申请'
    }

    // 我的申请记录（不论能不能申请，都要显示当前状态）
    if (me && !isMine) {
      const appRes = await db
        .collection('applications')
        .where({ card_id: cardId, applicant_id: me._id })
        .orderBy('created_at', 'desc')
        .limit(1)
        .get()
      if (appRes.data.length) {
        const a = appRes.data[0]
        canApply.my_application = {
          _id: a._id,
          status: a.status,
          message: a.message || '',
          created_at: a.created_at,
          // conversation_id: 同意之后 card-apply 会建会话并把 id 写在申请行上，
          // 这里必须带出去，否则详情页的去聊聊找不到会话
          conversation_id: a.conversation_id || ''
        }
        if (a.status === 'pending') {
          canApply.reason = '申请已提交，等待对方回应'
        } else if (a.status === 'accepted') {
          canApply.reason = '对方已同意，去消息里聊聊吧'
        } else if (a.status === 'rejected') {
          canApply.reason = '对方这次没有同意'
        }
      }
    }

    // 没被前面任何条件拦住 → 可以申请
    if (me && !isMine && card.status === 'open' && !canApply.reason) {
      canApply.can_apply = true
    }

    // 发布者视角：看谁申请了
    if (isMine) {
      const listRes = await db
        .collection('applications')
        // pending 是待处理；accepted 也要带上 —— 同意之后申请人就从 pending 列表消失了，
        // 发布者会以为对方跑了，而且「去聊聊」也拿不到会话 id
        .where({ card_id: cardId, status: dbCmd.in(['pending', 'accepted']) })
        .orderBy('created_at', 'desc')
        .get()

      const applicantIds = listRes.data.map((a) => a.applicant_id)
      const applicantMap = {}
      for (let i = 0; i < applicantIds.length; i += 50) {
        const part = applicantIds.slice(i, i + 50)
        if (!part.length) continue
        const uRes = await db.collection(DB_USERS).where({ _id: dbCmd.in(part) }).field(USER_FIELDS).get()
        uRes.data.forEach((u) => {
          applicantMap[u._id] = u
        })
      }

      // 申请人跟我（发布者）的标签重合度
      const myTagSet = myTagIds
      canApply.pending_count = listRes.data.length
      canApply.applications = listRes.data.map((a) => {
        const u = applicantMap[a.applicant_id] || {}
        return {
          _id: a._id,
          applicant: {
            _id: u._id || '',
            nickname: u.nickname || '同学',
            avatar_url: u.avatar_url || u.avatar || '',
            school: u.school || '',
            is_verified: !!(u.is_verified || u.schoolVerified),
            credit_score: typeof u.credit_score === 'number' ? u.credit_score : typeof u.credit === 'number' ? u.credit : 80
          },
          message: a.message || '',
          created_at: a.created_at,
          status: a.status,
          conversation_id: a.conversation_id || ''
        }
      })
      canApply.my_tag_count = myTagSet.length
    }

    delete card.owner_id
    delete card.school_id
    delete card.city_code

    return {
      code: 0,
      msg: 'ok',
      data: {
        card: Object.assign(card, {
          owner,
          tags,
          common_tags: commonTags,
          common_tag_detail: commonDetail,
          common_tag_count: commonTags.length,
          is_mine: isMine
        }),
        apply_state: canApply
      }
    }
  } catch (e) {
    return { code: 500, msg: e.message || '加载失败' }
  }
}
