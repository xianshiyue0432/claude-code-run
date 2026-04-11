/**
 * ConversationService — CLI subprocess manager
 *
 * Each desktop session owns one CLI subprocess. The subprocess talks back to
 * the desktop server over the SDK WebSocket bridge, while the desktop UI talks
 * to the server over its own client WebSocket.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sessionService } from './sessionService.js'

type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string
  mimeType?: string
}

type SessionProcess = {
  proc: ReturnType<typeof Bun.spawn>
  outputCallbacks: Array<(msg: any) => void>
  workDir: string
  sdkToken: string
  sdkSocket: { send(data: string): void } | null
  pendingOutbound: string[]
  stderrLines: string[]
  sdkMessages: any[]
  pendingPermissionRequests: Map<
    string,
    {
      toolName: string
      input: Record<string, unknown>
      permissionSuggestions?: unknown[]
    }
  >
}

type SessionStartOptions = {
  permissionMode?: string
  model?: string
  effort?: string
}

export class ConversationStartupError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'WORKDIR_INVALID'
      | 'CLI_AUTH_REQUIRED'
      | 'CLI_SESSION_CONFLICT'
      | 'CLI_START_FAILED'
      | 'CLI_SPAWN_FAILED',
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'ConversationStartupError'
  }
}

export class ConversationService {
  private sessions = new Map<string, SessionProcess>()

  async startSession(
    sessionId: string,
    workDir: string,
    sdkUrl: string,
    options?: SessionStartOptions,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) return

    const launchInfo = await sessionService.getSessionLaunchInfo(sessionId)
    const shouldResume = !!launchInfo && launchInfo.transcriptMessageCount > 0
    const shouldReplacePlaceholder =
      !!launchInfo && launchInfo.transcriptMessageCount === 0

    if (shouldReplacePlaceholder) {
      await sessionService.deleteSessionFile(sessionId)
    }

    if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
      throw new ConversationStartupError(
        `Working directory does not exist or is not a directory: ${workDir}`,
        'WORKDIR_INVALID',
      )
    }

    const dangerousMode = process.env.CLAUDE_DANGEROUS_MODE === '1'
    const args = this.resolveCliArgs([
      '--print',
      '--verbose',
      '--sdk-url',
      sdkUrl,
      '--enable-auth-status',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      ...(shouldResume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      '--replay-user-messages',
      ...this.getRuntimeArgs(options),
      ...this.getPermissionArgs(options?.permissionMode, dangerousMode),
    ])

    console.log(
      `[ConversationService] Starting CLI for ${sessionId}, cwd: ${workDir}`,
    )

    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn(args, {
        cwd: workDir,
        env: { ...process.env, CLAUDE_CODE_ENABLE_TASKS: '1' },
        stdin: 'pipe',
        stdout: 'ignore',  // CLI communicates via SDK WebSocket, not stdout
        stderr: 'pipe',
      })
    } catch (spawnErr) {
      throw new ConversationStartupError(
        `Failed to spawn CLI in ${workDir}: ${
          spawnErr instanceof Error ? spawnErr.message : String(spawnErr)
        }`,
        'CLI_SPAWN_FAILED',
      )
    }

    const session: SessionProcess = {
      proc,
      outputCallbacks: [],
      workDir,
      sdkToken: this.getSdkTokenFromUrl(sdkUrl),
      sdkSocket: null,
      pendingOutbound: [],
      stderrLines: [],
      sdkMessages: [],
      pendingPermissionRequests: new Map(),
    }
    this.sessions.set(sessionId, session)

    this.readErrorStream(sessionId, proc)

    proc.exited.then((code) => {
      console.log(
        `[ConversationService] CLI process for ${sessionId} exited with code ${code}`,
      )
      this.sessions.delete(sessionId)
    })

    const STARTUP_GRACE_MS = 3000
    const earlyExitCode = await Promise.race([
      proc.exited,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STARTUP_GRACE_MS),
      ),
    ])

    if (earlyExitCode !== null) {
      const startupError = this.buildStartupError(sessionId, earlyExitCode)
      this.sessions.delete(sessionId)

      if (this.clearStaleLock(sessionId)) {
        console.log(
          `[ConversationService] Removed stale lock for ${sessionId}, retrying...`,
        )
        return this.startSession(sessionId, workDir, sdkUrl, options)
      }

      console.error(
        `[ConversationService] CLI exited with code ${earlyExitCode} for ${sessionId}: ${startupError.message}`,
      )
      throw startupError
    }

    if (shouldReplacePlaceholder || !launchInfo) {
      await sessionService.appendSessionMetadata(sessionId, {
        workDir,
        customTitle: launchInfo?.customTitle ?? null,
      })
    }

    console.log(`[ConversationService] CLI started successfully for ${sessionId}`)
  }

  onOutput(sessionId: string, callback: (msg: any) => void): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.outputCallbacks.push(callback)
    }
  }

  clearOutputCallbacks(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.outputCallbacks = []
    }
  }

  sendMessage(
    sessionId: string,
    content: string,
    attachments?: AttachmentRef[],
  ): boolean {
    return this.sendSdkMessage(sessionId, {
      type: 'user',
      message: {
        role: 'user',
        content: this.buildUserContent(content, sessionId, attachments),
      },
      parent_tool_use_id: null,
      session_id: '',
    })
  }

  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    rule?: string,
  ): boolean {
    const session = this.sessions.get(sessionId)
    const pendingRequest = session?.pendingPermissionRequests.get(requestId)
    if (session) {
      session.pendingPermissionRequests.delete(requestId)
    }

    return this.sendSdkMessage(sessionId, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: allowed
          ? {
              behavior: 'allow',
              updatedInput: {},
              ...(rule === 'always' && pendingRequest
                ? {
                    updatedPermissions: [
                      ...normalizeSessionPermissionUpdates(
                        pendingRequest.permissionSuggestions,
                        pendingRequest.toolName,
                      ),
                    ],
                  }
                : {}),
            }
          : { behavior: 'deny', message: 'User denied via UI' },
      },
    })
  }

  setPermissionMode(sessionId: string, mode: string): boolean {
    return this.sendSdkMessage(sessionId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: {
        subtype: 'set_permission_mode',
        mode,
      },
    })
  }

  sendInterrupt(sessionId: string): boolean {
    return this.sendSdkMessage(sessionId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    })
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  authorizeSdkConnection(
    sessionId: string,
    token: string | null | undefined,
  ): boolean {
    const session = this.sessions.get(sessionId)
    return Boolean(session && token && token === session.sdkToken)
  }

  attachSdkConnection(
    sessionId: string,
    socket: { send(data: string): void },
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    session.sdkSocket = socket
    while (session.pendingOutbound.length > 0) {
      const line = session.pendingOutbound.shift()
      if (line) {
        socket.send(line)
      }
    }
    return true
  }

  detachSdkConnection(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.sdkSocket = null
    }
  }

  handleSdkPayload(sessionId: string, rawPayload: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const lines = rawPayload
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        session.sdkMessages.push(msg)
        if (session.sdkMessages.length > 40) {
          session.sdkMessages.shift()
        }
        if (
          msg?.type === 'control_request' &&
          msg.request?.subtype === 'can_use_tool' &&
          typeof msg.request_id === 'string'
        ) {
          session.pendingPermissionRequests.set(msg.request_id, {
            toolName:
              typeof msg.request.tool_name === 'string'
                ? msg.request.tool_name
                : 'Unknown',
            input:
              msg.request.input && typeof msg.request.input === 'object'
                ? (msg.request.input as Record<string, unknown>)
                : {},
            permissionSuggestions: Array.isArray(msg.request.permission_suggestions)
              ? msg.request.permission_suggestions
              : undefined,
          })
        }
        for (const cb of session.outputCallbacks) {
          cb(msg)
        }
      } catch {
        console.warn(
          `[ConversationService] Ignoring malformed SDK payload for ${sessionId}`,
        )
      }
    }
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.proc.kill()
      this.sessions.delete(sessionId)
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  private async readErrorStream(
    sessionId: string,
    proc: ReturnType<typeof Bun.spawn>,
  ): Promise<void> {
    if (!proc.stderr) return

    const reader = (proc.stderr as ReadableStream).getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        if (!text.trim()) continue

        const session = this.sessions.get(sessionId)
        if (session) {
          for (const line of text
            .split('\n')
            .map((entry) => entry.trim())
            .filter(Boolean)) {
            session.stderrLines.push(line)
            if (session.stderrLines.length > 20) {
              session.stderrLines.shift()
            }
          }
        }

        console.error(`[CLI:${sessionId}] ${text.trim()}`)
      }
    } catch {
      // stderr read failures should not kill the session
    }
  }

  private sendSdkMessage(
    sessionId: string,
    payload: Record<string, unknown>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    const line = JSON.stringify(payload) + '\n'
    if (session.sdkSocket) {
      session.sdkSocket.send(line)
    } else {
      session.pendingOutbound.push(line)
    }
    return true
  }

  private getPermissionArgs(
    mode: string | undefined,
    dangerousMode: boolean,
  ): string[] {
    if (dangerousMode) {
      return ['--dangerously-skip-permissions']
    }

    const resolvedMode = mode || 'default'
    if (resolvedMode === 'bypassPermissions') {
      return ['--dangerously-skip-permissions']
    }

    const args = ['--permission-mode', resolvedMode]
    return args
  }

  private getRuntimeArgs(options: SessionStartOptions | undefined): string[] {
    const args: string[] = []

    if (options?.model) {
      args.push('--model', options.model)
    }

    if (options?.effort) {
      args.push('--effort', options.effort)
    }

    return args
  }

  private resolveBundledCliPath(): string | null {
    // 桌面端 P0+P2 之后只有一个合并的 sidecar 二进制 —— `claude-sidecar`，
    // 它通过第一个 positional 参数 (server / cli) 选模式。当前进程要么
    // 已经是这个 sidecar 自己（spawn 子 CLI 时复用同一个文件），要么是
    // 旧 dev 模式下走 bin/claude-haha。这里支持两种命名：
    //   - 桌面端 prod build：进程名 claude-sidecar*
    //   - 旧 server-only 二进制（向后兼容）：claude-server*
    const execPath = process.execPath
    const execName = path.basename(execPath)

    if (execName.startsWith('claude-sidecar')) {
      // 复用同一个二进制，调用 cli 模式
      return execPath
    }

    if (execName.startsWith('claude-server')) {
      const bundledCliPath = path.join(
        path.dirname(execPath),
        execName.replace(/^claude-server/, 'claude-cli'),
      )
      return fs.existsSync(bundledCliPath) ? bundledCliPath : null
    }

    return null
  }

  private resolveCliArgs(baseArgs: string[]): string[] {
    const cliCommand = process.env.CLAUDE_CLI_PATH || this.resolveBundledCliPath()
    if (!cliCommand) {
      return [path.resolve(import.meta.dir, '../../../bin/claude-haha'), ...baseArgs]
    }

    if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(cliCommand)) {
      return ['bun', cliCommand, ...baseArgs]
    }

    const cliBaseName = path.basename(cliCommand)

    // 合并 sidecar 模式：第一个参数必须是 'cli'，后面跟 --app-root 透传
    if (cliBaseName.startsWith('claude-sidecar')) {
      const args = ['cli', ...baseArgs]
      if (process.env.CLAUDE_APP_ROOT) {
        return [cliCommand, 'cli', '--app-root', process.env.CLAUDE_APP_ROOT, ...baseArgs]
      }
      return [cliCommand, ...args]
    }

    // 旧两段式 sidecar：claude-cli 二进制需要 --app-root
    if (
      process.env.CLAUDE_APP_ROOT &&
      cliBaseName.startsWith('claude-cli')
    ) {
      return [
        cliCommand,
        '--app-root',
        process.env.CLAUDE_APP_ROOT,
        ...baseArgs,
      ]
    }

    return [cliCommand, ...baseArgs]
  }

  private clearStaleLock(sessionId: string): boolean {
    const lockDir = path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
      '.lock',
    )
    const lockFile = path.join(lockDir, sessionId)
    if (!fs.existsSync(lockFile)) {
      return false
    }

    try {
      fs.unlinkSync(lockFile)
      return true
    } catch {
      return false
    }
  }

  private buildStartupError(
    sessionId: string,
    exitCode: number,
  ): ConversationStartupError {
    const session = this.sessions.get(sessionId)
    const stderrText = session?.stderrLines.join('\n') ?? ''
    const recentMessages = session?.sdkMessages ?? []
    const resultMessage = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'result' && msg.is_error)
    const authStatus = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'auth_status')
    const detail =
      this.extractStartupDetail(resultMessage) ||
      this.extractStartupDetail(authStatus) ||
      stderrText

    if (
      /(not logged in|run \/login|sign in again|login required|unauthenticated|logged_out)/i.test(
        detail,
      )
    ) {
      return new ConversationStartupError(
        'Desktop chat could not start because Claude CLI is not authenticated. Run `./bin/claude-haha /login` or provide valid API credentials, then retry.',
        'CLI_AUTH_REQUIRED',
      )
    }

    if (/session id .*already in use/i.test(detail)) {
      return new ConversationStartupError(
        `Session ${sessionId} is already in use by another CLI process or transcript.`,
        'CLI_SESSION_CONFLICT',
        true,
      )
    }

    const normalizedDetail = detail.trim()
    return new ConversationStartupError(
      normalizedDetail
        ? `CLI exited during startup (code ${exitCode}): ${normalizedDetail}`
        : `CLI exited during startup with code ${exitCode}.`,
      'CLI_START_FAILED',
      true,
    )
  }

  private extractStartupDetail(message: any): string {
    if (!message) return ''

    if (typeof message.result === 'string') return message.result
    if (typeof message.status === 'string') return message.status
    if (typeof message.message === 'string') return message.message

    if (Array.isArray(message?.errors)) {
      return message.errors
        .filter((value: unknown): value is string => typeof value === 'string')
        .join('\n')
    }

    return ''
  }

  private buildUserContent(
    content: string,
    sessionId: string,
    attachments?: AttachmentRef[],
  ): Array<Record<string, unknown>> {
    const prefix = this.materializeAttachments(sessionId, attachments)
    const trimmed = content.trim()
    const text = prefix
      ? `${prefix}${trimmed || 'Please analyze the attached files.'}`.trim()
      : trimmed

    return [{ type: 'text', text }]
  }

  private materializeAttachments(
    sessionId: string,
    attachments?: AttachmentRef[],
  ): string {
    if (!attachments || attachments.length === 0) {
      return ''
    }

    const uploadDir = path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
      'uploads',
      sessionId,
    )
    fs.mkdirSync(uploadDir, { recursive: true })

    const savedPaths: string[] = []
    for (const attachment of attachments) {
      if (attachment.path) {
        savedPaths.push(attachment.path)
        continue
      }

      if (!attachment.data) continue

      const payload = this.parseAttachmentData(attachment.data)
      if (!payload) continue

      const ext = this.getAttachmentExtension(attachment)
      const fileName = this.sanitizeAttachmentName(attachment.name, attachment.type, ext)
      const outPath = path.join(uploadDir, `${crypto.randomUUID()}-${fileName}`)
      fs.writeFileSync(outPath, payload)
      savedPaths.push(outPath)
    }

    if (savedPaths.length === 0) {
      return ''
    }

    return savedPaths.map((filePath) => `@"${filePath}"`).join(' ') + ' '
  }

  private parseAttachmentData(data: string): Buffer | null {
    const match = data.match(/^data:.*?;base64,(.*)$/)
    const encoded = match ? match[1] : data

    try {
      return Buffer.from(encoded, 'base64')
    } catch {
      return null
    }
  }

  private getAttachmentExtension(attachment: AttachmentRef): string {
    const byName = attachment.name?.match(/\.([a-z0-9]+)$/i)?.[1]
    if (byName) return byName

    const byMime = attachment.mimeType?.split('/')[1]?.split('+')[0]
    if (byMime) return byMime

    return attachment.type === 'image' ? 'png' : 'bin'
  }

  private sanitizeAttachmentName(
    name: string | undefined,
    type: AttachmentRef['type'],
    ext: string,
  ): string {
    const fallback = `${type}-attachment.${ext}`
    const normalized = (name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_')
    return normalized || fallback
  }

  private getSdkTokenFromUrl(sdkUrl: string): string {
    const url = new URL(sdkUrl)
    return url.searchParams.get('token') || ''
  }
}

function normalizeSessionPermissionUpdates(
  suggestions: unknown[] | undefined,
  toolName: string,
) {
  if (Array.isArray(suggestions) && suggestions.length > 0) {
    return suggestions.map((suggestion) => {
      if (!suggestion || typeof suggestion !== 'object') {
        return suggestion
      }
      return {
        ...suggestion,
        destination: 'session',
      }
    })
  }

  return [
    {
      type: 'addRules',
      rules: [{ toolName }],
      behavior: 'allow',
      destination: 'session',
    },
  ]
}

export const conversationService = new ConversationService()
