import { describe, expect, it } from 'vitest';
import { ToolRegistry, checkPermission } from '../../src/tools/registry.ts';
import type { ToolDefinition } from '../../src/types/index.ts';

const dummy: ToolDefinition = {
  name: 'dummy',
  description: 'test tool',
  effect: 'read',
  parameters: [],
  async execute() { return { ok: true, content: 'hi' }; },
};

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const r = new ToolRegistry();
    r.register(dummy);
    expect(r.list()).toHaveLength(1);
    expect(r.get('dummy')?.name).toBe('dummy');
  });

  it('rejects duplicate registration', () => {
    const r = new ToolRegistry();
    r.register(dummy);
    expect(() => r.register(dummy)).toThrow();
  });

  it('builds openai-style schema', () => {
    const r = new ToolRegistry();
    r.register(dummy);
    const schema = r.toSchema();
    expect(schema[0]?.function.name).toBe('dummy');
  });
});

describe('checkPermission', () => {
  it('readonly blocks writes', () => {
    expect(checkPermission('readonly', 'read', true)).toBe('allow');
    expect(checkPermission('readonly', 'write', true)).toBe('deny');
  });
  it('workspace asks for writes', () => {
    expect(checkPermission('workspace', 'write', true)).toBe('ask');
    expect(checkPermission('workspace', 'read', false)).toBe('allow');
  });
  it('full allows everything', () => {
    expect(checkPermission('full', 'write', false)).toBe('allow');
  });
});
