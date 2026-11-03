import { getDb } from '../db/index.js';
import { decryptSecret } from './crypto.js';
import { ApiError } from './errors.js';

export type AiBackend = 'mock' | 'openai';

export interface AiSettings {
  backend: AiBackend;
  baseUrl: string;
  hasKey: boolean;
  model: string;
  autoSend: boolean;
  confidenceThreshold: number;
}

export interface ResolvedAiConfig extends AiSettings {
  apiKey?: string;
}

function setting(key: string, fallback: string): string {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value || fallback;
}

export function getAiSettings(): AiSettings {
  return {
    backend: setting('ai_backend', 'mock') === 'openai' ? 'openai' : 'mock',
    baseUrl: setting('ai_base_url', ''),
    hasKey: Boolean(decryptSecret(setting('ai_api_key', ''))),
    model: setting('ai_model', 'supportpilot-mock-1'),
    autoSend: setting('ai_auto_send', 'false') === 'true',
    confidenceThreshold: Math.max(
      0.3,
      Math.min(0.99, Number(setting('ai_confidence_threshold', '0.78')) || 0.78),
    ),
  };
}

export function resolveAiConfig(): ResolvedAiConfig {
  const settings = getAiSettings();
  const apiKey = decryptSecret(setting('ai_api_key', ''));
  if (settings.backend === 'openai') {
    if (!settings.baseUrl) {
      throw new ApiError(422, 'AI_BASE_URL_MISSING', '请配置 AI 服务的 Base URL');
    }
    if (!apiKey) {
      throw new ApiError(422, 'AI_KEY_MISSING', '请配置 AI 服务的 API Key');
    }
    if (!settings.model) {
      throw new ApiError(422, 'AI_MODEL_MISSING', '请配置 AI 模型名称');
    }
  }
  return { ...settings, apiKey };
}

export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}> {
  const config = resolveAiConfig();
  if (config.backend === 'mock') {
    throw new ApiError(500, 'MOCK_ROUTE', '模拟模式不应调用真实模型');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 700,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ApiError(
        502,
        'AI_PROVIDER_ERROR',
        `AI 服务返回 ${response.status}`,
        detail.slice(0, 300),
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content?.trim() || '';
    if (!content) {
      throw new ApiError(502, 'AI_EMPTY', 'AI 服务没有返回内容');
    }
    return {
      content,
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      model: config.model,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      502,
      'AI_UNREACHABLE',
      `无法连接 AI 服务：${error instanceof Error ? error.message : '未知错误'}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function testAiConnection(): Promise<{
  ok: boolean;
  model: string;
  latencyMs: number;
  content: string;
}> {
  const started = Date.now();
  const config = resolveAiConfig();
  if (config.backend === 'mock') {
    return {
      ok: true,
      model: 'supportpilot-mock-1',
      latencyMs: Date.now() - started,
      content: '模拟引擎运行正常',
    };
  }
  const result = await chatCompletion(
    [
      {
        role: 'system',
        content: '你是一个连通性测试助手，只回答“连接成功”。',
      },
      { role: 'user', content: '请回复：连接成功' },
    ],
    { maxTokens: 20, temperature: 0 },
  );
  return {
    ok: true,
    model: result.model,
    latencyMs: Date.now() - started,
    content: result.content,
  };
}
