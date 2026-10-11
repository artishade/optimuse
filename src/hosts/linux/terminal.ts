/**
 * Linux PTY-based terminal host.
 *
 * Ports the core concepts from the Operit2 Rust LinuxTerminalHost:
 *  - Named PTY sessions (reusable, persistent bash sessions)
 *  - Hidden command executor (key-based session reuse)
 *  - Prompt-marker tracking for working-directory + exit-code extraction
 *  - Output truncation / size limits
 *  - Command timeout + cancellation (SIGINT)
 *
 * Key simplification: Node.js has `node:child_process.spawn` with `detached: true`
 * but NOT native PTY allocation. We use a pseudo-approach: spawn bash with a
 * custom prompt marker via PROMPT_COMMAND, and parse the output to extract
 * working dir + exit code. For true PTY, we'd need the `node-pty` package,
 * but that adds a native dependency. For Phase 3, the subprocess approach is
 * sufficient and keeps us pure-Node.
 *
 * Source: /root/muse/hosts/linux/src/tools/terminal/mod.rs
 * Source: /root/notes/ANALYSIS.md §8 (hosts/linux → real shell power)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

const PTY_OUTPUT_LIMIT = 1024 * 1024; // 1MB per session buffer
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const COMMAND_CANCEL_SETTLE_MS = 3_000;

// Prompt marker: \x1b]133;OptimusePrompt=<base64-cwd>:<exitCode>\x07
// (OSC 133 = final term sequence, ST terminator = \x07)
const PROMPT_MARKER_PREFIX = Buffer.from('\x1b]133;OptimusePrompt=', 'utf8');
const PROMPT_MARKER_SUFFIX = 0x07; // BEL

/** Check if a buffer starting at `pos` contains the given prefix bytes. */
function bufferStartsWith(buf: Buffer, pos: number, prefix: Buffer): boolean {
  if (pos < 0 || pos + prefix.length > buf.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (buf[pos + i] !== prefix[i]) return false;
  }
  return true;
}

interface PtyPromptMarker {
  workingDir: string;
  exitCode: number;
}

interface PtySession {
  sessionId: string;
  sessionName: string;
  workingDir: string;
  child: ChildProcess;
  output: Buffer;
  commandBuffer: Buffer;
  commandRunning: boolean;
  exitCode: number | null;
  pendingResolve: ((result: CommandResult) => void) | null;
  pendingReject: ((error: Error) => void) | null;
}

interface CommandResult {
  command: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
}

export interface TerminalSessionInfo {
  sessionId: string;
  sessionName: string;
  platform: string;
  terminalType: string;
  isNewSession: boolean;
}

export interface TerminalSessionListEntry {
  sessionId: string;
  sessionName: string;
  platform: string;
  terminalType: string;
  sessionKind: string;
  workingDir: string;
  commandRunning: boolean;
}

export interface TerminalCommandOutput {
  command: string;
  output: string;
  exitCode: number;
  sessionId: string;
  timedOut: boolean;
}

export interface HiddenTerminalCommandOutput {
  command: string;
  output: string;
  exitCode: number;
  executorKey: string;
  timedOut: boolean;
}

export interface TerminalScreenOutput {
  sessionId: string;
  platform: string;
  terminalType: string;
  rows: number;
  cols: number;
  content: string;
  commandRunning: boolean;
}

export interface TerminalInputOutput {
  sessionId: string;
  acceptedChars: number;
}

/**
 * LinuxTerminalHost — manages persistent PTY-like bash sessions.
 *
 * Ports the Operit2 Rust `LinuxTerminalHost` struct pattern.
 * Uses spawned bash processes with prompt markers for output parsing.
 */
export class LinuxTerminalHost {
  private sessions = new Map<string, PtySession>();
  private sessionNameToId = new Map<string, string>();
  private hiddenExecutorKeyToSessionId = new Map<string, string>();
  private nextSessionId = 1;
  private readonly terminalType = 'bash';

  /**
   * Create or reuse a named session.
   * This mirrors the Rust `createOrGetSession` pattern.
   */
  async createOrGetSession(sessionName: string): Promise<TerminalSessionInfo> {
    return this.createOrGetTypedSession(sessionName, this.terminalType);
  }

  /**
   * Create or reuse a named session of a specific terminal type (e.g., "bash", "sh").
   */
  async createOrGetTypedSession(
    sessionName: string,
    terminalType: string,
  ): Promise<TerminalSessionInfo> {
    const sessionKey = `${terminalType}:${sessionName}`;

    // Check for existing live session
    const existingId = this.sessionNameToId.get(sessionKey);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && existing.child.exitCode === null) {
        return {
          sessionId: existingId,
          sessionName,
          platform: 'linux',
          terminalType,
          isNewSession: false,
        };
      }
      // Session is dead — clean up
      if (existingId) {
        this.sessionNameToId.delete(sessionKey);
      }
    }

    // Create new session
    const workingDir = process.cwd();
    const session = await this.createPtySession(sessionName, terminalType, workingDir, 24, 80);
    const sessionId = `s${this.nextSessionId++}`;
    this.sessionNameToId.set(sessionKey, sessionId);
    this.sessions.set(sessionId, session);

    return {
      sessionId,
      sessionName,
      platform: 'linux',
      terminalType,
      isNewSession: true,
    };
  }

  /**
   * Execute a command in a named session.
   * This mirrors the Rust `executeInSession` pattern with timeout + cancellation.
   */
  async executeInSession(
    sessionId: string,
    command: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<TerminalCommandOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session does not exist: ${sessionId}`);
    }
    if (session.commandRunning) {
      throw new Error(`Command already running in session: ${sessionId}`);
    }

    const timeout = Math.min(timeoutMs || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    session.commandRunning = true;
    session.commandBuffer = Buffer.alloc(0);

    // Set up the command completion promise
    const resultPromise = new Promise<CommandResult>((resolve) => {
      session.pendingResolve = resolve;
    });

    // Write command to the shell
    session.child.stdin?.write(`${command}\r\n`);

    // Timeout handling
    let timer: NodeJS.Timeout | null = null;
    let timedOut = false;

    const timerPromise = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        // Send SIGINT to cancel the running command
        session.child.kill('SIGINT');
        resolve();
      }, timeout);
    });

    // Race: command completion vs timeout
    await Promise.race([resultPromise, timerPromise]);

    if (timer) clearTimeout(timer);
    session.commandRunning = false;
    session.pendingResolve = null;

    // If timed out, wait for SIGINT to settle
    if (timedOut) {
      await new Promise((r) => setTimeout(r, COMMAND_CANCEL_SETTLE_MS));
      // Force-kill the child if still alive after SIGINT
      if (session.child.exitCode === null) {
        session.child.kill('SIGKILL');
      }
    }

    const output = renderTerminalOutput(session.commandBuffer, command);

    return {
      command,
      output,
      exitCode: timedOut ? -1 : session.exitCode ?? -1,
      sessionId,
      timedOut,
    };
  }

  /**
   * Execute a hidden command using a key-based session pool.
   * Commands are invisible to the user (no PTY display).
   * This mirrors the Rust `executeHiddenCommand` pattern.
   */
  async executeHiddenCommand(
    command: string,
    executorKey: string = 'default',
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<HiddenTerminalCommandOutput> {
    const sessionKey = `${this.terminalType}:${executorKey}`;
    const sessionId = this.hiddenExecutorKeyToSessionId.get(sessionKey);

    if (!sessionId) {
      // Create a hidden session
      const session = await this.createPtySession(
        `hidden:${executorKey}`,
        this.terminalType,
        process.cwd(),
        24,
        80,
      );
      const newId = `h${this.nextSessionId++}`;
      this.hiddenExecutorKeyToSessionId.set(sessionKey, newId);
      this.sessions.set(newId, session);

      const result = await this.executeInSession(newId, command, timeoutMs);
      return {
        command,
        output: result.output,
        exitCode: result.exitCode,
        executorKey,
        timedOut: result.timedOut,
      };
    }

    // Reuse existing session
    const result = await this.executeInSession(sessionId, command, timeoutMs);
    return {
      command,
      output: result.output,
      exitCode: result.exitCode,
      executorKey,
      timedOut: result.timedOut,
    };
  }

  /**
   * Get terminal info.
   */
  terminalInfo(): { platform: string; terminal: string; terminalType: string } {
    return {
      platform: 'linux',
      terminal: 'native',
      terminalType: this.terminalType,
    };
  }

  /**
   * List active sessions.
   */
  listSessions(): TerminalSessionListEntry[] {
    const entries: TerminalSessionListEntry[] = [];
    for (const [sessionId, session] of this.sessions) {
      if (session.child.exitCode !== null) continue; // skip dead sessions
      entries.push({
        sessionId,
        sessionName: session.sessionName,
        platform: 'linux',
        terminalType: this.terminalType,
        sessionKind: 'pty',
        workingDir: session.workingDir,
        commandRunning: session.commandRunning,
      });
    }
    return entries;
  }

  /**
   * Get session screen content (current output buffer).
   */
  getSessionScreen(sessionId: string): TerminalScreenOutput {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session does not exist: ${sessionId}`);
    }
    const content = renderTerminalOutput(session.commandBuffer, '');
    const lines = content.split('\n');
    return {
      sessionId,
      platform: 'linux',
      terminalType: this.terminalType,
      rows: Math.max(lines.length, 1),
      cols: Math.max(...lines.map((l) => l.length), 0),
      content,
      commandRunning: session.commandRunning,
    };
  }

  /**
   * Send input to a session.
   */
  inputInSession(
    sessionId: string,
    input?: string,
  ): TerminalInputOutput {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session does not exist: ${sessionId}`);
    }
    const data = input ?? '';
    const accepted = data.length;
    session.child.stdin?.write(data);
    return { sessionId, acceptedChars: accepted };
  }

  /**
   * Close a session.
   */
  closeSession(sessionId: string): { sessionId: string; success: boolean; message: string } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session does not exist: ${sessionId}`);
    }
    session.child.kill();
    this.sessions.delete(sessionId);

    // Clean up name mappings
    for (const [key, id] of this.sessionNameToId) {
      if (id === sessionId) this.sessionNameToId.delete(key);
    }
    for (const [key, id] of this.hiddenExecutorKeyToSessionId) {
      if (id === sessionId) this.hiddenExecutorKeyToSessionId.delete(key);
    }

    return {
      sessionId,
      success: true,
      message: `Terminal session closed: ${sessionId}`,
    };
  }

  // --- Internal: session creation ---

  /**
   * Create a PTY-like bash session.
   * Spawns bash with --noprofile --norc and sets PS1 / PROMPT_COMMAND
   * to embed working directory + exit code markers.
   */
  private async createPtySession(
    sessionName: string,
    terminalType: string,
    workingDir: string,
    _rows: number,
    _cols: number,
  ): Promise<PtySession> {
    await mkdir(workingDir, { recursive: true });

    const shellCmd = terminalType === 'bash' ? 'bash' : terminalType;
    const child = spawn(shellCmd, ['--noprofile', '--norc', '-i'], {
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'C.UTF-8',
        PS1: '$PWD $ ',
        // PROMPT_COMMAND emits: \x1b]133;OptimusePrompt=<base64(cwd)>:<exitcode>\x07
        // before each prompt, so we can track cwd + exit code
        PROMPT_COMMAND:
          'printf \'\\033]133;OptimusePrompt=%s:%s\\007\' "$(printf %s "$PWD" | base64 | tr -d \'\n\')" "$?"',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const sessionId = `s${this.nextSessionId++}`;

    // Set up output collection
    const session: PtySession = {
      sessionId,
      sessionName,
      workingDir,
      child,
      output: Buffer.alloc(0),
      commandBuffer: Buffer.alloc(0),
      commandRunning: false,
      exitCode: null,
      pendingResolve: null,
      pendingReject: null,
    };

    // Collect stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      this.handleOutput(session, chunk);
    });

    // Collect stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      this.handleOutput(session, Buffer.concat([
        Buffer.from('\n--- stderr ---\n'),
        chunk,
      ]));
    });

    // Track exit
    child.on('exit', (code) => {
      session.exitCode = code;
    });

    // Wait for initial prompt (bash is interactive)
    await this.waitForInitialPrompt(session, 10_000);

    return session;
  }

  // --- Internal: output handling ---

  private handleOutput(session: PtySession, chunk: Buffer) {
    // Append to overall output buffer
    session.output = Buffer.concat([session.output, chunk]);
    if (session.output.length > PTY_OUTPUT_LIMIT) {
      session.output = session.output.subarray(session.output.length - PTY_OUTPUT_LIMIT);
    }

    // If a command is running, also buffer for command completion detection
    if (session.commandRunning && session.pendingResolve) {
      session.commandBuffer = Buffer.concat([session.commandBuffer, chunk]);
      if (session.commandBuffer.length > PTY_OUTPUT_LIMIT) {
        session.commandBuffer = session.commandBuffer.subarray(
          session.commandBuffer.length - PTY_OUTPUT_LIMIT,
        );
      }

      // Check for prompt marker — indicates command completed
      const marker = this.findLastPromptMarker(session.commandBuffer);
      if (marker) {
        session.workingDir = marker.workingDir;
        session.exitCode = marker.exitCode;
        const resolve = session.pendingResolve;
        if (resolve) {
          session.pendingResolve = null;
          resolve({
            command: '',
            output: '',
            exitCode: marker.exitCode,
            timedOut: false,
          });
        }
      }
    }
  }

  private async waitForInitialPrompt(session: PtySession, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const marker = this.findLastPromptMarker(session.output);
      if (marker) {
        session.workingDir = marker.workingDir;
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Timed out waiting for terminal prompt');
  }

  private findLastPromptMarker(buffer: Buffer): PtyPromptMarker | null {
    const lastIdx = buffer.lastIndexOf(PROMPT_MARKER_PREFIX);
    if (lastIdx === -1) return null;

    const payloadStart = lastIdx + PROMPT_MARKER_PREFIX.length;
    const suffixIdx = buffer.indexOf(PROMPT_MARKER_SUFFIX, payloadStart);
    if (suffixIdx === -1) return null;

    const payload = buffer.subarray(payloadStart, suffixIdx).toString('utf8');
    const colonIdx = payload.lastIndexOf(':');
    if (colonIdx === -1) return null;

    const cwdB64 = payload.substring(0, colonIdx);
    const exitCodeStr = payload.substring(colonIdx + 1);

    try {
      const cwd = Buffer.from(cwdB64, 'base64').toString('utf8');
      const exitCode = parseInt(exitCodeStr, 10);
      if (isNaN(exitCode)) return null;
      return { workingDir: cwd || process.cwd(), exitCode };
    } catch {
      return null;
    }
  }
}

// --- Output rendering helpers (ported from Rust terminal text renderer) ---

/**
 * Render terminal output: strip prompt markers, strip device status reports,
 * collapse ANSI escapes, remove command echo, drop trailing prompt.
 */
function renderTerminalOutput(raw: Buffer, command: string): string {
  const withoutMarkers = stripPtyPromptMarkers(raw);
  const withoutDSR = stripDeviceStatusReports(withoutMarkers);
  const text = withoutDSR.toString('utf8');
  const cleaned = stripAnsiEscapes(text);
  return dropCommandEcho(cleaned, command);
}

/** Strip OptimusePrompt OSC 133 markers from output. */
function stripPtyPromptMarkers(raw: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let pos = 0;

  while (pos < raw.length) {
    if (bufferStartsWith(raw, pos, PROMPT_MARKER_PREFIX)) {
      const payloadStart = pos + PROMPT_MARKER_PREFIX.length;
      const suffixIdx = raw.indexOf(PROMPT_MARKER_SUFFIX, payloadStart);
      if (suffixIdx !== -1) {
        pos = suffixIdx + 1;
        continue;
      }
    }
    chunks.push(raw.subarray(pos, pos + 1));
    pos += 1;
  }

  return Buffer.concat(chunks);
}

/** Strip DSR (Device Status Report) responses like \x1b[6n. */
function stripDeviceStatusReports(raw: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let pos = 0;

  const dsrSeq = Buffer.from('\x1b[6n');
  while (pos < raw.length) {
    if (bufferStartsWith(raw, pos, dsrSeq)) {
      pos += 4;
      continue;
    }
    chunks.push(raw.subarray(pos, pos + 1));
    pos += 1;
  }

  return Buffer.concat(chunks);
}

/** Strip ANSI escape sequences from text. */
function stripAnsiEscapes(text: string): string {
  // Match ANSI escape sequences (CSI, OSC, etc.)
  return text.replace(/\x1b\[[0-9;?]*[!/#A-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>]/g, '');
}

/** Remove the echoed command from output (since the PTY echoes input). */
function dropCommandEcho(text: string, command: string): string {
  if (!command) return text;
  // The command may be echoed at the start of output; remove the first occurrence
  const escapedCmd = escapeRegex(command);
  const match = text.match(new RegExp(`^${escapedCmd}\\r?\\n`, 'm'));
  if (match && match.index !== undefined) {
    return text.substring(0, match.index) + text.substring(match.index + match[0].length);
  }
  return text;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}