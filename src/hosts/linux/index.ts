/**
 * Linux host — composition root for all Linux host capabilities.
 *
 * This module ties together:
 *  - Host environment descriptor (privilege, isolation, capabilities)
 *  - PTY-based terminal host (persistent sessions, hidden executors)
 *  - Enhanced filesystem host (workspace-jailed fs operations)
 *  - System operation host (process, system info, notifications)
 *
 * It exposes everything as ToolDefinition[] compatible with the Optimuse
 * ToolRegistry, so the agent loop can discover and call them.
 *
 * Each tool is tagged with `effect: 'read'` or `effect: 'write'` so the
 * 4-layer permission gate (Layer 2: AiPermissionMode) can block/approve
 * writes before they reach the host boundary (Layer 1: Host Authorization).
 *
 * Source: /root/notes/ANALYSIS.md §8 (execution order: phase 3 → hosts/linux)
 * Source: /root/muse/hosts/linux/src/lib.rs (createRuntimeHostManager pattern)
 */

import type { ToolDefinition, ToolResult, ToolContext } from '../../types/index.js';
import { detectLinuxHost, type HostEnvironmentDescriptor } from './descriptor.js';
import { LinuxTerminalHost, type TerminalSessionInfo } from './terminal.js';
import {
  resolveWorkspacePath,
  getFileInfo,
  searchFiles,
  readFileSafe,
  writeFileSafe,
  appendFileSafe,
  moveFile,
  copyFile,
  deleteFile,
  zipDirectory,
  unzipFile,
  type FileInfo,
  type FileReadResult,
} from './fs.js';
import {
  getSystemInfo,
  listProcesses,
  findProcesses,
  killProcess,
  getDiskUsage,
  getCpuInfo,
  sendNotification,
  getPackageManager,
  type SystemInfo,
  type ProcessInfo,
  type DiskUsage,
} from './system.js';

export { detectLinuxHost, LinuxTerminalHost };
export type { HostEnvironmentDescriptor, TerminalSessionInfo };
export { resolveWorkspacePath } from './fs.js';
export type { FileInfo, FileReadResult };
export type { SystemInfo, ProcessInfo, DiskUsage };

/**
 * LinuxHost — composes all Linux host capabilities into a single module.
 * This mirrors the Operit2 `createRuntimeHostManager` pattern.
 */
export class LinuxHost {
  readonly descriptor: HostEnvironmentDescriptor;
  readonly terminal: LinuxTerminalHost;
  private initialized = false;

  constructor(private workspaceRoot: string) {
    this.terminal = new LinuxTerminalHost();
    // Synchronous descriptor detection (privilege, isolation) is fast,
    // but container detection needs async. We initialize synchronously
    // and enrich later via init().
    this.descriptor = {
      id: `linux-${process.pid}`,
      displayName: 'Linux host (initializing)',
      platform: 'linux',
      privilege: process.getuid?.() === 0 ? 'root' : 'normal',
      isolation: 'none',
      capabilities: [],
      workspaceRoots: [
        { id: 'main', path: workspaceRoot, displayName: workspaceRoot, writable: true },
      ],
      onboardingRequirements: [],
    };
  }

  /** Asynchronously enrich the host descriptor (container detection, etc.). */
  async init(): Promise<void> {
    if (this.initialized) return;
    const detected = await detectLinuxHost(this.workspaceRoot);
    Object.assign(this.descriptor, detected);
    this.initialized = true;
  }

  /** Get all tools provided by this host. */
  getTools(): ToolDefinition[] {
    return [
      ...this.getTerminalTools(),
      ...this.getEnhancedFsTools(),
      ...this.getSystemTools(),
    ];
  }

  /**
   * Terminal tools — persistent PTY sessions, hidden command execution.
   *
   * Most terminal operations are WRITE (they start/modify processes).
   * Only `get_terminal_info` and `get_session_screen` are READ.
   */
  private getTerminalTools(): ToolDefinition[] {
    const term = this.terminal;
    return [
      {
        name: 'host_terminal_info',
        description: 'Get terminal host info (platform, type, available terminal types).',
        effect: 'read',
        parameters: [],
        execute: async (_args, _ctx) => {
          const info = term.terminalInfo();
          return {
            ok: true,
            content: JSON.stringify(info, null, 2),
            data: info,
          };
        },
      },
      {
        name: 'host_terminal_create_session',
        description: 'Create or reuse a named persistent terminal session.',
        effect: 'write',
        parameters: [
          { name: 'name', type: 'string', description: 'Session name (e.g. "build")', required: true },
        ],
        execute: async (args, _ctx) => {
          try {
            const result = await term.createOrGetSession(String(args['name'] ?? 'default'));
            return {
              ok: true,
              content: `Session ready: ${result.sessionId} (new=${result.isNewSession})`,
              data: result,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_terminal_execute',
        description: 'Execute a command in a persistent terminal session. Returns output + exit code.',
        effect: 'write',
        parameters: [
          { name: 'session_id', type: 'string', description: 'Session ID from create_session', required: true },
          { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
          { name: 'timeout_ms', type: 'number', description: 'Timeout in ms (default 60000, max 300000)' },
        ],
        execute: async (args, _ctx) => {
          try {
            const result = await term.executeInSession(
              String(args['session_id'] ?? ''),
              String(args['command'] ?? ''),
              Number(args['timeout_ms'] ?? 60_000),
            );
            return {
              ok: true,
              content: formatCommandOutput(result.output, result.exitCode, result.timedOut),
              data: result,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_terminal_execute_hidden',
        description: 'Execute a command in a hidden session (no PTY display), keyed by executor key for reuse.',
        effect: 'write',
        parameters: [
          { name: 'command', type: 'string', description: 'Shell command to execute', required: true },
          { name: 'executor_key', type: 'string', description: 'Key for session reuse (default: "default")' },
          { name: 'timeout_ms', type: 'number', description: 'Timeout in ms (default 60000, max 300000)' },
        ],
        execute: async (args, _ctx) => {
          try {
            const result = await term.executeHiddenCommand(
              String(args['command'] ?? ''),
              String(args['executor_key'] ?? 'default'),
              Number(args['timeout_ms'] ?? 60_000),
            );
            return {
              ok: true,
              content: formatCommandOutput(result.output, result.exitCode, result.timedOut),
              data: result,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_terminal_list',
        description: 'List all active terminal sessions.',
        effect: 'read',
        parameters: [],
        execute: async (_args, _ctx) => {
          const sessions = term.listSessions();
          return {
            ok: true,
            content: sessions.length
              ? sessions.map((s) => `${s.sessionId} ${s.sessionName} ${s.workingDir} ${s.commandRunning ? '(running)' : '(idle)'}`).join('\n')
              : '(no active sessions)',
            data: sessions,
          };
        },
      },
      {
        name: 'host_terminal_close',
        description: 'Close a terminal session by ID.',
        effect: 'write',
        parameters: [
          { name: 'session_id', type: 'string', description: 'Session ID to close', required: true },
        ],
        execute: async (args, _ctx) => {
          try {
            const result = term.closeSession(String(args['session_id'] ?? ''));
            return { ok: true, content: `Closed: ${result.sessionId}`, data: result };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
    ];
  }

  /**
   * Enhanced filesystem tools — beyond the basic workspace-jailed fs.ts.
   * Adds: file info, move, copy, delete, zip/unzip, binary-safe read.
   * All path parameters are workspace-jailed via resolveWorkspacePath.
   */
  private getEnhancedFsTools(): ToolDefinition[] {
    return [
      {
        name: 'host_fs_info',
        description: 'Get detailed information about a file (size, type, timestamps, permissions).',
        effect: 'read',
        parameters: [
          { name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const p = resolveWorkspacePath(ctx.workspaceRoot, String(args['path'] ?? ''));
            const info = await getFileInfo(p);
            return { ok: true, content: JSON.stringify(info, null, 2), data: info };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_fs_move',
        description: 'Move (rename) a file or directory within the workspace.',
        effect: 'write',
        parameters: [
          { name: 'source', type: 'string', description: 'Source path', required: true },
          { name: 'destination', type: 'string', description: 'Destination path', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const src = resolveWorkspacePath(ctx.workspaceRoot, String(args['source'] ?? ''));
            const dest = resolveWorkspacePath(ctx.workspaceRoot, String(args['destination'] ?? ''));
            await moveFile(src, dest);
            return { ok: true, content: `moved ${src} → ${dest}` };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_fs_copy',
        description: 'Copy a file or directory recursively within the workspace.',
        effect: 'write',
        parameters: [
          { name: 'source', type: 'string', description: 'Source path', required: true },
          { name: 'destination', type: 'string', description: 'Destination path', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const src = resolveWorkspacePath(ctx.workspaceRoot, String(args['source'] ?? ''));
            const dest = resolveWorkspacePath(ctx.workspaceRoot, String(args['destination'] ?? ''));
            await copyFile(src, dest);
            return { ok: true, content: `copied ${src} → ${dest}` };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_fs_delete',
        description: 'Delete a file or directory within the workspace.',
        effect: 'write',
        parameters: [
          { name: 'path', type: 'string', description: 'Path to delete', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const p = resolveWorkspacePath(ctx.workspaceRoot, String(args['path'] ?? ''));
            await deleteFile(p);
            return { ok: true, content: `deleted ${p}` };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_fs_read_binary',
        description: 'Read a file as base64 (for binary files like images, PDFs).',
        effect: 'read',
        parameters: [
          { name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const p = resolveWorkspacePath(ctx.workspaceRoot, String(args['path'] ?? ''));
            const result = await readFileSafe(p);
            return { ok: true, content: result.content, data: { encoding: result.encoding } };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_fs_write_binary',
        description: 'Write content as base64 to a binary file.',
        effect: 'write',
        parameters: [
          { name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true },
          { name: 'content', type: 'string', description: 'Base64-encoded file content', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const p = resolveWorkspacePath(ctx.workspaceRoot, String(args['path'] ?? ''));
            await writeFileSafe(p, String(args['content'] ?? ''), 'base64');
            return { ok: true, content: `wrote ${p}` };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_fs_zip',
        description: 'Zip a directory into a .zip archive (requires system zip).',
        effect: 'write',
        parameters: [
          { name: 'source_dir', type: 'string', description: 'Directory to zip (relative to workspace)', required: true },
          { name: 'dest_zip', type: 'string', description: 'Output zip path (relative to workspace)', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const src = resolveWorkspacePath(ctx.workspaceRoot, String(args['source_dir'] ?? ''));
            const dest = resolveWorkspacePath(ctx.workspaceRoot, String(args['dest_zip'] ?? ''));
            await zipDirectory(src, dest);
            return { ok: true, content: `zipped ${src} → ${dest}` };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_fs_unzip',
        description: 'Unzip a .zip archive into a directory (requires system unzip).',
        effect: 'write',
        parameters: [
          { name: 'source_zip', type: 'string', description: 'Zip file (relative to workspace)', required: true },
          { name: 'dest_dir', type: 'string', description: 'Output directory (relative to workspace)', required: true },
        ],
        execute: async (args, ctx) => {
          try {
            const src = resolveWorkspacePath(ctx.workspaceRoot, String(args['source_zip'] ?? ''));
            const dest = resolveWorkspacePath(ctx.workspaceRoot, String(args['dest_dir'] ?? ''));
            await unzipFile(src, dest);
            return { ok: true, content: `unzipped ${src} → ${dest}` };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
    ];
  }

  /**
   * System operation tools — process management, system info, notifications.
   *
   * READ: host_system_info, host_processes_list, host_processes_find,
   *       host_disk_usage, host_cpu_info
   * WRITE: host_process_kill, host_notify
   */
  private getSystemTools(): ToolDefinition[] {
    return [
      {
        name: 'host_system_info',
        description: 'Get comprehensive system information (hostname, CPU, memory, OS, container detection).',
        effect: 'read',
        parameters: [],
        execute: async (_args, _ctx) => {
          try {
            const info = await getSystemInfo();
            return {
              ok: true,
              content: JSON.stringify(info, null, 2),
              data: info,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_processes_list',
        description: 'List running processes sorted by memory usage. Optional limit.',
        effect: 'read',
        parameters: [
          { name: 'limit', type: 'number', description: 'Max results (default 100)' },
        ],
        execute: async (args, _ctx) => {
          try {
            const procs = await listProcesses(Number(args['limit'] ?? 100));
            return {
              ok: true,
              content: procs
                .map((p) => `${p.pid}\t${p.user}\t${p.cpu}%\t${p.mem}%\t${p.command}`)
                .join('\n'),
              data: procs,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_processes_find',
        description: 'Find processes by name pattern.',
        effect: 'read',
        parameters: [
          { name: 'pattern', type: 'string', description: 'Process name substring to match', required: true },
        ],
        execute: async (args, _ctx) => {
          try {
            const procs = await findProcesses(String(args['pattern'] ?? ''));
            return {
              ok: true,
              content: procs.length
                ? procs.map((p) => `${p.pid}\t${p.command}`).join('\n')
                : '(no matching processes)',
              data: procs,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_process_kill',
        description: 'Kill a process by PID. Uses SIGTERM by default.',
        effect: 'write',
        parameters: [
          { name: 'pid', type: 'number', description: 'Process ID to kill', required: true },
          { name: 'signal', type: 'string', description: 'Signal name (default: SIGTERM)' },
        ],
        execute: async (args, _ctx) => {
          try {
            const killed = await killProcess(Number(args['pid'] ?? 0), String(args['signal'] ?? 'SIGTERM'));
            return {
              ok: true,
              content: killed ? `killed pid ${args['pid']}` : `process ${args['pid']} not found`,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_disk_usage',
        description: 'Get disk usage for all mounted filesystems.',
        effect: 'read',
        parameters: [],
        execute: async (_args, _ctx) => {
          try {
            const disks = await getDiskUsage();
            return {
              ok: true,
              content: disks
                .map((d) => `${d.usagePercent}%\t${d.size}\t${d.used}\t${d.mountedOn}`)
                .join('\n'),
              data: disks,
            };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_cpu_info',
        description: 'Get CPU model and core count.',
        effect: 'read',
        parameters: [],
        execute: async (_args, _ctx) => {
          try {
            const info = await getCpuInfo();
            return { ok: true, content: info };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_package_manager',
        description: 'Detect the system package manager.',
        effect: 'read',
        parameters: [],
        execute: async (_args, _ctx) => {
          try {
            const pm = await getPackageManager();
            return { ok: true, content: `${pm.name} (${pm.available ? 'available' : 'not available'})` };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
      {
        name: 'host_notify',
        description: 'Send a desktop notification (requires notify-send on system).',
        effect: 'write',
        parameters: [
          { name: 'title', type: 'string', description: 'Notification title', required: true },
          { name: 'body', type: 'string', description: 'Notification body text', required: true },
          { name: 'urgency', type: 'string', description: 'Urgency: low, normal, or critical', enum: ['low', 'normal', 'critical'] },
        ],
        execute: async (args, _ctx) => {
          try {
            const urgency = (args['urgency'] as 'low' | 'normal' | 'critical') ?? 'normal';
            await sendNotification(
              String(args['title'] ?? ''),
              String(args['body'] ?? ''),
              urgency,
            );
            return { ok: true, content: 'notification sent' };
          } catch (e) {
            return { ok: false, content: '', error: (e as Error).message };
          }
        },
      },
    ];
  }
}

/**
 * Factory function: create a LinuxHost and return its tools.
 * Also initializes the host descriptor (async).
 */
export async function createLinuxHost(workspaceRoot: string): Promise<LinuxHost> {
  const host = new LinuxHost(workspaceRoot);
  await host.init();
  return host;
}

/**
 * Convenience: get Linux host tools for the tool registry.
 * Initializes the host first, then returns ToolDefinition[].
 */
export async function getLinuxHostTools(workspaceRoot: string): Promise<ToolDefinition[]> {
  const host = await createLinuxHost(workspaceRoot);
  return host.getTools();
}

// --- Helpers ---

/** Format terminal command output with exit code and timeout status. */
function formatCommandOutput(output: string, exitCode: number, timedOut: boolean): string {
  const status = timedOut ? `[TIMEOUT exit=${exitCode}]` : `[exit=${exitCode}]`;
  const trimmed = output.trim();
  if (!trimmed) return status;
  return `${trimmed}\n${status}`;
}

/** Default ok/fail result creators */
function ok(content: string, data?: unknown): ToolResult {
  return { ok: true, content, data };
}
function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}