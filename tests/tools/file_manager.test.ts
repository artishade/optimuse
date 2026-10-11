/** Tests for the built-in File Manager tools. */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { fileManagerTools, detectFileType, isTextFile, isBinaryFile, formatFileSize, formatPermissions } from '../../src/tools/builtin/file_manager.js';
import { ToolRegistry, checkPermission } from '../../src/tools/registry.js';

describe('File Manager — Type Detection', () => {
  it('detects common file types', () => {
    expect(detectFileType('main.ts')).toBe('typescript');
    expect(detectFileType('app.js')).toBe('javascript');
    expect(detectFileType('script.py')).toBe('python');
    expect(detectFileType('Cargo.toml')).toBe('toml');
    expect(detectFileType('README.md')).toBe('markdown');
    expect(detectFileType('image.png')).toBe('image');
    expect(detectFileType('video.mp4')).toBe('video');
    expect(detectFileType('data.json')).toBe('json');
    expect(detectFileType('archive.zip')).toBe('archive');
    expect(detectFileType('unknown.xyz')).toBe('unknown');
  });

  it('detects text vs binary files', () => {
    expect(isTextFile('main.ts')).toBe(true);
    expect(isTextFile('README.md')).toBe(true);
    expect(isTextFile('data.json')).toBe(true);
    expect(isTextFile('image.png')).toBe(false);
    expect(isTextFile('video.mp4')).toBe(false);
  });

  it('formats file sizes correctly', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536000)).toBe('1.5 MB');
  });

  it('formats permissions from mode', () => {
    expect(formatPermissions(0o644)).toBe('rw-r--r--');
    expect(formatPermissions(0o755)).toBe('rwxr-xr-x');
    expect(formatPermissions(0o777)).toBe('rwxrwxrwx');
  });
});

describe('File Manager — Tool Integration', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'optimuse-fm-'));
  });

  afterAll(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('registers file manager tools in the registry', () => {
    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);

    const registered = registry.list();
    expect(registered.find((t) => t.name === 'file_manager_tree')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_read')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_write')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_list')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_search')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_move')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_copy')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_delete')).toBeDefined();
    expect(registered.find((t) => t.name === 'file_manager_mkdir')).toBeDefined();
  });

  it('permission gate blocks WRITE tools in readonly mode', () => {
    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);

    const writeTool = registry.get('file_manager_write');
    expect(writeTool).toBeDefined();
    expect(writeTool!.effect).toBe('write');
    expect(checkPermission('readonly', 'write', true)).toBe('deny');
  });

  it('permission gate allows READ tools in readonly mode', () => {
    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);

    const readTool = registry.get('file_manager_read');
    expect(readTool).toBeDefined();
    expect(readTool!.effect).toBe('read');
    expect(checkPermission('readonly', 'read', false)).toBe('allow');
  });

  it('creates directories', async () => {
    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_mkdir')!;

    const result = await tool.execute({ path: 'subdir/nested' }, {
      workspaceRoot: workspace,
      permissionMode: 'full',
      runState: new Map(),
    });

    expect(result.ok).toBe(true);
    expect(await fs.stat(path.join(workspace, 'subdir', 'nested'))).toBeDefined();
  });

  it('writes and reads files with metadata', async () => {
    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const writeTool = registry.get('file_manager_write')!;
    const readTool = registry.get('file_manager_read')!;

    // Write
    const writeResult = await writeTool.execute(
      { path: 'test.txt', content: 'hello file manager' },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );
    expect(writeResult.ok).toBe(true);

    // Read
    const readResult = await readTool.execute(
      { path: 'test.txt' },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );
    expect(readResult.ok).toBe(true);
    expect(readResult.content).toBe('hello file manager');
    expect(readResult.data).toHaveProperty('fileType', 'text');
    expect(readResult.data).toHaveProperty('permissions');
    expect(readResult.data).toHaveProperty('formattedSize');
    expect(readResult.data).toHaveProperty('humanMtime');
  });

  it('lists directory contents with metadata', async () => {
    // Create some test files
    await fs.writeFile(path.join(workspace, 'a.txt'), 'a');
    await fs.writeFile(path.join(workspace, 'b.txt'), 'bbb');

    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_list')!;

    const result = await tool.execute({ path: '.' }, {
      workspaceRoot: workspace,
      permissionMode: 'full',
      runState: new Map(),
    });

    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty('count');
    expect(result.data).toHaveProperty('entries');
    expect(result.data.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('searches for files by name', async () => {
    await fs.writeFile(path.join(workspace, 'searchable.txt'), 'content');

    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_search')!;

    const result = await tool.execute(
      { pattern: 'searchable' },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty('count');
    expect(result.data.count).toBeGreaterThanOrEqual(1);
  });

  it('moves files', async () => {
    await fs.writeFile(path.join(workspace, 'move_src.txt'), 'move me');

    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_move')!;

    const result = await tool.execute(
      { source: 'move_src.txt', destination: 'move_dest.txt' },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'move_dest.txt'), 'utf8')).toBe('move me');
    await expect(fs.stat(path.join(workspace, 'move_src.txt'))).rejects.toThrow();
  });

  it('copies files', async () => {
    await fs.writeFile(path.join(workspace, 'copy_src.txt'), 'copy me');

    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_copy')!;

    const result = await tool.execute(
      { source: 'copy_src.txt', destination: 'copy_dest.txt' },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'copy_src.txt'), 'utf8')).toBe('copy me');
    expect(await fs.readFile(path.join(workspace, 'copy_dest.txt'), 'utf8')).toBe('copy me');
  });

  it('deletes files', async () => {
    await fs.writeFile(path.join(workspace, 'delete_me.txt'), 'delete');

    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_delete')!;

    const result = await tool.execute(
      { path: 'delete_me.txt' },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );

    expect(result.ok).toBe(true);
    await expect(fs.stat(path.join(workspace, 'delete_me.txt'))).rejects.toThrow();
  });

  it('builds directory tree', async () => {
    await fs.mkdir(path.join(workspace, 'tree_test', 'sub'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'tree_test', 'sub', 'file.txt'), 'tree');

    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_tree')!;

    const result = await tool.execute(
      { path: 'tree_test', max_depth: 5 },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toBeInstanceOf(Array);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it('rejects paths outside workspace jail', async () => {
    const registry = new ToolRegistry();
    for (const t of fileManagerTools(workspace)) registry.register(t);
    const tool = registry.get('file_manager_read')!;

    const result = await tool.execute(
      { path: '../../../etc/passwd' },
      { workspaceRoot: workspace, permissionMode: 'full', runState: new Map() },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('path escapes workspace');
  });
});