/**
 * File Manager — user-friendly file operations across the workspace.
 *
 * A polished, ready-to-serve feature: directory tree, file read/write with
 * metadata, list with sorting, search (name + content), move/copy/delete,
 * and path resolution with workspace jail enforcement.
 *
 * All operations respect the 4-layer security model — the permission gate
 * in tools/registry.ts enforces readonly/workspace/full modes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolResult } from '../../types/index.js';
import { resolveWorkspacePath } from '../../hosts/linux/fs.js';

// --- File type detection ---

const FILE_TYPE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.c': 'c', '.cpp': 'cpp',
  '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php',
  '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala', '.sh': 'bash', '.bash': 'bash',
  '.zsh': 'zsh', '.fish': 'fish', '.ps1': 'powershell',
  '.json': 'json', '.json5': 'json5', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.xml': 'xml', '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss',
  '.sass': 'sass', '.less': 'less',
  '.md': 'markdown', '.mdx': 'mdx', '.tex': 'latex',
  '.sql': 'sql', '.graphql': 'graphql', '.proto': 'protobuf',
  '.dockerfile': 'dockerfile', '.env': 'env', '.log': 'log',
  '.csv': 'csv', '.tsv': 'csv', '.txt': 'text', '.rtf': 'rtf',
  '.xlsx': 'spreadsheet', '.xls': 'spreadsheet', '.pptx': 'presentation', '.ppt': 'presentation',
  '.docx': 'word', '.doc': 'word', '.pdf': 'pdf',
  '.zip': 'archive', '.tar': 'archive', '.gz': 'archive', '.bz2': 'archive',
  '.7z': 'archive', '.rar': 'archive',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image',
  '.webp': 'image', '.bmp': 'image', '.ico': 'image',
  '.mp4': 'video', '.mkv': 'video', '.avi': 'video', '.mov': 'video', '.webm': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio', '.m4a': 'audio',
  '.wasm': 'webassembly',
};

export function detectFileType(filename: string): string {
  const ext = '.' + filename.split('.').pop()!.toLowerCase();
  const base = path.basename(filename).toLowerCase();
  if (base.includes('dockerfile')) return 'dockerfile';
  if (base.includes('nginx') || base.includes('apache')) return 'config';
  if (base === '.env') return 'env';
  return FILE_TYPE_MAP[ext] ?? 'unknown';
}

export function isTextFile(filename: string): boolean {
  const type = detectFileType(filename);
  const textTypes = [
    'typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'csharp',
    'ruby', 'php', 'swift', 'kotlin', 'scala', 'bash', 'zsh', 'fish', 'powershell',
    'json', 'json5', 'yaml', 'toml', 'xml', 'html', 'css', 'scss', 'sass', 'less',
    'markdown', 'mdx', 'latex', 'sql', 'graphql', 'protobuf', 'dockerfile', 'env',
    'log', 'csv', 'text', 'rtf', 'config',
  ];
  return textTypes.includes(type);
}

export function isImageFile(filename: string): boolean {
  return detectFileType(filename) === 'image';
}

export function isBinaryFile(filename: string): boolean {
  const type = detectFileType(filename);
  return !isTextFile(filename) && type !== 'unknown';
}

// --- Formatting helpers ---

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatPermissions(mode: number): string {
  const bits = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const p = (mode >>> 0) & 0o777;
  const owner = bits[(p >>> 6) & 7];
  const group = bits[(p >>> 3) & 7];
  const other = bits[p & 7];
  return owner + group + other;
}

export function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// --- Data structures ---

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: string;
  mode: number;
  fileType?: string;
  children?: FileTreeNode[];
}

// --- File Manager Tool Factory ---

export function fileManagerTools(workspaceRoot: string): ToolDefinition[] {
  return [
    {
      name: 'file_manager_tree',
      description: 'Get a directory tree of the workspace. Shows files and directories up to 5 levels deep.',
      effect: 'read',
      parameters: [
        { name: 'path', type: 'string', description: 'Directory path (relative to workspace, default: root)' },
        { name: 'max_depth', type: 'number', description: 'Maximum depth to traverse (default: 5, max: 10)' },
        { name: 'include_files', type: 'boolean', description: 'Include files in the tree (default: true)' },
      ],
      async execute(args, ctx) {
        try {
          const relPath = (args['path'] as string | undefined) || '.';
          const maxDepth = Math.min(Number(args['max_depth'] ?? 5), 10);
          const includeFiles = args['include_files'] !== false;
          const resolvedPath = resolveWorkspacePath(ctx.workspaceRoot, relPath);
          const tree = await buildDirectoryTree(resolvedPath, 0, maxDepth, includeFiles);
          return {
            ok: true,
            content: JSON.stringify(tree, (k, v) => (v instanceof Date ? v.toISOString() : v), 2).slice(0, 10000),
            data: tree,
          };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_read',
      description: 'Read a file with metadata (file type, permissions, owner). Supports text preview and base64 for binary files.',
      effect: 'read',
      parameters: [
        { name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true },
        { name: 'max_bytes', type: 'number', description: 'Max bytes to read (default: 40000, max: 1000000)' },
      ],
      async execute(args, ctx) {
        try {
          const p = resolveWorkspacePath(ctx.workspaceRoot, (args['path'] as string) || '');
          const maxBytes = Math.min(Number(args['max_bytes'] ?? 40000), 1000000);
          const stats = await fs.stat(p);
          const isDir = stats.isDirectory();
          if (isDir) {
            const entries = await fs.readdir(p, { withFileTypes: true });
            return { ok: true, content: `📁 ${entries.length} items`, data: { path: p, type: 'directory', entries: entries.map(e => e.name) } };
          }
          const text = isTextFile(path.basename(p));
          let content: string;
          let encoding: 'utf8' | 'base64';
          if (text) {
            content = await fs.readFile(p, 'utf8');
            if (content.length > maxBytes) { content = content.slice(0, maxBytes) + '\n... (truncated)'; encoding = 'utf8'; }
            else encoding = 'utf8';
          } else {
            const buf = await fs.readFile(p);
            content = buf.toString('base64');
            const truncated = buf.length > maxBytes;
            if (truncated) content = content.slice(0, maxBytes);
            encoding = 'base64';
          }
          return {
            ok: true,
            content,
            data: {
              path: p,
              size: Number(stats.size),
              encoding,
              fileType: detectFileType(path.basename(p)),
              isBinary: text ? false : true,
              permissions: formatPermissions(stats.mode),
              mtime: stats.mtime.toISOString(),
              truncated: content.length >= maxBytes,
              formattedSize: formatFileSize(Number(stats.size)),
              humanMtime: formatDate(stats.mtime),
              isDirectory: false,
            },
          };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_write',
      description: 'Write content to a file. Text content is written as UTF-8; binary content should be base64-encoded.',
      effect: 'write',
      parameters: [
        { name: 'path', type: 'string', description: 'File path (relative to workspace)', required: true },
        { name: 'content', type: 'string', description: 'File content (UTF-8 for text, base64 for binary)', required: true },
        { name: 'encoding', type: 'string', description: 'Encoding: "utf8" (default) or "base64"', enum: ['utf8', 'base64'] },
      ],
      async execute(args, ctx) {
        try {
          const p = resolveWorkspacePath(ctx.workspaceRoot, (args['path'] as string) || '');
          const content = (args['content'] as string) || '';
          const encoding = (args['encoding'] as string || 'utf8') as 'utf8' | 'base64';
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, encoding === 'base64' ? Buffer.from(content, 'base64') : content);
          return {
            ok: true,
            content: `wrote ${p} (${formatFileSize(encoding === 'base64' ? Buffer.from(content, 'base64').length : Buffer.byteLength(content))})`,
            data: { path: p, encoding, bytes: content.length },
          };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_list',
      description: 'List the contents of a directory with detailed metadata (size, permissions, file type).',
      effect: 'read',
      parameters: [
        { name: 'path', type: 'string', description: 'Directory path (relative to workspace, default: root)' },
        { name: 'show_hidden', type: 'boolean', description: 'Show hidden files (default: false)' },
        { name: 'sort_by', type: 'string', description: 'Sort by: name, size, mtime (default: name)' },
        { name: 'sort_desc', type: 'boolean', description: 'Reverse sort order (default: false)' },
      ],
      async execute(args, ctx) {
        try {
          const relPath = (args['path'] as string) || '.';
          const showHidden = args['show_hidden'] === true;
          const sortBy = (args['sort_by'] as string || 'name') as 'name' | 'size' | 'mtime';
          const sortDesc = args['sort_desc'] === true;
          const resolvedPath = resolveWorkspacePath(ctx.workspaceRoot, relPath);
          const items = await fs.readdir(resolvedPath, { withFileTypes: true });
          const entries: any[] = [];
          for (const item of items) {
            if (!showHidden && item.name.startsWith('.')) continue;
            const fullPath = path.join(resolvedPath, item.name);
            const stats = await fs.stat(fullPath);
            entries.push({
              name: item.name,
              path: relPath === '.' ? item.name : `${relPath}/${item.name}`,
              type: item.isDirectory() ? 'directory' : 'file',
              size: Number(stats.size),
              formattedSize: formatFileSize(Number(stats.size)),
              permissions: formatPermissions(stats.mode),
              mtime: stats.mtime,
              humanMtime: formatDate(stats.mtime),
              fileType: item.isFile() ? detectFileType(item.name) : undefined,
              isBinary: item.isFile() ? !isTextFile(item.name) : false,
            });
          }
          entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            let cmp: number;
            if (sortBy === 'size') cmp = a.size - b.size;
            else if (sortBy === 'mtime') cmp = new Date(a.mtime).getTime() - new Date(b.mtime).getTime();
            else cmp = a.name.localeCompare(b.name);
            return sortDesc ? -cmp : cmp;
          });
          const display = entries.map(e => {
            const icon = e.type === 'directory' ? '📁' : isImageFile(e.name) ? '🖼️' : e.isBinary ? '📄🔒' : '📄';
            return `${icon} ${e.permissions} ${e.formattedSize.padStart(8)} ${e.name}`;
          }).join('\n');
          return {
            ok: true,
            content: `${relPath === '.' ? ctx.workspaceRoot : relPath}\n${display}`,
            data: { path: relPath, count: entries.length, entries },
          };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_search',
      description: 'Search for files by name pattern or content. Returns matching files with snippets.',
      effect: 'read',
      parameters: [
        { name: 'pattern', type: 'string', description: 'Filename pattern or glob (required)', required: true },
        { name: 'path', type: 'string', description: 'Search directory (relative to workspace, default: root)' },
        { name: 'content_search', type: 'boolean', description: 'If true, search file contents too (default: false)' },
        { name: 'max_depth', type: 'number', description: 'Maximum search depth (default: 8)' },
        { name: 'max_results', type: 'number', description: 'Maximum results (default: 200)' },
      ],
      async execute(args, ctx) {
        try {
          const pattern = (args['pattern'] as string) || '';
          if (!pattern) return { ok: false, content: '', error: 'pattern is required' };
          const searchPath = args['path'] ? resolveWorkspacePath(ctx.workspaceRoot, args['path']) : ctx.workspaceRoot;
          const contentSearch = args['content_search'] === true;
          const maxDepth = Math.min(Number(args['max_depth'] ?? 8), 10);
          const maxResults = Math.min(Number(args['max_results'] ?? 200), 1000);
          // Name search via recursive directory walk
          const results: any[] = [];
          const pat = pattern.toLowerCase();
          async function walk(dir: string, depth: number): Promise<void> {
            if (depth > maxDepth || results.length > maxResults) return;
            let entries: fs.Dirent[];
            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const item of entries) {
              if (item.name.startsWith('.')) continue;
              const fullPath = path.join(dir, item.name);
              if (item.name.toLowerCase().includes(pat)) {
                const stats = await fs.stat(fullPath);
                results.push({
                  path: fullPath,
                  name: item.name,
                  type: item.isDirectory() ? 'directory' : 'file',
                  size: Number(stats.size),
                  fileType: item.isFile() ? detectFileType(item.name) : undefined,
                });
              }
              if (item.isDirectory()) await walk(fullPath, depth + 1);
            }
          }
          await walk(searchPath, 0);
          // Content search on text files
          if (contentSearch) {
            const textResults = results.filter(r => r.type === 'file' && (!r.fileType || isTextFile(r.name)));
            for (const file of textResults) {
              try {
                const content = await fs.readFile(file.path, 'utf8');
                const lines = content.split('\n');
                const matches = lines.filter(line => line.toLowerCase().includes(pat));
                if (matches.length > 0) {
                  file.matches = matches.length;
                  file.snippet = matches.slice(0, 3).map(m => `  ${m.trim().slice(0, 100)}`).join('\n');
                }
              } catch { /* skip */ }
            }
          }
          results.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            const aM = a.matches ?? 0, bM = b.matches ?? 0;
            if (aM !== bM) return bM - aM;
            return a.name.localeCompare(b.name);
          });
          const display = results.slice(0, maxResults).map(r => {
            const icon = r.type === 'directory' ? '📁' : isImageFile(r.name) ? '🖼️' : '📄';
            const relPath = r.path.replace(ctx.workspaceRoot + '/', '');
            const line = `${icon} ${relPath} (${formatFileSize(r.size)})`;
            return r.snippet ? `${line}\n    ${r.snippet}` : line;
          }).join('\n');
          return {
            ok: true,
            content: display || `(no matches for "${pattern}")`,
            data: { pattern, count: results.length, results: results.slice(0, maxResults) },
          };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_move',
      description: 'Move (rename) a file or directory within the workspace.',
      effect: 'write',
      parameters: [
        { name: 'source', type: 'string', description: 'Source path (relative to workspace)', required: true },
        { name: 'destination', type: 'string', description: 'Destination path (relative to workspace)', required: true },
      ],
      async execute(args, ctx) {
        try {
          const src = resolveWorkspacePath(ctx.workspaceRoot, (args['source'] as string) || '');
          const dest = resolveWorkspacePath(ctx.workspaceRoot, (args['destination'] as string) || '');
          const stats = await fs.stat(src);
          const isDir = stats.isDirectory();
          await fs.rename(src, dest);
          return { ok: true, content: `moved ${isDir ? 'directory' : 'file'} ${src} → ${dest}`, data: { source: src, destination: dest, isDirectory: isDir } };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_copy',
      description: 'Copy a file or directory recursively within the workspace.',
      effect: 'write',
      parameters: [
        { name: 'source', type: 'string', description: 'Source path (relative to workspace)', required: true },
        { name: 'destination', type: 'string', description: 'Destination path (relative to workspace)', required: true },
      ],
      async execute(args, ctx) {
        try {
          const src = resolveWorkspacePath(ctx.workspaceRoot, (args['source'] as string) || '');
          const dest = resolveWorkspacePath(ctx.workspaceRoot, (args['destination'] as string) || '');
          const stats = await fs.stat(src);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          if (stats.isDirectory()) {
            await copyDirRecursive(src, dest);
          } else {
            await fs.copyFile(src, dest);
          }
          return { ok: true, content: `copied ${stats.isDirectory() ? 'directory' : 'file'} ${src} → ${dest}`, data: { source: src, destination: dest, isDirectory: stats.isDirectory() } };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_delete',
      description: 'Delete a file or directory within the workspace.',
      effect: 'write',
      parameters: [
        { name: 'path', type: 'string', description: 'Path to delete (relative to workspace)', required: true },
      ],
      async execute(args, ctx) {
        try {
          const p = resolveWorkspacePath(ctx.workspaceRoot, (args['path'] as string) || '');
          const stats = await fs.stat(p);
          if (stats.isDirectory()) {
            await fs.rm(p, { recursive: true, force: true });
          } else {
            await fs.unlink(p);
          }
          return { ok: true, content: `deleted ${stats.isDirectory() ? 'directory' : 'file'}: ${p}` };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
    {
      name: 'file_manager_mkdir',
      description: 'Create a directory (with parents).',
      effect: 'write',
      parameters: [
        { name: 'path', type: 'string', description: 'Directory path to create (relative to workspace)', required: true },
      ],
      async execute(args, ctx) {
        try {
          const p = resolveWorkspacePath(ctx.workspaceRoot, (args['path'] as string) || '');
          await fs.mkdir(p, { recursive: true });
          return { ok: true, content: `created directory: ${p}` };
        } catch (e) {
          return { ok: false, content: '', error: e instanceof Error ? e.message : String(e) };
        }
      },
    },
  ];
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function buildDirectoryTree(
  dir: string,
  depth: number,
  maxDepth: number,
  includeFiles: boolean,
): Promise<FileTreeNode[]> {
  if (depth > maxDepth) return [];
  const items: fs.Dirent[] = await fs.readdir(dir, { withFileTypes: true });
  const entries: FileTreeNode[] = [];
  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    const fullPath = path.join(dir, item.name);
    let stats: fs.Stats;
    try { stats = await fs.stat(fullPath); } catch { continue; }
    const node: FileTreeNode = {
      name: item.name,
      path: fullPath,
      type: item.isDirectory() ? 'directory' : 'file',
      size: Number(stats.size),
      mtime: stats.mtime.toISOString(),
      mode: stats.mode,
    };
    if (item.isDirectory()) {
      if (depth < maxDepth) {
        node.children = await buildDirectoryTree(fullPath, depth + 1, maxDepth, includeFiles);
      } else {
        node.children = [];
      }
    } else {
      node.fileType = detectFileType(item.name);
    }
    entries.push(node);
  }
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function searchFiles(dir: string, pattern: string, maxDepth: number, maxResults: number): Promise<string[]> {
  const results: string[] = [];
  const pat = pattern.toLowerCase();
  async function walk(d: string, depth: number): Promise<void> {
    if (depth > maxDepth || results.length > maxResults) return;
    let entries: fs.Dirent[];
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const item of entries) {
      if (item.name.startsWith('.')) continue;
      const full = path.join(d, item.name);
      if (item.name.toLowerCase().includes(pat)) results.push(full);
      if (item.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(dir, 0);
  return results;
}