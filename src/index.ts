/** Optimuse public API. */
export { Agent } from './core/agent.js';
export type { AgentRunResult } from './core/agent.js';
export { ToolRegistry, ToolExecutor, checkPermission } from './tools/registry.js';
export { OpenAICompatibleProvider } from './providers/openai/provider.js';
export type { Provider, ProviderConfig, ChatResponse } from './providers/openai/provider.js';
export { fsTools, shellTools } from './tools/builtin/index.js';
export { ConnectorRegistry } from './connectors/registry.js';
export type {
  ConnectorDefinition,
  Credential,
  ConnectorDeps,
  AuthMethodSpec,
  CredentialFieldSpec,
  ConnectorError,
  ConnectorErrorCode,
} from './connectors/types.js';
export { githubConnector } from './connectors/github/index.js';
export { openVault, EncryptedFileVault } from './connectors/auth/vault.js';
export { encodeCredential } from './connectors/types.js';
export { createLinuxHost, getLinuxHostTools, LinuxTerminalHost } from './hosts/linux/index.js';
export type { HostEnvironmentDescriptor, TerminalSessionInfo } from './hosts/linux/index.js';
export { resolveWorkspacePath } from './hosts/linux/fs.js';
export type { FileInfo, FileReadResult } from './hosts/linux/fs.js';
export type { SystemInfo, ProcessInfo, DiskUsage, PackageManager } from './hosts/linux/system.js';
export { fileManagerTools } from './tools/builtin/file_manager.js';
export type { FileTreeNode, FilePreview, SearchResult } from './tools/builtin/file_manager.js';
export { createAgentLinuxTools, AgentLinuxAdapter } from './agents/agent_linux_adapter.js';
export type { AgentLinuxConfig, TerminalSession, TerminalOutput } from './agents/agent_linux_adapter.js';
export * from './types/index.js';
