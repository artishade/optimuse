/**
 * Tool registry + permission gate + executor.
 * One class, three jobs — deliberately small and auditable.
 */

import type {
  ChatMessage,
  PermissionMode,
  ToolCallRequest,
  ToolContext,
  ToolDefinition,
  ToolEffect,
  ToolResult,
} from '../types/index.js';
import { createId } from '../util/id.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** OpenAI-style JSON schema list for the model. */
  toSchema(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return this.list().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: buildJsonSchema(t),
      },
    }));
  }
}

/** Build a JSON schema from our flat parameter spec. */
export function buildJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of tool.parameters) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.enum) prop.enum = p.enum;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  return { type: 'object', properties, required };
}

/** Resolve whether a call is allowed by the permission model. */
export function checkPermission(
  mode: PermissionMode,
  effect: ToolEffect,
  isWorkspacePath: boolean,
): 'allow' | 'ask' | 'deny' {
switch (mode) {
    case 'readonly':
      return effect === 'read' ? 'allow' : 'deny';
    case 'workspace':
      return effect === 'read' ? 'allow' : 'ask';
    case 'full':
      return 'allow';
  }
}
export interface ExecutionOutcome {
  result: ToolResult;
  approved: boolean;
}

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  /**
   * Permission gate → execute → normalize errors into ToolResult.
   * Never throws; every failure becomes a ToolResult the model can read.
   */
  async execute(
    call: ToolCallRequest,
    ctx: ToolContext,
  ): Promise<ExecutionOutcome> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return {
        result: { ok: false, content: '', error: `unknown tool: ${call.name}` },
        approved: false,
      };
    }

    const effect = tool.effect;
    const inWorkspace = isInside(ctx.workspaceRoot, String(call.arguments['path'] ?? ''));
    const verdict = checkPermission(ctx.permissionMode, effect, inWorkspace);

    if (verdict === 'deny') {
      return {
        result: {
          ok: false,
          content: '',
          error: `permission denied: ${ctx.permissionMode} mode blocks ${effect} operations for ${call.name}`,
        },
        approved: false,
      };
    }

    if (verdict === 'ask' && ctx.requestApproval) {
      const approved = await ctx.requestApproval(call.name, call.arguments);
      if (!approved) {
        return {
          result: { ok: false, content: '', error: 'user denied this tool call' },
          approved: false,
        };
      }
    }

    try {
      const result = await tool.execute(call.arguments, ctx);
      return { result, approved: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: { ok: false, content: '', error: `tool crashed: ${message}` },
        approved: true,
      };
    }
  }
}

function isInside(root: string, p: string): boolean {
  if (!p) return true;
  const resolved = p.startsWith('/') ? p : `${root}/${p}`;
  return resolved === root || resolved.startsWith(root + '/');
}

export function makeToolCallId(): string {
  return createId('call');
}