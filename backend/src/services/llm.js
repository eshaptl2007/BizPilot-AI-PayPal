// Thin, provider-agnostic LLM client (Anthropic Claude or OpenAI) using plain fetch.
// Returns text; callers parse/validate. Throws on any failure so callers can fall back.
import { config } from '../config.js';
import { extractJson } from '../utils/json.js';

export const llmAvailable = () => config.ai.provider === 'anthropic' || config.ai.provider === 'openai';

async function post(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.ai.timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

export async function callLLM({ system, user, maxTokens = 2000 }) {
  const { provider } = config.ai;
  if (provider === 'anthropic') {
    const data = await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': config.ai.anthropicKey, 'anthropic-version': '2023-06-01' },
      { model: config.ai.anthropicModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
    );
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, provider, model: config.ai.anthropicModel };
  }
  if (provider === 'openai') {
    const data = await post(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${config.ai.openaiKey}` },
      {
        model: config.ai.openaiModel,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      },
    );
    return { text: data.choices?.[0]?.message?.content || '', provider, model: config.ai.openaiModel };
  }
  throw new Error('No LLM provider configured');
}

export { extractJson };
