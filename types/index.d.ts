// asking: a question for you · approval: a permission prompt · waiting: turn done
export type RowState = 'working' | 'waiting' | 'asking' | 'approval'

export type AgentRow = {
  id: string
  type: string
  desc: string
  running: boolean
  at: number
  model?: string
  background?: boolean
}

// Counted by this mod from the turns it saw: `fresh` is input + output + cache writes.
export type Ledger = { fresh: number; cached: number; usd: number; since: number }

export type SessionRow = {
  id: string
  title: string
  dir: string
  cwd?: string
  origin: 'desktop' | 'cli'
  state: RowState
  since: number
  skin: string
  isOwn: boolean
  // the desktop app's id (`local_…`) and the Remote Control one (`session_…`), when there is one
  hostId?: string
  bridgeId?: string
  agents: AgentRow[]
  ledger?: Ledger
}

export type Limit = { kind: string; percent: number; resetsAt?: string }

export type SessionsView = { rows: SessionRow[]; limits: Limit[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    'crab-sessions': { view: Shaped<SessionsView>; open: Shaped<string[]> }
  }
}
