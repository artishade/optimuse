/**
 * Filesystem tools — workspace-jailed read/write/list/search.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from '../../types/index.js';

function ok(content: string, data?: unknown): ToolResult {
  return { ok: true, content, data };
}
function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

export function resolveInWorkspace(root: string, p: unknown): string {
  const raw = typeof p === 'string' ? p : '';
  const abs = path.isAbsolute(raw) ? raw : path.join(root, raw);
  const resolved = path.resolve(abs);
  const normRoot = path.resolve(root);
  if (resolved !== normRoot && !resolved.startsWith(normRoot + path.sep)) {
    throw new Error(`path escapes workspace: ${raw}`); // jail break attempt
  }
  return resolved;
}
// --- tool factory ---
export function fsTools(root: string): ToolDefinition[] {
  return [
    {
      name: 'fs_read',
      description: 'Read a text file inside the workspace.',
      effect: 'read',
      parameters: [{ name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true }],
      async execute(args, ctx) {
        try {
          const p = resolveInWorkspace(ctx.workspaceRoot, args['path']);
          const data = await fs.readFile(p, 'utf8');
          const truncated = data.length > 40_000 ? data.slice(0, 40_000) + '\n... (truncated)' : data;
          return ok(truncated);
        } catch (e) {
          return fail(`read failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: 'fs_write',
      description: 'Create or overwrite a text file inside the workspace.',
      effect: 'write',
      parameters: [
        { name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true },
        { name: 'content', type: 'string', description: 'Full file content', required: true },
      ],
      async execute(args, ctx) {
        try {
          const p = resolveInWorkspace(ctx.workspaceRoot, args['path']);
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, String(args['content'] ?? ''));
          return ok(`wrote ${p}`);
        } catch (e) {
          return fail(`write failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: 'fs_list',
      description: 'List a directory inside the workspace.',
      effect: 'read',
      parameters: [{ name: 'path', type: 'string', description: 'Directory path (default: workspace root)' }],
      async execute(args, ctx) {
        try {
          const p = resolveInWorkspace(ctx.workspaceRoot, args['path'] ?? '.');
          const entries = await fs.readdir(p, { withFileTypes: true });
          const lines = entries.map((e) => (e.isDirectory() ? 'd ' : '- ') + e.name);
          return ok(lines.join('\n') || '(empty)');
        } catch (e) {
          return fail(`list failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: 'fs_search',
      description: 'Recursively search filenames inside the workspace.',
      effect: 'read',
      parameters: [{ name: 'pattern', type: 'string', description: 'Filename substring or glob-ish pattern', required: true }],
      async execute(args, ctx) {
        const pat = String(args['pattern'] ?? '').toLowerCase();
        const results: string[] = [];
        async function walk(dir: string, depth: number): Promise<void> {
          if (depth > 8 || results.length > 200) return;
          const p = path.resolve(ctx.workspaceRoot, dir);
          let items;
          try { items = await fs.readdir(p, { withFileTypes: true }); } catch { return; }
          for (const it of items) {
            if (it.name.startsWith('.')) continue;
            const full = path.join(p, it.name);
            if (it.name.toLowerCase().includes(pat)) results.push(full);  // substring match
            if (it.isDirectory()) await walk(full, depth + 1);
          }
        }
        await walk(ctx.workspaceRoot, 0);
        return ok(results.length ? results.join('\n') : '(no matches)');
      },
    },
    {
      name: 'fs_append',
      description: 'Append text to a file inside the workspace (created if missing).',
      effect: 'write',
      parameters: [
        { name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true },
        { name: 'content', type: 'string', description: 'Text to append', required: true },
      ],
        async execute(args, ctx) {
        try {
          const p = resolveInWorkspace(ctx.workspaceRoot, args['path']);
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, String(args['content'] ?? ''), { flag: 'a' });
          return ok(`appended ${p}`);
        } catch (e) { return fail(`append failed: ${(e as Error).message}`); }
      },
    },
  ];
}
