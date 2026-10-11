/**
 * GitHub connector — REST API, PAT auth.
 * Read tools are always available once connected.
 * Write tools are marked 'write' so the permission gate asks before running them.
 */

import type { ToolDefinition, ToolResult } from '../../types/index.js';
import {
  ConnectorError,
  type ConnectorDefinition,
  type Credential,
} from '../types.js';

const API = 'https://api.github.com';

async function gh(
  cred: Credential,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${cred.secret}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'optimuse',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (res.status === 401) throw new ConnectorError('authorization_required', 'GitHub token rejected (401).');
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') throw new ConnectorError('rate_limited', 'GitHub rate limit reached.');
    throw new ConnectorError('insufficient_scope', 'Token lacks permission for this resource (403).');
  }
  if (res.status === 404) throw new ConnectorError('resource_not_found', `Not found: ${path}`);
  if (!res.ok) throw new ConnectorError('request_failed', `GitHub HTTP ${res.status}`);
  return res.status === 204 ? null : await res.json();
}

function wrap(fn: () => Promise<unknown>): Promise<ToolResult> {
  return fn().then(
    (data) => ({ ok: true, content: JSON.stringify(data, null, 2).slice(0, 40_000), data: undefined }),
    (err: unknown) => {
      const msg = err instanceof ConnectorError ? `[${err.code}] ${err.message}` : (err as Error).message;
      return { ok: false, content: '', error: msg };
    },
  );
}

export const githubConnector: ConnectorDefinition = {
  id: 'github',
  name: 'GitHub',
  description: 'Repositories, issues, pull requests and files via the GitHub REST API.',
  icon: 'github',
  category: 'dev',
  authMethods: [
    {
      id: 'personal_token',
      label: 'Personal access token',
      kind: 'credentials',
      fields: [
        {
          id: 'token',
          label: 'Token (fine-grained recommended)',
          secret: true,
          required: true,
          pattern: '^\\S+$',
          placeholder: 'github_pat_…',
          maxLength: 4096,
        },
      ],
    },
  ],

  async validate(cred, signal) {
    const me = (await gh(cred, 'GET', '/user', undefined, signal)) as { login: string };
    return { account: me.login };
  },

  createTools({ getCredential }) {
    const tools: ToolDefinition[] = [
      {
        name: 'github_me',
        description: 'Get the authenticated GitHub account.',
        effect: 'read',
        parameters: [],
        async execute(_a, ctx) {
          return wrap(async () => gh(await getCredential(), 'GET', '/user', undefined, ctx.signal));
        },
      },
      {
        name: 'github_search_repos',
        description: 'Search GitHub repositories.',
        effect: 'read',
        parameters: [{ name: 'query', type: 'string', description: 'GitHub search query', required: true }],
        async execute(args, ctx) {
          const q = encodeURIComponent(String(args['query'] ?? ''));
          return wrap(async () => gh(await getCredential(), 'GET', `/search/repositories?q=${q}&per_page=10`, undefined, ctx.signal));
        },
      },
      {
        name: 'github_get_file',
        description: 'Read a file from a GitHub repository (default branch unless ref given).',
        effect: 'read',
        parameters: [
          { name: 'owner', type: 'string', description: 'Repo owner', required: true },
          { name: 'repo', type: 'string', description: 'Repo name', required: true },
          { name: 'path', type: 'string', description: 'File path in repo', required: true },
          { name: 'ref', type: 'string', description: 'Branch, tag or commit (optional)' },
        ],
        async execute(args, ctx) {
          const seg = (v: unknown) => encodeURIComponent(String(v ?? ''));
          const ref = args['ref'] ? `?ref=${seg(args['ref'])}` : '';
          const p = `/repos/${seg(args['owner'])}/${seg(args['repo'])}/contents/${String(args['path'] ?? '').split('/').map(encodeURIComponent).join('/')}${ref}`;
          return wrap(async () => {
            const data = (await gh(await getCredential(), 'GET', p, undefined, ctx.signal)) as { content?: string; encoding?: string };
            if (data.encoding === 'base64' && data.content) {
              return Buffer.from(data.content, 'base64').toString('utf8');
            }
            return data;
          });
        },
      },
      {
        name: 'github_list_issues',
        description: 'List issues or pull requests for a repository.',
        effect: 'read',
        parameters: [
          { name: 'owner', type: 'string', description: 'Repo owner', required: true },
          { name: 'repo', type: 'string', description: 'Repo name', required: true },
          { name: 'state', type: 'string', description: 'open | closed | all', enum: ['open', 'closed', 'all'] },
        ],
        async execute(args, ctx) {
          const seg = (v: unknown) => encodeURIComponent(String(v ?? ''));
          const state = String(args['state'] ?? 'open');
          const p = `/repos/${seg(args['owner'])}/${seg(args['repo'])}/issues?state=${state}&per_page=20`;
          return wrap(async () => gh(await getCredential(), 'GET', p, undefined, ctx.signal));
        },
      },
      {
        name: 'github_create_issue',
        description: 'Create an issue in a repository. Requires user approval.',
        effect: 'write',
        parameters: [
          { name: 'owner', type: 'string', description: 'Repo owner', required: true },
          { name: 'repo', type: 'string', description: 'Repo name', required: true },
          { name: 'title', type: 'string', description: 'Issue title', required: true },
          { name: 'body', type: 'string', description: 'Issue body (markdown)' },
        ],
        async execute(args, ctx) {
          const seg = (v: unknown) => encodeURIComponent(String(v ?? ''));
          const p = `/repos/${seg(args['owner'])}/${seg(args['repo'])}/issues`;
          return wrap(async () =>
            gh(await getCredential(), 'POST', p, { title: args['title'], body: args['body'] ?? '' }, ctx.signal),
          );
        },
      },
    ];
    return tools;
  },
};
