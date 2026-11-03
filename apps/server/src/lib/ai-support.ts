import { estimateTokens } from './tokens.js';
import { retrieveForWorkspace, type WorkspaceRagResult } from './rag.js';
import {
  getAiSettings,
  resolveAiConfig,
  chatCompletion,
} from './ai-config.js';
import type { Citation } from './retrieval.js';
import type { TicketCategory, TicketPriority, Sentiment } from '../types.js';

export interface AiClassification {
  category: TicketCategory;
  priority: TicketPriority;
  sentiment: Sentiment;
  summary: string;
  riskFlags: string[];
}

export interface SupportDraft {
  classification: AiClassification;
  draft: string;
  citations: Citation[];
  confidence: number;
  recommendedAction: 'auto_send' | 'human_review' | 'escalate';
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  ragMode: 'hybrid' | 'keyword';
  warning?: string;
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function classifyTicket(
  subject: string,
  content: string,
): AiClassification {
  const text = `${subject}\n${content}`.toLowerCase();
  let category: TicketCategory = 'other';
  if (includesAny(text, ['退款', '退订', '退货', '取消订阅', 'refund']))
    category = 'refund';
  else if (includesAny(text, ['发票', '账单', '扣费', '支付', 'invoice', 'billing', '套餐', '升级', '企业版']))
    category = 'billing';
  else if (includesAny(text, ['登录', '密码', '账号', '验证码', '2fa', 'sso', '锁定', '成员']))
    category = 'account';
  else if (includesAny(text, ['希望', '建议', '能否增加', '需求', 'feature']))
    category = 'feature';
  else if (includesAny(text, ['api', '401', '429', 'webhook', '接口', '导出', '数据', 'soc', '保留', 'sla', '错误', '失败', '限流']))
    category = 'technical';

  let priority: TicketPriority = 'normal';
  if (includesAny(text, ['宕机', '无法登录', '数据丢失', '生产环境', '全部不可用', '紧急', '安全漏洞', '被盗', '监管']))
    priority = 'urgent';
  else if (includesAny(text, ['退款', '扣费', '管理员', '401', '429', '投诉', '失败', '丢失', '无法使用']))
    priority = 'high';
  else if (includesAny(text, ['希望', '建议', '能否增加', '评估', '低优先级']))
    priority = 'low';

  const sentiment: Sentiment = includesAny(text, ['投诉', '生气', '失望', '急', '多扣', '没有解决', '糟糕', '无法'])
    ? 'negative'
    : includesAny(text, ['谢谢', '感谢', '满意', '很好'])
      ? 'positive'
      : 'neutral';

  const riskFlags: string[] = [];
  if (category === 'refund') riskFlags.push('refund_policy');
  if (category === 'account') riskFlags.push('account_security');
  if (priority === 'urgent') riskFlags.push('high_priority');
  if (includesAny(text, ['投诉', '律师', '监管', '起诉'])) riskFlags.push('legal_complaint');

  return {
    category,
    priority,
    sentiment,
    summary: `${subject}：${content.replace(/\s+/g, ' ').slice(0, 90)}`,
    riskFlags,
  };
}

function draftFromCitations(
  customerName: string,
  subject: string,
  citations: Citation[],
): string {
  const steps = citations
    .slice(0, 3)
    .map((citation, index) => {
      const snippet = citation.snippet.replace(/\s+/g, ' ').slice(0, 130);
      return `${index + 1}. ${snippet} [资料 ${index + 1}]`;
    })
    .join('\n');

  return `你好，${customerName}：

感谢联系北岸云支持团队。关于「${subject}」，我们根据帮助中心整理了以下处理建议：

${steps}

如果以上步骤仍未解决，请直接回复本工单，并附上账号、订单号或 request id，我们会继续为你跟进。`;
}

export async function generateSupportDraft(params: {
  workspaceId: string;
  customerName: string;
  subject: string;
  query: string;
}): Promise<SupportDraft> {
  const started = Date.now();
  const classification = classifyTicket(params.subject, params.query);
  const rag: WorkspaceRagResult = await retrieveForWorkspace(
    params.workspaceId,
    `${params.subject}\n${params.query}`,
    5,
  );
  const settings = getAiSettings();
  const topScore = rag.citations[0]?.score ?? 0;
  const confidence = rag.citations.length
    ? Math.min(
        0.96,
        0.42 +
          Math.min(0.4, topScore * 1.15) +
          Math.min(0.08, rag.citations.length * 0.025),
      )
    : Math.min(0.35, 0.2 + topScore * 0.4);

  const riskFlags = [...classification.riskFlags];
  if (rag.citations.length === 0) riskFlags.push('knowledge_gap');

  let draft = rag.citations.length
    ? draftFromCitations(
        params.customerName,
        params.subject,
        rag.citations,
      )
    : `你好，${params.customerName}：

感谢联系北岸云支持团队。关于「${params.subject}」，目前知识库中没有完全匹配的处理说明。为了避免给出错误信息，我已经将问题标记为需要人工核查，客服同事会尽快接手并给你明确答复。`;

  let model = 'supportpilot-mock-1';
  let promptTokens = 300;
  let completionTokens = estimateTokens(draft);
  let warning = rag.warning;

  if (settings.backend === 'openai') {
    try {
      const config = resolveAiConfig();
      const context = rag.context || '没有检索到相关资料。';
      const result = await chatCompletion(
        [
          {
            role: 'system',
            content:
              '你是北岸云科技的客户支持专家。请用简体中文、专业且共情的语气写一封可直接发送给客户的回复。只能依据提供的资料回答，不得编造政策或承诺。回答控制在 180 字以内，保留关键步骤，并在句末用 [资料 N] 标注来源。如果资料不足，明确说明需要人工进一步核查。',
          },
          {
            role: 'user',
            content: `客户：${params.customerName}\n工单主题：${params.subject}\n问题：${params.query}\n\n参考资料：\n${context}`,
          },
        ],
        { temperature: 0.25, maxTokens: 500 },
      );
      draft = result.content;
      model = config.model;
      promptTokens = result.promptTokens;
      completionTokens = result.completionTokens;
    } catch (error) {
      warning = `真实模型调用失败，已使用模拟草稿：${
        error instanceof Error ? error.message : '未知错误'
      }`;
    }
  }

  const needsHuman =
    !settings.autoSend ||
    confidence < settings.confidenceThreshold ||
    riskFlags.length > 0 ||
    classification.priority === 'urgent';
  const recommendedAction: SupportDraft['recommendedAction'] =
    rag.citations.length === 0
      ? 'escalate'
      : needsHuman
        ? 'human_review'
        : 'auto_send';

  return {
    classification,
    draft,
    citations: rag.citations,
    confidence: Math.round(confidence * 1000) / 1000,
    recommendedAction,
    model,
    promptTokens,
    completionTokens,
    latencyMs: Date.now() - started,
    ragMode: rag.mode,
    warning,
  };
}
