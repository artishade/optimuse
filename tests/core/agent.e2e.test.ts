import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import type { Provider, ChatResponse } from '../../src/providers/openai/provider.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ChatMessage, ToolDefinition } from '../../src/types/index.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Mock provider: turn 1 asks for a tool call, turn 2 gives the final answer. */
function scriptedProvider(script: ChatResponse[]): Provider {
  let i = 0;
  return {
    async chat(_messages: ChatMessage[]): Promise<ChatResponse> {
      const next = script[Math.min(i, script.length - 1)];
      i++;
      return next;
    },
  };
}

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'echo the input',
  effect: 'read',
  parameters: [{ name: 'text', type: 'string', description: 'text to echo', required: true }],
  async execute(args) {
    return { ok: true, content: `echo: ${args['text']}` };
  },
};

describe('Agent end-to-end', () => {
  it('runs tool calls through the full loop', async () => {
    const provider = scriptedProvider([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'echo', arguments: { text: 'hello optimuse' } }],
        stopReason: 'tool_calls',
      },
      { content: 'done: echo: hello optimuse', toolCalls: [], stopReason: 'stop' },
    ]);
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const agent = new Agent(provider, registry, {
      permissionMode: 'full',
      workspaceRoot: os.tmpdir(),
    });

    const result = await agent.run('say hi via echo');
    expect(result.finalText).toBe('done: echo: hello optimuse');
    expect(result.toolCalls).toBe(1);
    expect(result.toolResults[0]?.ok).toBe(true);
    expect(result.steps).toBe(2);
  });

  it('readonly mode blocks write tools', async () => {
    const provider = scriptedProvider([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'w', arguments: {} }],
        stopReason: 'tool_calls',
      },
      { content: 'ok', toolCalls: [], stopReason: 'stop' },
    ]);
    const writeTool: ToolDefinition = {
      name: 'w',
      description: 'write tool',
      effect: 'write',
      parameters: [],
      async execute() { return { ok: true, content: 'written' }; },
    };
    const registry = new ToolRegistry();
    registry.register(writeTool);
    const agent = new Agent(provider, registry, {
      permissionMode: 'readonly',
      workspaceRoot: os.tmpdir(),
    });

    const result = await agent.run('write something');
    expect(result.toolResults[0]?.ok).toBe(false);
    expect(result.toolResults[0]?.error).toContain('permission denied');
  });

  it('fs tools work inside workspace jail', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'optimuse-'));
    const provider = scriptedProvider([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'fs_write', arguments: { path: 'hello.txt', content: 'world' } }],
        stopReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{ id: 'c2', name: 'fs_read', arguments: { path: 'hello.txt' } }],
        stopReason: 'tool_calls',
      },
      { content: 'file says: world', toolCalls: [], stopReason: 'stop' },
    ]);
    const registry = new ToolRegistry();
    const { fsTools } = await import('../../src/tools/builtin/fs.js');
    for (const t of fsTools(dir)) registry.register(t);
    const agent = new Agent(provider, registry, {
      permissionMode: 'full',
      workspaceRoot: dir,
    });

    const result = await agent.run('write then read');
    expect(result.finalText).toBe('file says: world');
    expect(result.toolResults[1]?.content).toBe('world');
    const saved = await fs.readFile(path.join(dir, 'hello.txt'), 'utf8');
    expect(saved).toBe('world');
  });
});
