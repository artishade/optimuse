/**
 * Provider abstraction — any OpenAI-compatible /chat/completions endpoint.
 */

import type { ChatMessage, ToolCallRequest, ToolDefinition } from '../../types/index.js';
import { buildJsonSchema } from '../../tools/registry.js';
import { createId } from '../../util/id.js';

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCallRequest[];
  usage?: { promptTokens: number; completionTokens: number };
  stopReason: 'stop' | 'tool_calls' | 'length' | 'error';
  error?: string;
}

export interface Provider {
  chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<ChatResponse>;
}

export class OpenAICompatibleProvider implements Provider {
  constructor(protected cfg: ProviderConfig) {}

  /** Update the provider's configuration at runtime (used when settings change via UI). */
  updateConfig(newCfg: Partial<ProviderConfig>): void {
    this.cfg = { ...this.cfg, ...newCfg };
  }

  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: messages.map(toWire),
      stream: false,
    };
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: buildJsonSchema(t),
        },
      }));
    }

    const ctrl = new AbortController();
    const onAbort = (): void => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const timeout = this.cfg.timeoutMs ?? 120_000;
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.apiKey}`,
          ...this.cfg.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          content: '',
          toolCalls: [],
          stopReason: 'error',
          error: `provider http ${res.status}: ${text.slice(0, 500)}`,
        };
      }

      const json = (await res.json()) as any;
      const choice = json?.choices?.[0];
      const msg = choice?.message ?? {};

      const toolCalls: ToolCallRequest[] = [];
      for (const c of (msg.tool_calls ?? []) as any[]) {
        let args: Record<string, unknown> = {};
        try {
          args =
            typeof c.function?.arguments === 'string'
              ? JSON.parse(c.function.arguments)
              : (c.function?.arguments ?? {});
        } catch {
          args = { _raw: c.function?.arguments };
        }
        toolCalls.push({
          id: c.id ?? createId('call'),
          name: c.function?.name ?? '',
          arguments: args,
        });
      }

      return {
        content: msg.content ?? '',
        toolCalls,
        usage: json?.usage
          ? {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
            }
          : undefined,
        stopReason: mapFinishReason(choice?.finish_reason),
      };
    } catch (err) {
      return {
        content: '',
        toolCalls: [],
        stopReason: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

function mapFinishReason(r: string | undefined): ChatResponse['stopReason'] {
  switch (r) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'stop':
    case undefined:
    case null:
      return 'stop';
    default:
      return 'stop';
  }
}

function toWire(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: m.toolCallId ?? '',
        content: m.content,
      };
    case 'assistant': {
      const out: Record<string, unknown> = { role: 'assistant', content: m.content || null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        out.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        }));
      }
      return out;
    }
    default:
      return { role: m.role, content: m.content };
  }
}