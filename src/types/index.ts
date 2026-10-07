/**
 * Core shared types.
 */

export type ToolEffect = 'read' | 'write';

export type PermissionMode = 'readonly' | 'workspace' | 'full';

export interface ToolResult {
  ok: boolean;
  /** Machine-readable result content (string or JSON-safe value). */
  content: string;
  /** Optional structured data attached to the result. */
  data?: unknown;
  error?: string;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  /** Simple enum support for string params. */
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  effect: ToolEffect;
  parameters: ToolParameter[];
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  /** Working directory root; file tools are jailed here. */
  workspaceRoot: string;
  permissionMode: PermissionMode;
  /** Ask the user to approve a tool call (interactive surfaces override). */
  requestApproval?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  /** Abort signal propagated from the agent loop. */
  signal?: AbortSignal;
  /** Key-value scratchpad shared across one agent run. */
  runState: Map<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For role=assistant: tool calls requested by the model. */
  toolCalls?: ToolCallRequest[];
  /** For role=tool: which call this answers. */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentOptions {
  permissionMode: PermissionMode;
  workspaceRoot: string;
  maxSteps?: number;
  /** Called for each assistant chunk as it streams. */
  onToken?: (text: string) => void;
  /** Called before each tool execution. */
  onToolCall?: (call: ToolCallRequest) => void;
  /** Called after each tool execution with its result. */
  onToolResult?: (call: ToolCallRequest, result: ToolResult) => void;
  requestApproval?: ToolContext['requestApproval'];
}
