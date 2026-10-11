/**
 * Agent_Linux ↔ Optimuse integration adapter.
 *
 * Bridges the Python agent_linux service (real root shell, PTY sessions,
 * MCP, skills, plugins, SSH, browser, Agent X mesh) into the Optimuse
 * TypeScript agent framework as a unified ToolDefinition set.
 *
 * Communication: HTTP/HTTPS (same contract the console uses).
 * Authentication: X-Nova-Terminal-Token header.
 * Streaming: SSE for terminal output + browser frames.
 *
 * This is the "real root shell for commands execution" layer.
 */

import type { ToolDefinition, ToolResult, ToolContext } from '../types/index.js';

export interface AgentLinuxConfig {
  baseUrl: string;
  token: string;
  workspace: string;
}

export interface TerminalSession {
  id: string;
  label: string;
  cwd: string;
  running: boolean;
}

export interface TerminalOutput {
  output: string;
  exitCode: number;
  timedOut: boolean;
}

/**
 * AgentLinuxAdapter — provides all the tools from a running agent_linux service.
 *
 * This is NOT a local PTY implementation — it talks to the real agent_linux
 * HTTP API, so the agent gets access to:
 * - Real root shell sessions (PTY)
 * - Live browser automation
 * - SSH host execution
 * - MCP server tools (namespaced as mcp__server__tool)
 * - Python plugins (namespaced as plugin__name)
 * - Skills (context injection)
 * - Agent X mesh (peer delegation, bridges)
 * - Project Brain (zero-key Q&A)
 */
export class AgentLinuxAdapter {
  private cfg: AgentLinuxConfig;
  private sessions = new Map<string, TerminalSession>();
  private headers: Record<string, string>;

  constructor(config: AgentLinuxConfig) {
    this.cfg = config;
    this.headers = {
      'X-Nova-Terminal-Token': config.token,
      'Content-Type': 'application/json',
    };
  }

  /** Health check — verifies the agent_linux service is reachable and configured. */
  async health(): Promise<{ ok: boolean; agentbox: boolean; mesh: boolean; errors?: string[] }> {
    try {
      const res = await fetch(`${this.cfg.baseUrl}/health`, { headers: this.headers });
      if (!res.ok) return { ok: false, agentbox: false, mesh: false, errors: [`HTTP ${res.status}`] };
      const data = await res.json() as any;
      return {
        ok: true,
        agentbox: data.agentbox?.configured ?? false,
        mesh: data.agent_x?.enabled ?? false,
      };
    } catch (e) {
      return {
        ok: false,
        agentbox: false,
        mesh: false,
        errors: [(e as Error).message],
      };
    }
  }

  /** List terminal sessions from the agent_linux service. */
  async listSessions(): Promise<TerminalSession[]> {
    const res = await fetch(`${this.cfg.baseUrl}/terminal/pty/sessions`, { headers: this.headers });
    if (!res.ok) throw new Error(`sessions list failed: HTTP ${res.status}`);
    const data = await res.json() as any;
    return data.sessions || [];
  }

  /** Create a new terminal session. */
  async createSession(label?: string): Promise<TerminalSession> {
    const body: Record<string, unknown> = {};
    if (label) body.label = label;
    const res = await fetch(`${this.cfg.baseUrl}/terminal/pty/sessions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`session creation failed: HTTP ${res.status}`);
    const data = await res.json() as any;
    const session: TerminalSession = {
      id: data.session,
      label: data.info?.label || label || data.session,
      cwd: data.info?.cwd || this.cfg.workspace,
      running: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Run a command in a terminal session (visible to user). */
  async runCommand(command: string, sessionLabel?: string, timeoutMs = 60000): Promise<TerminalOutput> {
    // Use the /run endpoint for one-shot commands that land in a real tab
    const res = await fetch(`${this.cfg.baseUrl}/terminal/pty/run`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ command, label: sessionLabel, timeout: timeoutMs / 1000 }),
    });
    if (!res.ok) throw new Error(`command failed: HTTP ${res.status}`);
    const data = await res.json() as any;
    return {
      output: data.output || '',
      exitCode: data.code ?? 0,
      timedOut: data.timed_out || false,
    };
  }

  /** Stream terminal output via SSE for real-time visibility. */
  streamSession(sessionId: string): ReadableStream<any> {
    const boundary = '--';
    // SSE stream from /terminal/pty/stream?session=<id>&token=<token>
    const url = `${this.cfg.baseUrl}/terminal/pty/stream?session=${sessionId}&token=${this.cfg.token}`;

    return new ReadableStream({
      async start(controller) {
        const res = await fetch(url);
        if (!res.body) {
          controller.close();
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(decoder.decode(value, { stream: true }));
          }
        } catch (e) {
          controller.error(e);
        } finally {
          controller.close();
        }
      },
    });
  }

  /** Get all tools from the agent_linux extensions endpoint. */
  async listExtensionTools(): Promise<any[]> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/extensions/tools`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.tools || [];
  }

  /** Get MCP server tools (already namespaced as mcp__server__tool). */
  async getMcpTools(): Promise<any[]> {
    return this.listExtensionTools();
  }

  /** Get plugin tools (already namespaced as plugin__name). */
  async getPluginTools(): Promise<any[]> {
    return this.listExtensionTools();
  }

  /** Get skill list for context injection. */
  async getSkills(): Promise<any[]> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/extensions/skills`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.skills || [];
  }

  /** Read a skill's body for injection into the system prompt. */
  async readSkill(name: string): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/extensions/skills/${encodeURIComponent(name)}`, {
      headers: this.headers,
    });
    if (!res.ok) return '';
    const data = await res.json() as any;
    return data.skill?.body || '';
  }

  /** Ask the Project Brain (zero-key Q&A). */
  async askBrain(question: string): Promise<string> {
    const url = `${this.cfg.baseUrl}/agent/brain/ask?q=${encodeURIComponent(question)}`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) return `[Brain error: HTTP ${res.status}]`;
    const data = await res.json() as any;
    return data.answer || data.error || 'No answer from Brain.';
  }

  /** List saved SSH hosts (secrets masked). */
  async listSshHosts(): Promise<any[]> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/ssh/hosts`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.hosts || [];
  }

  /** List saved SSH keys (public halves only, no secrets). */
  async listSshKeys(): Promise<any[]> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/ssh/keys`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.keys || [];
  }

  /** Get SSH host details (for tool generation). */
  async getSshHost(name: string): Promise<any | null> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/ssh/hosts/${encodeURIComponent(name)}`, {
      headers: this.headers,
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.host || null;
  }

  /** List saved accounts (secrets masked). */
  async listAccounts(): Promise<any[]> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/accounts/accounts`, { headers: this.headers });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return data.accounts || [];
  }

  /** Get Agent X peer list. */
  async listPeers(): Promise<any[]> {
    const health = await this.health();
    // Agent X is available via /agent/x/peers
    try {
      const res = await fetch(`${this.cfg.baseUrl}/agent/x/peers`, { headers: this.headers });
      if (!res.ok) return [];
      const data = await res.json() as any;
      return data.peers || [];
    } catch {
      return [];
    }
  }

  /** Talk to a bridge (remote model) via Agent X mesh. */
  async meshTalk(peerId: string, message: string): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/x/talk`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ to: peerId, message }),
    });
    if (!res.ok) throw new Error(`mesh talk failed: HTTP ${res.status}`);
    const data = await res.json() as any;
    return data.reply || '';
  }

  /** Generate an image via agent_linux. */
  async generateImage(prompt: string, provider?: string, size?: string): Promise<{ url?: string; error?: string }> {
    const res = await fetch(`${this.cfg.baseUrl}/agent/images/generate`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ prompt, provider, size }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json() as any;
    return { url: data.url, error: data.error };
  }
}

/**
 * Convert an AgentLinux tool definition to Optimuse ToolDefinition.
 * Maps the agent_linux tool schema to the Optimuse format.
 */
function toOptimuseTool(agentLinuxTool: any, adapter: AgentLinuxAdapter): ToolDefinition {
  const fn = agentLinuxTool.function || agentLinuxTool;
  const name = fn.name as string;
  const description = fn.description as string;
  const parameters = fn.parameters as Record<string, unknown>;

  // Determine effect — MCP/plugin tools default to 'read' unless they look like writes
  let effect: 'read' | 'write' = 'read';
  const writeIndicators = ['create', 'update', 'delete', 'write', 'modify', 'remove', 'kill', 'send'];
  if (writeIndicators.some(w => name.includes(w) || description.toLowerCase().includes(w))) {
    effect = 'write';
  }

  // Convert parameters from OpenAI schema to Optimuse format
  const paramList: { name: string; type: string; description: string; required?: boolean }[] = [];
  const props = parameters.properties as Record<string, any> | undefined;
  const required = parameters.required as string[] | undefined;
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      paramList.push({
        name: key,
        type: (val as any).type || 'string',
        description: (val as any).description || '',
        required: required?.includes(key),
      });
    }
  }

  return {
    name,
    description,
    effect,
    parameters: paramList,
    async execute(args, ctx) {
      try {
        // Route to agent_linux
        const res = await fetch(`${adapter['cfg'].baseUrl}/agent/chat`, {
          method: 'POST',
          headers: {
            'X-Nova-Terminal-Token': adapter['cfg'].token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `Execute tool ${name} with args ${JSON.stringify(args)}`,
            // We use a tool execution mode — the agent_linux service handles tool routing
          }),
        });

        if (!res.ok) {
          return { ok: false, content: '', error: `HTTP ${res.status}` };
        }

        const data = await res.json() as any;

        if (data.error) {
          return { ok: false, content: '', error: data.error };
        }

        return {
          ok: true,
          content: data.finalText || data.reply || JSON.stringify(data),
          data: data,
        };
      } catch (err) {
        return {
          ok: false,
          content: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

/**
 * Create the full tool set from agent_linux, including shell, SSH, MCP, plugins,
 * skills, and mesh tools.
 */
export async function createAgentLinuxTools(
  config: AgentLinuxConfig,
): Promise<{ adapter: AgentLinuxAdapter; tools: ToolDefinition[]; toolsByType: Record<string, 'builtin' | 'mcp' | 'plugin' | 'bridge' | 'ssh' | 'skill'> }> {
  const adapter = new AgentLinuxAdapter(config);
  const tools: ToolDefinition[] = [];
  const toolsByType: Record<string, any> = {};

  // 1. Check health
  const health = await adapter.health();
  if (!health.ok) {
    throw new Error(`agent_linux service unreachable: ${(health.errors || []).join(', ')}`);
  }

  // 2. Shell tools (wrap the /run endpoint)
  tools.push({
    name: 'agentx_shell',
    description: 'Run a command in a real root shell PTY session on the agent_linux host. The command runs in a visible terminal tab the user can watch.',
    effect: 'write',
    parameters: [
      { name: 'command', type: 'string', description: 'The shell command to run', required: true },
      { name: 'label', type: 'string', description: 'Optional session label' },
      { name: 'timeout_ms', type: 'number', description: 'Timeout in ms (default 60000, max 300000)' },
    ],
    async execute(args) {
      const result = await adapter.runCommand(
        String(args['command'] ?? ''),
        String(args['label'] ?? undefined),
        Number(args['timeout_ms']) || 60000,
      );
      return {
        ok: true,
        content: `[exit=${result.exitCode}]\n${result.output}`,
        data: result,
      };
    },
  });
  toolsByType['agentx_shell'] = 'builtin';

  // 3. Terminal session management
  tools.push({
    name: 'agentx_list_sessions',
    description: 'List all active terminal sessions on the agent_linux host.',
    effect: 'read',
    parameters: [],
    async execute() {
      const sessions = await adapter.listSessions();
      return {
        ok: true,
        content: sessions.length
          ? sessions.map((s) => `${s.id} ${s.label} ${s.cwd} ${s.running ? '(running)' : '(idle)'}`).join('\n')
          : '(no active sessions)',
        data: sessions,
      };
    },
  });
  toolsByType['agentx_list_sessions'] = 'builtin';

  // 4. SSH tools
  tools.push({
    name: 'agentx_ssh_hosts',
    description: 'List saved SSH hosts on the agent_linux host. Secrets are never returned.',
    effect: 'read',
    parameters: [],
    async execute() {
      const hosts = await adapter.listSshHosts();
      return {
        ok: true,
        content: JSON.stringify(hosts, null, 2),
        data: hosts,
      };
    },
  });
  toolsByType['agentx_ssh_hosts'] = 'ssh';

  tools.push({
    name: 'agentx_ssh_run',
    description: 'Run a command on a saved SSH host. Uses stored credentials that the agent never sees.',
    effect: 'write',
    parameters: [
      { name: 'host', type: 'string', description: 'Saved SSH host name', required: true },
      { name: 'command', type: 'string', description: 'Command to run on remote host', required: true },
      { name: 'timeout_s', type: 'number', description: 'Timeout in seconds (default 60)' },
    ],
    async execute(args) {
      // We route through agent_linux's agentbox which has ssh_run
      const res = await fetch(`${adapter['cfg'].baseUrl}/agent/chat`, {
        method: 'POST',
        headers: {
          'X-Nova-Terminal-Token': adapter['cfg'].token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Use ssh_run host=${args['host']} command=${args['command']} timeout_s=${args['timeout_s'] || 60}`,
        }),
      });
      if (!res.ok) return { ok: false, content: '', error: `HTTP ${res.status}` };
      const data = await res.json() as any;
      return {
        ok: data.error ? false : true,
        content: data.finalText || data.error,
        data,
      };
    },
  });
  toolsByType['agentx_ssh_run'] = 'ssh';

  // 5. MCP tools — proxy to agent_linux which manages them
  const mcpTools = await adapter.getMcpTools();
  for (const mcpTool of mcpTools) {
    const t = toOptimuseTool(mcpTool, adapter);
    tools.push(t);
    toolsByType[t.name] = 'mcp';
  }

  // 6. Plugin tools — proxy to agent_linux
  const pluginTools = await adapter.getPluginTools();
  for (const pluginTool of pluginTools) {
    const t = toOptimuseTool(pluginTool, adapter);
    tools.push(t);
    toolsByType[t.name] = 'plugin';
  }

  // 7. Mesh tools
  tools.push({
    name: 'agentx_mesh_talk',
    description: 'Consult a bridge model (Claude/GPT/GLM) through the Agent X mesh for a second opinion.',
    effect: 'read',
    parameters: [
      { name: 'peer_id', type: 'string', description: 'Bridge peer id (e.g. "claude-gpt")', required: true },
      { name: 'message', type: 'string', description: 'Question or prompt for the bridge', required: true },
    ],
    async execute(args) {
      try {
        const reply = await adapter.meshTalk(
          String(args['peer_id'] ?? ''),
          String(args['message'] ?? ''),
        );
        return { ok: true, content: reply };
      } catch (err) {
        return { ok: false, content: '', error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
  toolsByType['agentx_mesh_talk'] = 'bridge';

  tools.push({
    name: 'agentx_mesh_peers',
    description: 'List all connected peers, bridges, and sub-agents in the Agent X mesh.',
    effect: 'read',
    parameters: [],
    async execute() {
      const peers = await adapter.listPeers();
      return {
        ok: true,
        content: JSON.stringify(peers, null, 2),
        data: peers,
      };
    },
  });
  toolsByType['agentx_mesh_peers'] = 'bridge';

  // 8. Project Brain tool
  tools.push({
    name: 'agentx_brain_ask',
    description: 'Ask the Project Brain — zero-key deterministic Q&A about the agent_linux codebase. No API key needed.',
    effect: 'read',
    parameters: [
      { name: 'question', type: 'string', description: 'A project question', required: true },
    ],
    async execute(args) {
      const answer = await adapter.askBrain(String(args['question'] ?? ''));
      return { ok: true, content: answer };
    },
  });
  toolsByType['agentx_brain_ask'] = 'builtin';

  // 9. Image generation
  tools.push({
    name: 'agentx_image_generate',
    description: 'Generate an image using the agent_linux image generation endpoint.',
    effect: 'write',
    parameters: [
      { name: 'prompt', type: 'string', description: 'The image prompt', required: true },
      { name: 'provider', type: 'string', description: 'Optional provider override' },
      { name: 'size', type: 'string', description: 'Image size (e.g. "1024x1024")' },
    ],
    async execute(args) {
      const result = await adapter.generateImage(
        String(args['prompt'] ?? ''),
        args['provider'] as string | undefined,
        args['size'] as string | undefined,
      );
      if (result.error) return { ok: false, content: '', error: result.error };
      return { ok: true, content: `Generated: ${result.url}`, data: result };
    },
  });
  toolsByType['agentx_image_generate'] = 'builtin';

  return { adapter, tools, toolsByType };
}

export type { AgentLinuxAdapter };