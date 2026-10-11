/**
 * Connector contracts — first-class service integrations with typed auth,
 * tool allowlists and read/write policy.
 */

import type { ToolDefinition } from '../types/index.js';

export type CredentialKind = 'pat' | 'api_key' | 'oauth_token' | 'password';

export interface Credential {
  kind: CredentialKind;
  secret: string;
  account?: string;
}

export interface CredentialFieldSpec {
  id: string;
  label: string;
  secret: boolean;
  required?: boolean;
  /** Regex the value must match before we accept it. */
  pattern?: string;
  placeholder?: string;
  maxLength?: number;
}

export interface AuthMethodSpec {
  id: string;
  label: string;
  kind: 'credentials';
  fields: CredentialFieldSpec[];
}

export interface ConnectorDeps {
  getCredential(): Promise<Credential>;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'dev' | 'communication' | 'productivity' | 'data';
  authMethods: AuthMethodSpec[];
  /** Read-only validation proving the credential works. Returns account label. */
  validate(cred: Credential, signal?: AbortSignal): Promise<{ account: string }>;
  createTools(deps: ConnectorDeps): ToolDefinition[];
}

/** Build a credential from user-supplied fields for a credentials-kind method. */
export function encodeCredential(
  method: AuthMethodSpec,
  fields: Record<string, string>,
): Credential {
  const first = method.fields[0];
  if (!first) throw new Error(`auth method '${method.id}' has no fields`);
  const value = (fields[first.id] ?? '').trim();
  if (!value) throw new Error(`missing field: ${first.id}`);
  if (first.pattern && !new RegExp(first.pattern).test(value)) {
    throw new Error(`field '${first.id}' does not match the expected format`);
  }
  const kind: CredentialKind = method.id.includes('pat') ? 'pat' : 'api_key';
  return { kind, secret: value };
}

/** Standard, actionable connector error codes. */
export type ConnectorErrorCode =
  | 'authorization_required'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'resource_not_found'
  | 'outcome_unknown'
  | 'request_failed';

export class ConnectorError extends Error {
  constructor(
    public code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}
