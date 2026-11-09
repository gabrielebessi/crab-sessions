// The sessions open on this Mac, read from Claude Code's own files. Shared by the mod's pane
// (through `$.fs`) and the local MCP server behind the artifact (through node:fs): no `$`, no
// Node here, and only type imports, so Node can run this file as it is.
import type { AgentRow, Ledger, Limit, RowState, SessionRow } from '../types'

export type Io = {
  list: (dir: string) => Promise<readonly { name: string; mtimeMs: number }[]>
  read: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
}

type Registry = {
  pid: number
  sessionId: string
  cwd: string
  name?: string
  status?: string
  entrypoint?: string
  statusUpdatedAt?: number
  updatedAt?: number
  startedAt?: number
  messagingSocketPath?: string
  hostSessionId?: string
  bridgeSessionId?: string
}

export type Flag = 'question' | 'approval'

// A session left waiting this long stops waving and falls asleep.
export const SLEEP_AFTER_MS = 10 * 60 * 1000
const AGENT_RUNNING_MS = 120 * 1000

export const ORDER = { approval: 0, asking: 1, waiting: 2, working: 3 } as const

export const crabDir = (home: string) => `${home}/.claude/crab-sessions`
export const flagFile = (home: string, id: string) => `${crabDir(home)}/ask-${id}.txt`
export const ledgerFile = (home: string, id: string) => `${crabDir(home)}/tokens-${id}.json`
export const limitsFile = (home: string, id: string) => `${crabDir(home)}/limits-${id}.json`
export const inboxDir = (home: string) => `${crabDir(home)}/inbox`
export const commandFile = (home: string, id: string) => `${inboxDir(home)}/${id}.json`
export const resultFile = (home: string, id: string) => `${inboxDir(home)}/${id}.result.json`
// sessions the person hid from the board: terminal ones, which the app cannot archive
export const hiddenFile = (home: string) => `${crabDir(home)}/hidden.json`
export const transcriptDir = (home: string, cwd: string, id: string) =>
  `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}`

export const lastDir = (cwd: string) => cwd.split('/').filter(Boolean).pop() ?? cwd

export const agentSkin = (type: string) =>
  /explore|fetch|search/i.test(type) ? 'research' : /plan/i.test(type) ? 'docs' : 'plain'

export type CrabState = 'working' | 'idle' | 'asking' | 'approval' | 'waiting'

export const crabState = (state: RowState, waitedMs: number): CrabState =>
  state === 'waiting' ? (waitedMs >= SLEEP_AFTER_MS ? 'idle' : 'waiting') : state === 'working' ? 'working' : state

export async function readFlag(io: Io, home: string, id: string): Promise<Flag | undefined> {
  const kind = (await io.read(flagFile(home, id)).catch(() => '0')).split(':')[0]

  return kind === 'question' || kind === 'approval' ? kind : undefined
}

export type AgentWindow = { windowMs: number; max: number }

// Agents of one session: its transcripts keep one meta file per agent.
export async function agentsOf(
  io: Io,
  home: string,
  cwd: string,
  id: string,
  now: number,
  { windowMs, max }: AgentWindow,
): Promise<AgentRow[]> {
  const dir = `${transcriptDir(home, cwd, id)}/subagents`
  const entries = await io.list(dir).catch(() => [])
  const recent = entries
    .filter(x => x.name.endsWith('.jsonl') && now - x.mtimeMs < windowMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, max)
  const out: AgentRow[] = []
  for (const file of recent) {
    const agentId = file.name.replace(/\.jsonl$/, '')
    try {
      const meta = JSON.parse(await io.read(`${dir}/${agentId}.meta.json`)) as {
        agentType?: string
        description?: string
        finished?: boolean
        model?: string
        requestShape?: string
      }
      out.push({
        id: agentId,
        type: meta.agentType ?? 'agent',
        desc: meta.description ?? '',
        running: meta.finished !== true && now - file.mtimeMs < AGENT_RUNNING_MS,
        at: file.mtimeMs,
        model: meta.model,
        background: meta.requestShape === 'background',
      })
    } catch {
      // a half-written meta file: skipped until the next refresh
    }
  }
  return out.sort((a, b) => Number(b.running) - Number(a.running) || b.at - a.at)
}

export type CollectOptions = {
  now: number
  ownId?: string
  agents: AgentWindow
  skinOf: (title: string, cwd: string) => string
}

// One row per live session, the ones that wait on the person first.
export async function collectSessions(io: Io, home: string, opts: CollectOptions): Promise<SessionRow[]> {
  const dir = `${home}/.claude/sessions`
  const rows: SessionRow[] = []

  const entries = await io.list(dir).catch(() => [])
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    try {
      const reg = JSON.parse(await io.read(`${dir}/${entry.name}`)) as Registry
      // a registry file whose process is gone leaves no socket behind
      if (reg.messagingSocketPath && !(await io.exists(reg.messagingSocketPath))) continue
      const busy = reg.status === 'busy'
      const flag = busy ? await readFlag(io, home, reg.sessionId) : undefined
      const state: RowState = flag === 'approval' ? 'approval' : flag === 'question' ? 'asking' : busy ? 'working' : 'waiting'
      const title = reg.name || lastDir(reg.cwd)
      rows.push({
        id: reg.sessionId,
        title,
        dir: lastDir(reg.cwd),
        cwd: reg.cwd,
        origin: reg.entrypoint === 'claude-desktop' ? 'desktop' : 'cli',
        state,
        since: reg.statusUpdatedAt ?? reg.updatedAt ?? opts.now,
        skin: opts.skinOf(title, reg.cwd),
        isOwn: reg.sessionId === opts.ownId,
        hostId: reg.hostSessionId,
        bridgeId: reg.bridgeSessionId,
        agents: await agentsOf(io, home, reg.cwd, reg.sessionId, opts.now, opts.agents),
        ledger: await io
          .read(ledgerFile(home, reg.sessionId))
          .then(text => JSON.parse(text) as Ledger)
          .catch(() => undefined),
      })
    } catch {
      // one unreadable file must not hide the others
    }
  }

  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.since - b.since)
}

type LimitsFile = { at: number; limits: Limit[] }

// An idle session's own rate limits go stale: each session stamps what it saw right after a
// turn, and the newest stamp of all wins. Empty when no session stamped one yet.
export async function stampedLimits(io: Io, home: string): Promise<Limit[]> {
  const dir = crabDir(home)
  const entries = await io.list(dir).catch(() => [])
  let best: LimitsFile | undefined
  for (const entry of entries) {
    if (!/^limits-.+\.json$/.test(entry.name)) continue
    try {
      const file = JSON.parse(await io.read(`${dir}/${entry.name}`)) as LimitsFile
      if (!best || file.at > best.at) best = file
    } catch {
      // half-written: skipped until the next refresh
    }
  }
  return best?.limits ?? []
}

// What the artifact asks a session to do; the mod in that session runs it and answers.
export type CommandAction = 'compact' | 'clear' | 'split' | 'archive'

export type Command = { id: string; action: CommandAction; at: number; prompt?: string; title?: string }

export type CommandResult = {
  id: string
  action: CommandAction
  status: 'running' | 'done' | 'error' | 'expired'
  at: number
  message?: string
}

// A command older than this, never picked up (the session was closed), is not run any more.
export const COMMAND_TTL_MS = 2 * 60 * 1000
