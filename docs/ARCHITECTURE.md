# SupportPilot 架构说明

## 1. 系统结构

```text
Browser
  ├─ 客服工作台（React SPA）
  └─ 客户门户（同一 SPA，按角色路由）
        │ REST / JSON + Bearer JWT
        ▼
Express API
  ├─ auth / tickets / ai / portal
  ├─ analytics / evaluation
  ├─ knowledge / settings
  ├─ ticket state machine + SLA
  ├─ RAG service
  └─ AI support service
        │
        ├── node:sqlite（业务数据）
        └── VectorStore 抽象
              ├── SQLite 向量表（本地）
              └── PostgreSQL + pgvector（生产）
```

## 2. 工单域模型

```text
users 1─n tickets (customer)
users 1─n tickets (assignee)
tickets 1─n ticket_messages
tickets 1─n ai_runs
tickets 1─n ticket_events
knowledge_bases 1─n documents 1─n document_chunks
eval_cases 1─n eval_results n─1 eval_runs
```

关键字段：

- `tickets.status`：`new / triaged / ai_drafted / waiting_customer / escalated / resolved / closed`
- `tickets.ai_state`：`none / drafted / accepted / rejected / auto_sent / escalated`
- `tickets.priority`：`urgent / high / normal / low`
- `tickets.first_response_due_at / resolution_due_at`
- `tickets.csat`

## 3. 状态机

所有流转集中在 `lib/ticket-state.ts`，不允许路由层随意写状态。

```text
new → triaged → ai_drafted → waiting_customer → resolved → closed
 │        │           │              │
 │        └───────────┴──────────────┴──→ escalated
 └────────────────────────────────────────→ escalated

resolved/closed + 客户回复 → triaged（重新打开）
```

每次状态变更：

1. 校验 `canTransition`
2. 更新状态与时间戳
3. 写 `ticket_events`
4. 写 `audit_logs`
5. 返回完整工单详情

## 4. SLA

`lib/sla.ts`：

- 按工作区 + 优先级读取 SLA 策略
- 创建工单时计算 `first_response_due_at`、`resolution_due_at`
- AI 分诊提升优先级时重算 due date
- 计算 first response / resolution 的 `met / on_track / at_risk / breached`
- 首次公开客服或 AI 回复写入 `first_response_at`
- 解决写入 `resolved_at`

## 5. AI 协同链路

```text
ticket messages
  → 最近客户消息拼接
  → classifyTicket（分类/优先级/情绪/风险）
  → retrieveForWorkspace（混合检索）
  → draft（模拟或 OpenAI 兼容 chat completion）
  → confidence + recommended_action
  → ai_runs
  → human review / auto send / escalate
```

### 决策规则

- 低于置信度阈值 → `human_review`
- 退款、账号安全、法律投诉、紧急 → 强制人工
- 没有知识引用 → `escalate`
- 设置开启自动发送 + 高置信度 + 无风险 → `auto_send`

### 人工审核

`accept`：

- 使用编辑后的草稿
- 创建 `agent` 公开消息，写入 `first_response_at`
- 状态变为 `waiting_customer`
- `ai_runs.status=accepted`

`reject`：

- `ai_runs.status=rejected`
- 工单回到 `triaged`

## 6. RAG

- Markdown 标题感知切片，≤900 字，overlap 140 字
- 文档异步索引，`index_jobs` 持久化
- 本地模式：SQLite + 字符 n-gram 特征哈希
- 生产模式：OpenAI 兼容 Embedding + pgvector + HNSW
- 检索：向量 Top N + 关键词 Top N → 混合打分
- `0.70 × vector + 0.30 × keyword`，每文档最多 2 段
- 引用写入 `ticket_messages.citations` / `ai_runs.citations`

## 7. 评测

`/api/evaluation/run`：

1. 读取 24 条黄金用例
2. 对每条用例执行分类 + 检索
3. 计算：
   - 意图准确率
   - 检索召回率（期望关键词是否出现在 Top 5 片段）
   - 引用覆盖率
   - 平均延迟 / 置信度
4. 写入 `eval_runs` + `eval_results`
5. 工作台展示指标、历史运行和逐条明细

## 8. 权限

| 能力 | OWNER | ADMIN | AGENT | CUSTOMER |
| --- | --- | --- | --- | --- |
| 客服工作台 | ✓ | ✓ | ✓ | — |
| 查看所有工单 | ✓ | ✓ | ✓ | — |
| 处理工单 / AI | ✓ | ✓ | ✓ | — |
| 修改设置 / 评测 | ✓ | ✓ | — | — |
| 客户门户 | — | — | — | ✓ |
| 查看自己的工单 | — | — | — | ✓ |

客户门户的查询强制附带 `customer_id`，客服端强制附带 `workspace_id`。

## 9. 部署

- 开发：Vite 5174 → API 8788
- 生产：Express 托管 `apps/web/dist`
- Docker：应用 + pgvector
- 业务数据 SQLite volume；向量数据 pgvector volume
- 生产多实例：PostgreSQL + Redis 队列锁 + 会话存储

## 10. 已知边界

- SQLite 业务库单实例
- 单进程索引队列
- 未实现 PDF / DOCX 解析
- 未实现文档级 ACL
- 本地哈希向量仅用于演示
- pgvector 路径需在 Docker/PostgreSQL 环境验证
