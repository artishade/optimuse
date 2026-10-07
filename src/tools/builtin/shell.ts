/**
 * Shell tool — runs commands in the workspace via child_process.
 * v0: bounded output, bounded time, workspace cwd.
 */

import { exec } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../../types/index.js';

const MAX_OUTPUT = 30_000;
const DEFAULT_TIMEOUT = 60_000;

export function shellTools(workspaceRoot: string): ToolDefinition[] {
  return [
    {
      name: 'shell_run',
      description:
        'Run a shell command inside the workspace. Returns stdout+stderr. Use for builds, git, package managers, etc.',
      effect: 'write',
      parameters: [
        { name: 'command', type: 'string', description: 'The shell command to run', required: true },
        { name: 'timeout_ms', type: 'number', description: 'Timeout in ms (default 60000, max 300000)' },
      ],
      async execute(args): Promise<ToolResult> {
        const command = String(args['command'] ?? '').trim();
        if (!command) return { ok: false, content: '', error: 'command is required' };
        const timeout = Math.min(Number(args['timeout_ms'] ?? DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT, 300_000);

        return new Promise((resolve) => {
          exec(
            command,
            { cwd: workspaceRoot, timeout, maxBuffer: 10 * 1024 * 1024, shell: '/bin/bash' },
            (err, stdout, stderr) => {
              if (err && !stdout && !stderr) {
                resolve({ ok: false, content: '', error: `shell error: ${err.message}` });
                return;
              }
              const out = [`exit: ${err && typeof err.code === 'number' ? err.code : 0}`, '--- stdout ---', String(stdout).slice(0, MAX_OUTPUT), '--- stderr ---', String(stderr).slice(0, MAX_OUTPUT / 2)].join('\n');
              resolve({ ok: true, content: out });
            },
          );
        });
      },
    },
  ];
}
