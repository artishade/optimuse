/**
 * Optimuse CLI — minimal chat surface with tools.
 * Config via env: OPTIMUSE_BASE_URL, OPTIMUSE_API_KEY, OPTIMUSE_MODEL,
 *                 OPTIMUSE_WORKSPACE (default cwd), OPTIMUSE_MODE (readonly|workspace|full)
 */

import * as readline from 'node:readline';
import { Agent } from '../../core/agent.js';
import { OpenAICompatibleProvider } from '../../providers/openai/provider.js';
import { ToolRegistry } from '../../tools/registry.js';
import { fsTools, shellTools } from '../../tools/builtin/index.js';
import type { ChatMessage } from '../../types/index.js';

const baseUrl = process.env['OPTIMUSE_BASE_URL'] ?? 'https://api.openai.com/v1';
const apiKey = process.env['OPTIMUSE_API_KEY'] ?? '';
const model = process.env['OPTIMUSE_MODEL'] ?? 'gpt-4o-mini';
const workspaceRoot = process.env['OPTIMUSE_WORKSPACE'] ?? process.cwd();
const mode = (process.env['OPTIMUSE_MODE'] ?? 'workspace') as 'readonly' | 'workspace' | 'full';

if (!apiKey) {
  console.error('OPTIMUSE_API_KEY is required');
  process.exit(1);
}

const registry = new ToolRegistry();
for (const t of [...fsTools(workspaceRoot), ...shellTools(workspaceRoot)]) registry.register(t);

const provider = new OpenAICompatibleProvider({ baseUrl, apiKey, model });
const agent = new Agent(provider, registry, {
  permissionMode: mode,
  workspaceRoot,
  maxSteps: 16,
  onToolCall: (c) => console.log(`  ⚙ ${c.name} ${JSON.stringify(c.arguments).slice(0, 120)}`),
  onToolResult: (c, r) => console.log(`  ${r.ok ? '✔' : '✘'} ${c.name}`),
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you › ' });
const history: ChatMessage[] = [];

console.log(`Optimuse v0.1 · model=${model} · mode=${mode} · workspace=${workspaceRoot}`);
console.log('type your message, /tools to list tools, /exit to quit\n');
rl.prompt();

rl.on('line', (line) => {
  const input = line.trim();
  if (!input) { rl.prompt(); return; }
  if (input === '/exit') { rl.close(); return; }
  if (input === '/tools') {
    for (const t of registry.list()) console.log(`  ${t.effect === 'write' ? '✎' : '👁'} ${t.name} — ${t.description}`);
    rl.prompt();
    return;
  }
  rl.pause();
  agent
    .run(input, history)
    .then((r) => {
      console.log(`\noptimuse › ${r.finalText}\n`);
      history.push({ role: 'user', content: input });
      history.push({ role: 'assistant', content: r.finalText });
    })
    .catch((e) => console.error('error:', (e as Error).message))
    .finally(() => { rl.resume(); rl.prompt(); });
});

rl.on('close', () => { console.log('bye 👋'); process.exit(0); });
