/**
 * Linux host environment descriptor.
 *
 * Ports the Operit2 HostEnvironmentDescriptor (Rust) into TypeScript.
 * Describes the host's platform, privilege level, isolation state,
 * capabilities, and workspace roots — the OS-granted capability surface
 * that the 4-layer security model layer 1 (Host Authorization) is based on.
 *
 * Source: /root/notes/ANALYSIS.md §2 "4-layer security model"
 * Source: /root/muse/hosts/linux/src/lib.rs (LinuxHostRuntime...)
 * Source: permission-access-architecture.md §4 (HostEnvironmentDescriptor)
 */

import { userInfo } from 'node:os';
import { statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';

export type HostPlatform = 'linux' | 'android' | 'web' | 'windows' | 'macos';

export type HostPrivilege =
  | 'normal'        // standard user
  | 'root'          // full root
  | 'service';      // system service account

export type HostIsolation = 'none' | 'container' | 'virtual_machine';

export interface HostCapability {
  id: string;
  displayName: string;
  description: string;
  /** Whether this capability is available in the current runtime. */
  available: boolean;
}

export interface WorkspaceRootDescriptor {
  id: string;
  path: string;
  displayName: string;
  writable: boolean;
}

export interface HostOnboardingRequirement {
  id: string;
  title: string;
  description: string;
  /** Whether the requirement is satisfied at runtime. */
  satisfied: boolean;
}

export interface HostEnvironmentDescriptor {
  id: string;
  displayName: string;
  platform: HostPlatform;
  privilege: HostPrivilege;
  isolation: HostIsolation;
  capabilities: HostCapability[];
  workspaceRoots: WorkspaceRootDescriptor[];
  onboardingRequirements: HostOnboardingRequirement[];
}

/**
 * Detect the Linux host environment at runtime.
 * Checks for root, containerization, and available system capabilities.
 *
 * This is async because container detection requires reading /proc files.
 */
export async function detectLinuxHost(workspaceRoot: string): Promise<HostEnvironmentDescriptor> {
  const isRoot = userInfo().uid === 0;
  const priv: HostPrivilege = isRoot ? 'root' : 'normal';

  // Container detection (cgroups v1/v2 + /proc/1/sched)
  const isolation = await detectIsolation();

  const capabilities: HostCapability[] = [
    {
      id: 'filesystem',
      displayName: 'Filesystem',
      description: 'Read and write files within the workspace root',
      available: canAccessFilesystem(workspaceRoot),
    },
    {
      id: 'terminal',
      displayName: 'Terminal',
      description: 'Execute shell commands via PTY session',
      available: canRunTerminal(),
    },
    {
      id: 'network',
      displayName: 'Network',
      description: 'Outbound HTTP/HTTPS requests',
      available: true,
    },
    {
      id: 'notifications',
      displayName: 'Notifications',
      description: 'Desktop notifications via notify-send',
      available: canSendNotifications(),
    },
    {
      id: 'process',
      displayName: 'Process Management',
      description: 'List and inspect running processes',
      available: canReadProc(),
    },
    {
      id: 'sudo',
      displayName: 'Elevated Privileges',
      description: 'Sudo / setuid elevation (only available if root or sudo configured)',
      available: isRoot || hasSudo(),
    },
  ];

  const workspaceRoots: WorkspaceRootDescriptor[] = [
    {
      id: 'main',
      path: workspaceRoot,
      displayName: workspaceRoot,
      writable: isWritable(workspaceRoot),
    },
  ];

  const onboardingRequirements: HostOnboardingRequirement[] = [
    {
      id: 'filesystem_access',
      title: 'Filesystem access',
      description: `Read/write access to ${workspaceRoot}`,
      satisfied: canAccessFilesystem(workspaceRoot),
    },
    {
      id: 'terminal_access',
      title: 'Terminal access',
      description: 'Shell execution capability',
      satisfied: canRunTerminal(),
    },
  ];

  return {
    id: `linux-${process.pid}`,
    displayName: `Linux (${priv}${isRoot ? ' +root' : ''}${
      isolation !== 'none' ? ` in ${isolation}` : ''
    })`,
    platform: 'linux',
    privilege: priv,
    isolation,
    capabilities,
    workspaceRoots,
    onboardingRequirements,
  };
}

// --- Detection helpers ---

async function detectIsolation(): Promise<HostIsolation> {
  // Check cgroups for container indicators
  try {
    const cgroup = await fs.readFile('/proc/1/cgroup', 'utf8');
    if (cgroup.includes('docker') || cgroup.includes('containerd')) return 'container';
    if (cgroup.includes('kubepods')) return 'container';
  } catch {
    // not in a cgroup-readable environment
  }

  // Check /proc/1/sched for container runtime indicators
  try {
    const sched = await fs.readFile('/proc/1/sched', 'utf8');
    const indicators = ['docker', 'containerd', 'kubepods', 'lxc', 'podman'];
    if (indicators.some((c) => sched.includes(c))) return 'container';
  } catch {
    // not readable
  }

  return 'none';
}

function canAccessFilesystem(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isWritable(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function canRunTerminal(): boolean {
  return ['bash', 'sh', 'zsh', 'fish'].some((shell) => {
    try {
      execSync(`which ${shell}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  });
}

function canSendNotifications(): boolean {
  try {
    execSync('which notify-send', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function canReadProc(): boolean {
  try {
    execSync('test -r /proc/self/status', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function hasSudo(): boolean {
  try {
    execSync('which sudo', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}