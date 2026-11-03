import type { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { encryptSecret } from '../lib/crypto.js';
import { estimateTokens } from '../lib/tokens.js';
import { addMinutes, daysAgo, hoursAgo, nowIso } from '../lib/time.js';

let randomState = 20261103;
function rand(): number {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 0xffffffff;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

const DOC_HELP = [
  {
    id: 'doc_login',
    title: '账户与登录',
    content: `# 账户与登录

## 忘记密码
在登录页点击「忘记密码」，输入注册邮箱后会收到重置链接。链接 30 分钟内有效，只能使用一次。如果 10 分钟内没有收到邮件，请检查垃圾邮件目录，或联系支持团队人工核验身份。

## 两步验证
两步验证（2FA）支持 TOTP 应用，例如 1Password、Authy 和 Google Authenticator。如果丢失验证器，请使用备用恢复码登录；没有恢复码时，需要提交工单并由安全团队进行身份核验。

## 账号被锁定
连续 5 次输入错误密码会触发 15 分钟临时锁定。管理员可以在「团队设置 → 成员」中手动解锁。`,
  },
  {
    id: 'doc_billing',
    title: '计费与发票',
    content: `# 计费与发票

## 账单周期
专业版按月计费，账单日在每个自然月 1 日。升级套餐会按剩余天数折算差价，立即生效；降级会在当前计费周期结束后生效。

## 发票
在「工作区设置 → 账单 → 发票」中可以修改发票抬头、税号与接收邮箱。电子发票通常在申请后 1–3 个工作日内发送。已开具的发票如需重开，请提交工单并附上原发票号码。

## 支付失败
支付失败通常由卡片过期、额度不足或银行风控导致。系统会在 3 天内自动重试。更新支付方式后，可以在账单页手动重试。`,
  },
  {
    id: 'doc_refund',
    title: '退款政策',
    content: `# 退款政策

## 7 天无理由退款
首次购买专业版或企业版的客户，可以在付款后 7 天内申请全额退款。超过 7 天的订单不支持无理由退款，但可以申请按未使用服务折算退款，需由客户成功团队审核。

## 退款流程
1. 提交工单，选择「退款」分类，并提供订单号。
2. 客服会在 1 个工作日内确认订单状态。
3. 审核通过后，原路退回支付账户，通常 3–7 个工作日到账。
4. 已使用的加量包、定制实施服务和第三方服务费不参与退款。

## 争议订单
如果对扣费有异议，请在账单日后 30 天内联系我们，我们会暂停续费并进行核查。`,
  },
  {
    id: 'doc_api',
    title: 'API 常见错误',
    content: `# API 常见错误

## 401 Unauthorized
表示 API Key 缺失、格式错误、被撤销或环境不匹配。请确认请求头为 \`Authorization: Bearer <API_KEY>\`，并检查密钥是否属于当前环境。重新生成密钥后，旧密钥会立即失效。

## 429 Too Many Requests
表示触发了速率限制。专业版默认 60 请求/分钟，企业版默认 300 请求/分钟。请读取 \`Retry-After\` 响应头，使用指数退避重试，不要把重试放在紧密循环中。

## 5xx 错误
服务端错误通常是暂时性的。建议使用 1s、2s、4s 的指数退避，并加入随机抖动。连续失败超过 5 次时，请提交工单并附上 request id、时间戳和请求端点。

## Webhook 失败
Webhook 返回非 2xx 时，系统会按 1 分钟、5 分钟、30 分钟重试。请确保接口在 5 秒内返回 200。`,
  },
  {
    id: 'doc_security',
    title: '数据安全与合规',
    content: `# 数据安全与合规

## 加密
数据在传输中使用 TLS 1.3，静态数据使用 AES-256 加密。API Key 以加密形式存储，控制台只展示掩码。

## 合规
平台已通过 SOC 2 Type II 审计，支持 GDPR 数据主体请求。企业版可以签署 DPA，并选择数据存储区域。

## 数据保留
标准版日志保留 90 天，企业版可以根据合同配置 180 天或 365 天。删除工作区后，数据会在 30 天冷静期后永久删除。

## 数据导出
管理员可以在「设置 → 数据」中导出工单、联系人和知识库。导出任务通常几分钟内完成，下载链接 24 小时内有效。`,
  },
  {
    id: 'doc_plan',
    title: '套餐与升级',
    content: `# 套餐与升级

## 套餐差异
专业版包含 10 名客服、5 个知识库和 20,000 次 AI 辅助/月。企业版支持无限客服席、SSO、私有化部署、专属成功经理和 99.9% SLA。

## 升级
管理员可以在「设置 → 账单」中升级。升级立即生效，费用按剩余周期折算。企业版需要联系销售完成合同和开通。

## 席位
新增客服席位会按剩余天数计费。停用成员不会立即退还费用，但在下一个账单周期不再收费。`,
  },
  {
    id: 'doc_sso',
    title: 'SSO 与成员管理',
    content: `# SSO 与成员管理

企业版支持 SAML 2.0 和 OIDC 单点登录。管理员需要在「设置 → 安全 → SSO」中上传 IdP metadata，并配置回调和 ACS URL。

成员角色包括负责人、管理员、客服和客户。客服只能访问被分配的工单和知识库；客户只能查看自己的工单。

启用 SSO 后，可以强制成员使用 SSO 登录，并关闭密码登录。`,
  },
  {
    id: 'doc_export',
    title: '数据导出与备份',
    content: `# 数据导出与备份

管理员可以在「设置 → 数据」中导出 CSV 或 JSON。工单导出包含状态、优先级、SLA、消息记录和 AI 运行记录，不包含已删除的附件。

系统每天自动备份一次，保留 30 天。企业版可以配置自定义备份周期和跨区域副本。恢复请求需要由负责人提交并经过二次确认。`,
  },
];

const DOC_API = [
  {
    id: 'doc_api_start',
    title: 'API 快速开始',
    content: `# API 快速开始

所有接口使用 HTTPS，基础地址为 https://api.northstar.example/v1。请在请求头中添加 API Key。

\`\`\`bash
curl https://api.northstar.example/v1/tickets \\
  -H "Authorization: Bearer $API_KEY"
\`\`\`

创建工单使用 POST /tickets，必填字段为 subject、description 和 customer_email。成功返回 201 和 ticket id。

分页使用 cursor 参数，每页最多 100 条。时间字段均为 ISO 8601 UTC。`,
  },
  {
    id: 'doc_rate',
    title: 'Rate Limit 与重试',
    content: `# Rate Limit 与重试

响应头包含 X-RateLimit-Limit、X-RateLimit-Remaining 和 X-RateLimit-Reset。触发限制时返回 429，并提供 Retry-After。

推荐使用带抖动的指数退避：

1. 首次失败等待 1 秒
2. 第二次等待 2 秒
3. 第三次等待 4 秒
4. 最多重试 5 次

不要对 400 和 401 做自动重试。对于创建类接口，请使用 Idempotency-Key 防止重复写入。`,
  },
];

const DOC_POLICY = [
  {
    id: 'doc_sla',
    title: 'SLA 服务等级',
    content: `# SLA 服务等级

企业版提供 99.9% 月度可用性。P1 故障 15 分钟内响应，4 小时内恢复；P2 故障 30 分钟内响应，8 小时内恢复。

工单首次响应目标：紧急 15 分钟、高 30 分钟、普通 2 小时、低 8 小时。解决时间目标按优先级分别为 4 小时、8 小时、24 小时和 48 小时。

SLA 计时以工作区时区为准，当前为 Asia/Shanghai。`,
  },
  {
    id: 'doc_dpa',
    title: 'DPA 与数据处理',
    content: `# DPA 与数据处理

企业版客户可以签署数据处理协议（DPA）。我们作为数据处理者，仅按照客户指示处理个人数据，并采用最小权限、加密和审计措施。

子处理者列表会在官网公布。客户可以通过工单申请数据主体访问、更正、删除和可携带权请求，我们会在 30 天内完成。

跨境传输使用标准合同条款（SCC）。`,
  },
];

interface TicketTemplate {
  category: string;
  subject: string;
  message: string;
  priority: string;
  tags: string[];
}

const TEMPLATES: TicketTemplate[] = [
  {
    category: 'billing',
    subject: '9 月账单金额和预期不一致',
    message:
      '我们这个月账单比上月多了 1,200 元，但没有新增席位。能帮我看一下具体是哪些用量导致的吗？账单号 INV-202609-018。',
    priority: 'high',
    tags: ['账单', '用量'],
  },
  {
    category: 'refund',
    subject: '企业版刚购买，想申请退款',
    message:
      '我们昨天购买了企业版年付，内部审批没有通过。现在还没有开始使用，可以按 7 天无理由退款吗？订单号 ORD-88213。',
    priority: 'high',
    tags: ['退款', '年付'],
  },
  {
    category: 'technical',
    subject: '调用工单 API 一直返回 401',
    message:
      '我用新生成的 API Key 调用 /v1/tickets，一直返回 401。Key 是从控制台复制的，环境是生产。请问是权限没开吗？',
    priority: 'urgent',
    tags: ['API', '401'],
  },
  {
    category: 'technical',
    subject: '批量同步时频繁触发 429',
    message:
      '我们在夜间批量同步 5,000 条工单，运行到一半开始出现 429。已经按文档加了 1 秒重试，但还是会失败，应该怎么处理？',
    priority: 'high',
    tags: ['API', '限流'],
  },
  {
    category: 'account',
    subject: '管理员账号被锁定了',
    message:
      '我们的管理员账号连续输错密码被锁定了，现在整个团队都无法进入后台。可以帮忙解锁吗？邮箱是 ops@acme.example。',
    priority: 'urgent',
    tags: ['账号', '锁定'],
  },
  {
    category: 'account',
    subject: '更换手机后两步验证无法使用',
    message:
      '我换了手机，Google Authenticator 没有迁移，备用恢复码也找不到了。现在还能登录吗？需要提供什么材料？',
    priority: 'high',
    tags: ['2FA', '登录'],
  },
  {
    category: 'billing',
    subject: '如何把发票抬头改成新公司主体',
    message:
      '公司刚完成主体变更，已经开过的发票还能重开吗？后续发票应该用新抬头，税号也需要更新。',
    priority: 'normal',
    tags: ['发票', '主体变更'],
  },
  {
    category: 'technical',
    subject: 'Webhook 在 5 秒内返回 200 仍然重试',
    message:
      '我们的 webhook 已经记录到 200 响应，但平台还是重复推送。是不是需要返回特定 JSON？附上了 request id。',
    priority: 'normal',
    tags: ['Webhook', '重试'],
  },
  {
    category: 'technical',
    subject: '想导出全部历史工单和附件',
    message:
      '我们要做数据归档，需要导出近两年的工单、消息和附件。控制台只能导出最近 90 天，有别的办法吗？',
    priority: 'normal',
    tags: ['数据导出', '归档'],
  },
  {
    category: 'account',
    subject: '企业版支持 SAML 单点登录吗',
    message:
      '我们在评估企业版，安全团队要求使用 Okta SAML SSO，并且希望强制关闭密码登录。请问支持吗？',
    priority: 'normal',
    tags: ['SSO', '安全'],
  },
  {
    category: 'feature',
    subject: '希望支持按客户分层设置 SLA',
    message:
      '我们的大客户和普通客户需要不同的首响目标。现在只能按优先级配置，能否增加按客户标签的 SLA 策略？',
    priority: 'low',
    tags: ['SLA', '需求'],
  },
  {
    category: 'technical',
    subject: '数据保留周期可以改成 180 天吗',
    message:
      '合规团队要求日志保留 180 天。当前控制台显示 90 天，企业版可以调整吗？需要额外费用吗？',
    priority: 'normal',
    tags: ['数据保留', '合规'],
  },
];

export function seedDatabase(db: DatabaseSync): void {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number;
  };
  if (existing.count > 0) return;

  const passwordHash = bcrypt.hashSync('Support@2026', 10);
  const now = nowIso();
  const workspaceId = 'ws_northstar';

  const insertUser = db.prepare(`
    INSERT INTO users (id, workspace_id, name, email, password_hash, role, status, avatar_color, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `);
  const insertSla = db.prepare(`
    INSERT INTO sla_policies (id, workspace_id, priority, first_response_minutes, resolution_minutes, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?)',
  );
  const insertKb = db.prepare(`
    INSERT INTO knowledge_bases (id, workspace_id, name, description, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDoc = db.prepare(`
    INSERT INTO documents
      (id, kb_id, title, content, tokens, status, chunk_count, index_error, checksum, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ready', 0, '', '', ?, ?)
  `);
  const insertTicket = db.prepare(`
    INSERT INTO tickets
      (id, number, workspace_id, customer_id, assignee_id, subject, status, priority,
       category, sentiment, channel, ai_state, ai_confidence, ai_summary, risk_flags, tags,
       sla_policy_id, first_response_due_at, resolution_due_at, first_response_at,
       resolved_at, closed_at, csat, last_customer_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO ticket_messages
      (id, ticket_id, author_id, role, visibility, content, citations, is_ai, ai_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRun = db.prepare(`
    INSERT INTO ai_runs
      (id, ticket_id, workspace_id, created_by, status, category, priority, sentiment,
       summary, confidence, risk_flags, recommended_action, draft, citations, model,
       prompt_tokens, completion_tokens, latency_ms, error, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO ticket_events (id, ticket_id, actor_id, type, from_value, to_value, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCase = db.prepare(`
    INSERT INTO eval_cases (id, workspace_id, question, expected_category, expected_keyword, kb_id, difficulty, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO workspaces (id, name, plan, created_at) VALUES (?, ?, ?, ?)',
    ).run(workspaceId, '北岸云科技', 'Enterprise', daysAgo(220));

    insertUser.run('usr_owner', workspaceId, '林知夏', 'admin@supportpilot.local', passwordHash, 'OWNER', '#6D8BFF', daysAgo(200), hoursAgo(2));
    insertUser.run('usr_agent', workspaceId, '陈默', 'agent@supportpilot.local', passwordHash, 'AGENT', '#22C55E', daysAgo(180), hoursAgo(1));
    insertUser.run('usr_agent2', workspaceId, '苏晚', 'agent2@supportpilot.local', passwordHash, 'AGENT', '#F59E0B', daysAgo(140), hoursAgo(6));
    insertUser.run('usr_customer', workspaceId, '周宁', 'customer@supportpilot.local', passwordHash, 'CUSTOMER', '#8B5CF6', daysAgo(120), hoursAgo(9));
    insertUser.run('usr_customer2', workspaceId, '许澄', 'customer2@supportpilot.local', passwordHash, 'CUSTOMER', '#EC4899', daysAgo(60), daysAgo(2));

    insertSla.run('sla_urgent', workspaceId, 'urgent', 15, 240, daysAgo(200), now);
    insertSla.run('sla_high', workspaceId, 'high', 30, 480, daysAgo(200), now);
    insertSla.run('sla_normal', workspaceId, 'normal', 120, 1440, daysAgo(200), now);
    insertSla.run('sla_low', workspaceId, 'low', 480, 2880, daysAgo(200), now);

    const settings: Record<string, string> = {
      workspace_name: '北岸云科技',
      csat_target: '4.5',
      ai_backend: 'mock',
      ai_base_url: '',
      ai_api_key: '',
      ai_model: 'supportpilot-mock-1',
      ai_auto_send: 'false',
      ai_confidence_threshold: '0.78',
      embedding_backend: 'local',
      embedding_base_url: '',
      embedding_api_key: '',
      embedding_model: 'supportpilot-hash-1536',
      embedding_dimensions: '1536',
      rag_top_k: '5',
      rag_min_score: '0.1',
    };
    for (const [key, value] of Object.entries(settings)) {
      insertSetting.run(key, value);
    }

    insertKb.run('kb_help', workspaceId, '帮助中心', '产品使用、账户、计费与安全政策', '#6D8BFF', daysAgo(190), daysAgo(3));
    insertKb.run('kb_api', workspaceId, '开发者文档', 'API、Webhook、限流与重试指南', '#0EA5E9', daysAgo(160), daysAgo(5));
    insertKb.run('kb_policy', workspaceId, '服务政策', 'SLA、DPA 与数据处理约定', '#8B5CF6', daysAgo(120), daysAgo(9));

    for (const doc of DOC_HELP) {
      insertDoc.run(doc.id, 'kb_help', doc.title, doc.content, estimateTokens(doc.content), daysAgo(90), daysAgo(2));
    }
    for (const doc of DOC_API) {
      insertDoc.run(doc.id, 'kb_api', doc.title, doc.content, estimateTokens(doc.content), daysAgo(70), daysAgo(4));
    }
    for (const doc of DOC_POLICY) {
      insertDoc.run(doc.id, 'kb_policy', doc.title, doc.content, estimateTokens(doc.content), daysAgo(60), daysAgo(6));
    }

    const customers = ['usr_customer', 'usr_customer2'];
    const agents = ['usr_agent', 'usr_agent2'];
    const statuses: Array<{ value: string; weight: number }> = [
      { value: 'resolved', weight: 34 },
      { value: 'closed', weight: 14 },
      { value: 'waiting_customer', weight: 6 },
      { value: 'ai_drafted', weight: 4 },
      { value: 'triaged', weight: 3 },
      { value: 'escalated', weight: 2 },
      { value: 'new', weight: 1 },
    ];
    const statusPool: string[] = [];
    for (const status of statuses) {
      for (let i = 0; i < status.weight; i += 1) statusPool.push(status.value);
    }

    for (let i = 0; i < 64; i += 1) {
      const template = TEMPLATES[i % TEMPLATES.length];
      const customerId = customers[i % customers.length];
      const status = statusPool[i % statusPool.length];
      const priority = template.priority;
      const isActive = ['waiting_customer', 'ai_drafted', 'triaged', 'escalated', 'new'].includes(status);
      const activeMinutes =
        status === 'waiting_customer'
          ? 70 + (i % 4) * 22
          : status === 'escalated'
            ? 180 + (i % 3) * 30
            : status === 'new'
              ? 6
              : 18 + (i % 4) * 7;
      const createdAt = isActive
        ? new Date(Date.now() - activeMinutes * 60_000).toISOString()
        : new Date(
            Date.now() - (3 + (i % 26)) * 86_400_000 - (i % 8) * 3_600_000,
          ).toISOString();
      const sla = db
        .prepare('SELECT * FROM sla_policies WHERE priority = ?')
        .get(priority) as {
        id: string;
        first_response_minutes: number;
        resolution_minutes: number;
      };
      const firstDue = addMinutes(createdAt, sla.first_response_minutes);
      const resolutionDue = addMinutes(createdAt, sla.resolution_minutes);
      const assigned = status === 'new' ? null : agents[i % agents.length];
      const responded =
        status === 'waiting_customer' ||
        status === 'resolved' ||
        status === 'closed' ||
        (status === 'escalated' && i % 2 === 0);
      const firstLate = i % 12 === 0;
      const firstMinutes = firstLate
        ? Math.round(sla.first_response_minutes * 1.7)
        : Math.max(3, Math.round(sla.first_response_minutes * (0.35 + rand() * 0.45)));
      const firstResponseAt = responded
        ? addMinutes(createdAt, firstMinutes)
        : null;
      const resolutionLate = i % 13 === 0;
      const resolutionMinutes = resolutionLate
        ? Math.round(sla.resolution_minutes * 1.15)
        : Math.max(firstMinutes + 45, Math.round(sla.resolution_minutes * (0.35 + rand() * 0.4)));
      const resolved =
        status === 'resolved' || status === 'closed'
          ? addMinutes(createdAt, resolutionMinutes)
          : null;
      const closedAt = status === 'closed' ? addMinutes(resolved!, 240) : null;
      const csat =
        (status === 'resolved' || status === 'closed') && i % 4 !== 0
          ? 3 + Math.floor(rand() * 3)
          : null;
      const aiState =
        status === 'ai_drafted'
          ? 'drafted'
          : status === 'waiting_customer' && i % 2 === 0
            ? 'accepted'
            : (status === 'resolved' || status === 'closed') && i % 5 === 0
              ? 'auto_sent'
              : (status === 'resolved' || status === 'closed') && i % 3 === 0
                ? 'accepted'
                : 'none';
      const confidence =
        aiState === 'none' ? 0 : Math.min(0.96, 0.55 + rand() * 0.4);
      const riskFlags = priority === 'urgent' ? ['high_priority'] : [];
      const ticketId = `tkt_${1001 + i}`;
      const number = `SP-${1001 + i}`;
      const updatedAt = closedAt || resolved || firstResponseAt || createdAt;

      insertTicket.run(
        ticketId,
        number,
        workspaceId,
        customerId,
        assigned,
        template.subject,
        status,
        priority,
        template.category,
        priority === 'urgent' ? 'negative' : rand() > 0.75 ? 'negative' : 'neutral',
        i % 3 === 0 ? 'email' : 'portal',
        aiState,
        confidence,
        aiState === 'none' ? '' : `${template.subject}，需要根据知识库给出可执行的处理建议。`,
        JSON.stringify(riskFlags),
        JSON.stringify(template.tags),
        sla.id,
        firstDue,
        resolutionDue,
        firstResponseAt,
        resolved,
        closedAt,
        csat,
        createdAt,
        createdAt,
        updatedAt,
      );

      insertMessage.run(
        `msg_${1001 + i}_1`,
        ticketId,
        customerId,
        'customer',
        'public',
        template.message,
        '[]',
        0,
        null,
        createdAt,
      );

      if (responded) {
        const replyAt = firstResponseAt!;
        const isAi = aiState === 'auto_sent';
        const agentName = assigned === 'usr_agent' ? '陈默' : '苏晚';
        const categoryReply: Record<string, string> = {
          billing: '我已收到你的账单问题，正在核对订单、席位和本期用量，稍后会给你一份明确的费用明细。',
          refund: '我已收到退款申请，会先核对订单号和购买时间。如果符合 7 天退款政策，我会立即为你提交审核。',
          technical: '我已收到。为了快速定位，请补充 request id、错误发生时间和调用端点，我会同时检查服务端日志。',
          account: '我已收到账号问题。为保护账号安全，我会先进行必要的身份核验，然后协助你恢复访问。',
          feature: '感谢你的建议，我已经记录下这个使用场景，并会同步给产品团队评估。',
          other: '我已收到你的问题，正在进一步核查，有结论会第一时间在这里回复你。',
        };
        insertMessage.run(
          `msg_${1001 + i}_2`,
          ticketId,
          isAi ? null : assigned,
          isAi ? 'ai' : 'agent',
          'public',
          isAi
            ? `你好，已收到你的问题。根据当前知识库，我们建议先核对相关信息，并按照对应步骤处理。如果仍未解决，我会继续为你跟进。`
            : `你好，我是${agentName}。${categoryReply[template.category] || categoryReply.other}`,
          '[]',
          isAi ? 1 : 0,
          null,
          replyAt,
        );
      }

      if (aiState !== 'none') {
        const runId = `run_${1001 + i}`;
        insertRun.run(
          runId,
          ticketId,
          workspaceId,
          assigned || 'usr_owner',
          aiState === 'accepted' || aiState === 'auto_sent'
            ? 'accepted'
            : 'completed',
          template.category,
          priority,
          priority === 'urgent' ? 'negative' : 'neutral',
          `${template.subject}：客户需要针对性的处理方案。`,
          confidence,
          JSON.stringify(riskFlags),
          aiState === 'auto_sent' ? 'auto_send' : 'human_review',
          `你好，关于「${template.subject}」，我们已在知识库中核对相关说明。建议按照对应政策处理，并确认客户当前账号与订单信息。如果涉及账户安全或退款审核，会由人工继续跟进。`,
          JSON.stringify([
            {
              index: 1,
              title: template.category === 'technical' ? 'API 常见错误' : '帮助中心 › 相关说明',
              snippet: '根据知识库中的政策与操作步骤，优先核对账号、订单或接口返回信息。',
              score: Math.round(confidence * 100) / 100,
            },
          ]),
          'supportpilot-mock-1',
          820,
          240,
          900 + Math.floor(rand() * 800),
          createdAt,
          aiState === 'accepted' || aiState === 'auto_sent' ? firstResponseAt : null,
        );
        insertEvent.run(
          `evt_${1001 + i}_ai`,
          ticketId,
          assigned || 'usr_owner',
          'ai.draft',
          null,
          aiState,
          'AI 生成处理建议',
          createdAt,
        );
      }

      insertEvent.run(
        `evt_${1001 + i}_status`,
        ticketId,
        assigned || 'usr_owner',
        'ticket.status',
        'new',
        status,
        `工单进入 ${status} 状态`,
        updatedAt,
      );
    }

    const cases: Array<[string, string, string, string, string]> = [
      ['忘记密码后如何重置？', 'account', '密码', 'kb_help', 'easy'],
      ['两步验证手机丢了怎么办？', 'account', '两步验证', 'kb_help', 'normal'],
      ['连续输错密码账号被锁定多久？', 'account', '锁定', 'kb_help', 'easy'],
      ['如何修改发票抬头和税号？', 'billing', '发票', 'kb_help', 'easy'],
      ['为什么账单金额比上月高？', 'billing', '账单', 'kb_help', 'normal'],
      ['升级套餐后如何计费？', 'billing', '升级', 'kb_help', 'normal'],
      ['购买后 7 天内可以全额退款吗？', 'refund', '7 天', 'kb_help', 'easy'],
      ['退款多久能到账？', 'refund', '退款', 'kb_help', 'easy'],
      ['API 返回 401 是什么原因？', 'technical', '401', 'kb_api', 'easy'],
      ['遇到 429 应该如何重试？', 'technical', '429', 'kb_api', 'normal'],
      ['Webhook 失败会重试几次？', 'technical', 'Webhook', 'kb_help', 'normal'],
      ['如何导出全部历史数据？', 'technical', '导出', 'kb_help', 'normal'],
      ['支持 SAML SSO 吗？', 'account', 'SAML', 'kb_help', 'normal'],
      ['数据保留周期可以调整吗？', 'technical', '保留', 'kb_help', 'normal'],
      ['平台通过 SOC 2 审计了吗？', 'technical', 'SOC 2', 'kb_help', 'easy'],
      ['企业版 SLA 的响应时间是多少？', 'technical', '15 分钟', 'kb_policy', 'normal'],
      ['如何防止创建接口重复写入？', 'technical', 'Idempotency', 'kb_api', 'hard'],
      ['API 分页最多返回多少条？', 'technical', '100', 'kb_api', 'hard'],
      ['企业版支持私有化部署吗？', 'billing', '企业版', 'kb_help', 'normal'],
      ['发票可以重开吗？', 'billing', '重开', 'kb_help', 'normal'],
      ['数据删除后多久生效？', 'technical', '30 天', 'kb_help', 'hard'],
      ['SSO 如何关闭密码登录？', 'account', 'SSO', 'kb_help', 'hard'],
      ['Webhook 要求多久内返回？', 'technical', '5 秒', 'kb_help', 'normal'],
      ['退款审核需要哪些材料？', 'refund', '订单号', 'kb_help', 'normal'],
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const [question, category, keyword, kbId, difficulty] = cases[i];
      insertCase.run(
        `case_${i + 1}`,
        workspaceId,
        question,
        category,
        keyword,
        kbId,
        difficulty,
        now,
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
