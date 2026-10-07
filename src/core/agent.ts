/**
 * The agent loop: user message → model → tools → model → ... → final answer.
 * Deliberately small; every layer (tools/providers/persistence) plugs in from outside.
 */

import type {
  AgentOptions,
  ChatMessage,
  ToolCallRequest,
  ToolContext,
  ToolResult,
} from '../types/index.js';
import type { Provider } from '../providers/openai/provider.js';
import { ToolExecutor, ToolRegistry } from '../tools/registry.js';

export interface AgentRunResult {
  finalText: string;
  steps: number;
  toolCalls: number;
  toolResults: ToolResult[];
  error?: string;
}

export class Agent {
  private executor: ToolExecutor;

  constructor(
    private provider: Provider,
    private registry: ToolRegistry,
    private opts: AgentOptions,
  ) {
    this.executor = new ToolExecutor(registry);
  }

  async run(userMessage: string, history: ChatMessage[] = []): Promise<AgentRunResult> {
    const maxSteps = this.opts.maxSteps ?? 12;
    const messages: ChatMessage[] = [...history, { role: 'user', content: userMessage }];

    const ctx: ToolContext = {
      workspaceRoot: this.opts.workspaceRoot,
      permissionMode: this.opts.permissionMode,
      requestApproval: this.opts.requestApproval,
      runState: new Map(),
    };

    const toolResults: ToolResult[] = [];
    let steps = 0;
    let toolCalls = 0;
    let finalText = '';

    for (let step = 0; step < maxSteps; step++) {
      steps = step + 1;

      const response = await this.provider.chat(messages, this.registry.list());

      if (response.stopReason === 'error') {
        return {
          finalText: finalText || 'Provider error.',
          steps,
          toolCalls,
          toolResults,
          error: response.error,
        };
      }

      if (response.content) {
        finalText = response.content;
        this.opts.onToken?.(response.content);
      }

      // No tool calls → the model is done; this is the final answer.
      if (response.toolCalls.length === 0 || response.stopReason !== 'tool_calls') {
        messages.push({ role: 'assistant', content: response.content });
        return { finalText, steps, toolCalls, toolResults };
      }

      // Record assistant turn with its tool calls, then execute them in order.
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      };
      messages.push(assistantMsg);

      for (const call of response.toolCalls) {
        toolCalls++;
        this.opts.onToolCall?.(call);
        const { result } = await this.executor.execute(call, ctx);
        toolResults.push(result);
        this.opts.onToolResult?.(call, result);

        messages.push({
          role: 'tool',
          content: formatToolResult(call, result),
          toolCallId: call.id,
          toolName: call.name,
        });
      }
    }

    return {
      finalText: finalText || '(stopped at max steps)',
      steps,
      toolCalls,
      toolResults,
    };
  }
}

function formatToolResult(call: ToolCallRequest, result: ToolResult): string {
  if (!result.ok) {
    return `ERROR: ${result.error ?? 'unknown error'}`;
  }
  const header = result.data !== undefined ? `${result.content}\n[data]: ${JSON.stringify(result.data)}` : result.content;
  return header || '(empty result)';
}
