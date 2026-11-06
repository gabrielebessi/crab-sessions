import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Ledger, Limit, SessionRow, SessionsView } from '../types'
import { crabSvg, pickSkin } from './sprites'
import type { CrabState } from './sprites'

const PANE = 'crab-sessions'
const REFRESH_MS = 5000

// Change the tag when the view's fields change: it declines what an earlier
// version stored, which outlives a reload.
const view = atom(
  { plugin: 'crab-sessions', key: 'view' } as const,
  { rows: [], limits: [], at: 0 },
  { shape: 'view-3' },
)

// session ids whose agent list the person opened
const open = atom({ plugin: 'crab-sessions', key: 'open' } as const, [], { shape: 'open-1' })

const fmtTokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n)

const AGENT_WINDOW_MS = 30 * 60 * 1000
const AGENT_RUNNING_MS = 120 * 1000

// Agents of one session: its transcripts keep one meta file per agent.
async function agentsOf($: EngineInterface, home: string, cwd: string, id: string, now: number): Promise<AgentRow[]> {
  const dir = `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}/subagents`
  const entries = await $.fs.list(dir).catch(() => [])
  const recent = entries
    .filter(x => x.name.endsWith('.jsonl') && now - x.mtimeMs < AGENT_WINDOW_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 12)
  const out: AgentRow[] = []
  for (const file of recent) {
    const agentId = file.name.replace(/\.jsonl$/, '')
    try {
      const meta = JSON.parse(await $.fs.read(`${dir}/${agentId}.meta.json`)) as {
        agentType?: string
        description?: string
        finished?: boolean
      }
      out.push({
        id: agentId,
        type: meta.agentType ?? 'agent',
        desc: meta.description ?? '',
        running: meta.finished !== true && now - file.mtimeMs < AGENT_RUNNING_MS,
        at: file.mtimeMs,
      })
    } catch {
      // a half-written meta file: skipped until the next refresh
    }
  }
  return out.sort((a, b) => Number(b.running) - Number(a.running) || b.at - a.at)
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
}

const agentSkin = (type: string) => (/explore|fetch|search/i.test(type) ? 'research' : /plan/i.test(type) ? 'docs' : 'plain')

const ORDER = { asking: 0, waiting: 1, working: 2 } as const

const lastDir = (cwd: string) => cwd.split('/').filter(Boolean).pop() ?? cwd

function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 1) return 'ora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ${min % 60 ? `${min % 60} min` : ''}`.trim()
  return `${Math.floor(h / 24)} g ${h % 24} h`
}

function until(ms: number): string {
  if (ms <= 0) return 'ora'
  const min = Math.ceil(ms / 60000)
  if (min < 60) return `tra ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `tra ${h} h ${min % 60} min`
  return `tra ${Math.floor(h / 24)} g ${h % 24} h`
}

function clockTime(iso: string, withDay: boolean): string {
  try {
    const d = new Date(iso)
    const opts: Intl.DateTimeFormatOptions = withDay
      ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }
      : { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }
    return d.toLocaleString('it-IT', opts)
  } catch {
    return ''
  }
}

function bar(percent: number, width: number): string {
  const full = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

const toneOf = (percent: number) => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success')
const stateTone = { asking: 'warning', waiting: 'subtle', working: 'success' } as const
const stateLabel = { asking: 'Ti ha fatto una domanda', waiting: 'Fermo, ti aspetta', working: 'Sta lavorando' } as const
const shortLabel = { asking: 'Domanda', waiting: 'Ti aspetta', working: 'Lavora' } as const
const crabState = { asking: 'asking', waiting: 'idle', working: 'working' } as const satisfies Record<string, CrabState>

async function refresh($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const dir = `${home}/.claude/sessions`
  const own = await $.session.id()
  const now = await $.clock.now()
  const rows: SessionRow[] = []

  const entries = await $.fs.list(dir).catch(() => [])
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    try {
      const reg = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Registry
      // a registry file whose process is gone leaves no socket behind
      if (reg.messagingSocketPath && !(await $.fs.exists(reg.messagingSocketPath))) continue
      const busy = reg.status === 'busy'
      const asked = await $.fs
        .read(`${home}/.claude/crab-sessions/ask-${reg.sessionId}.txt`)
        .then(text => Number(text) > 0)
        .catch(() => false)
      const state = busy && asked ? 'asking' : busy ? 'working' : 'waiting'
      const title = reg.name || lastDir(reg.cwd)
      rows.push({
        id: reg.sessionId,
        title,
        dir: lastDir(reg.cwd),
        origin: reg.entrypoint === 'claude-desktop' ? 'desktop' : 'cli',
        state,
        since: reg.statusUpdatedAt ?? reg.updatedAt ?? now,
        skin: pickSkin(title, reg.cwd),
        isOwn: reg.sessionId === own,
        agents: await agentsOf($, home, reg.cwd, reg.sessionId, now),
        ledger: await $.fs
          .read(`${home}/.claude/crab-sessions/tokens-${reg.sessionId}.json`)
          .then(text => JSON.parse(text) as Ledger)
          .catch(() => undefined),
      })
    } catch {
      // one unreadable file must not hide the others
    }
  }

  rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.since - b.since)

  const usage = await $.session.usage().catch(() => undefined)
  const limits: Limit[] = (usage?.rateLimits ?? [])
    .filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')
    .map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt }))

  const next: SessionsView = { rows, limits, at: now }
  await update($, view, () => next)
}

export const register: Register = on => {
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'crab', description: 'Mostra il pannello delle sessioni con il granchio' })
    void $.ui.open({ id: PANE, title: 'Sessioni' })
    timer?.cancel()
    void refresh($)
    timer = $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'crab' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Sessioni' })
    await refresh($)

    return { text: 'Pannello sessioni aperto.' }
  })

  // Tokens and cost of this session, counted turn by turn from when the mod runs.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      const home = (await $.env.get('HOME')) ?? ''
      const file = `${home}/.claude/crab-sessions/tokens-${await $.session.id()}.json`
      const old = await $.fs
        .read(file)
        .then(text => JSON.parse(text) as Ledger)
        .catch(() => ({ fresh: 0, cached: 0, usd: 0, since: 0 }))
      const u = e.usage
      const usage = await $.session.usage().catch(() => undefined)
      const total: Ledger = {
        fresh: old.fresh + (u ? u.input_tokens + u.output_tokens + u.cache_creation_input_tokens : 0),
        cached: old.cached + (u?.cache_read_input_tokens ?? 0),
        usd: usage?.cost?.usd ?? old.usd,
        since: old.since || (await $.clock.now()),
      }
      await $.fs.write(file, JSON.stringify(total))
    } catch {
      // counting must never break a turn
    }

    return result
  })

  // The registry cannot tell a question from a pause: this session says it.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? ''
    const file = `${home}/.claude/crab-sessions/ask-${await $.session.id()}.txt`
    await $.fs.write(file, String(await $.clock.now()))
    try {
      return await next(e)
    } finally {
      await $.fs.write(file, '0')
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // the terminal draws no Svg: it gets a plain crab
    const Svg = 'Svg' in els ? els.Svg : undefined
    const data = await read($, view)
    const openIds = await read($, open)
    const at = data.at || (await $.clock.now())
    const waiting = data.rows.filter(r => r.state !== 'working').length
    const working = data.rows.length - waiting
    const barWidth = Math.max(8, Math.min(40, (e.props.bodyColumns ?? 30) - 4))

    const limit = (kind: string, label: string) => {
      const l = data.limits.find(x => x.kind === kind)
      if (!l) {
        return (
          <Box flexDirection="column">
            <Text>{label}</Text>
            <Text dimColor>nessun dato ancora</Text>
          </Box>
        )
      }
      const resets = l.resetsAt ? Date.parse(l.resetsAt) : undefined
      const when = l.resetsAt ? clockTime(l.resetsAt, kind === 'seven_day') : ''
      return (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text>{label}</Text>
            <Text bold>{Math.round(l.percent)}%</Text>
          </Box>
          <Text color={toneOf(l.percent)}>{bar(l.percent, barWidth)}</Text>
          {resets !== undefined && (
            <Text dimColor>
              reset {when ? `${when} · ` : ''}
              {until(resets - at)}
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold>Sessioni</Text>
          <Text dimColor>
            {waiting} ti aspettano · {working} lavorano
          </Text>
        </Box>
        <Text dimColor>Token: nuovi (input, output, scrittura cache) contati da quando la mod è attiva nella sessione.</Text>
        <Box flexDirection="column">
          {limit('five_hour', 'Sessione 5 ore')}
          {limit('seven_day', 'Settimana')}
        </Box>
        {data.rows.length === 0 && <Text dimColor>Nessuna sessione aperta.</Text>}
        <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="flex-start">
          {data.rows.map(row => {
            const agents = row.agents ?? []
            const running = agents.filter(a => a.running)
            const isOpen = openIds.includes(row.id)
            return (
              <Box
                key={row.id}
                width="48%"
                flexDirection="column"
                borderStyle="round"
                borderColor={stateTone[row.state]}
                paddingX={1}
              >
                <Box gap={1} alignItems="center">
                  {Svg ? (
                    <Svg
                      source={crabSvg(row.skin, crabState[row.state])}
                      alt={stateLabel[row.state]}
                      width={44}
                      height={34}
                      isInteractive
                    />
                  ) : (
                    <Text>🦀</Text>
                  )}
                  <Box flexDirection="column" flexGrow={1} minWidth={0}>
                    <Text bold>
                      {row.title}
                      {row.isOwn ? ' ●' : ''}
                    </Text>
                    <Text dimColor>{row.dir}</Text>
                    <Text color={stateTone[row.state]}>
                      {shortLabel[row.state]} · {ago(at - row.since)}
                    </Text>
                    {row.ledger && (
                      <Text dimColor>
                        {fmtTokens(row.ledger.fresh)} token · ${row.ledger.usd.toFixed(2)}
                      </Text>
                    )}
                    {agents.length > 0 && (
                      <Box>
                        {agents.slice(0, 8).map(a => (
                          <Text color={a.running ? 'success' : 'inactive'}>● </Text>
                        ))}
                        <Button
                          key={`agents-${row.id}`}
                          plain
                          dimColor
                          onPress={() =>
                            update($, open, ids => (ids.includes(row.id) ? ids.filter(x => x !== row.id) : [...ids, row.id]))
                          }
                        >
                          {running.length}/{agents.length} {isOpen ? '▾' : '▸'}
                        </Button>
                      </Box>
                    )}
                  </Box>
                </Box>
                {Svg && running.length > 0 && (
                  <Box gap={0} alignItems="center" marginLeft={1}>
                    {running.slice(0, 5).map(a => (
                      <Svg
                        key={a.id}
                        source={crabSvg(agentSkin(a.type), 'working')}
                        alt={a.desc}
                        width={26}
                        height={20}
                        isInteractive
                      />
                    ))}
                    <Text dimColor>
                      {' '}
                      {running.length} {running.length === 1 ? 'agente' : 'agenti'} al lavoro
                    </Text>
                  </Box>
                )}
                {isOpen &&
                  agents.map(a => (
                    <Box key={a.id} gap={1}>
                      <Text color={a.running ? 'success' : 'inactive'}>●</Text>
                      <Text bold dimColor={!a.running}>
                        {a.type}
                      </Text>
                      <Box flexGrow={1} minWidth={0}>
                        <Text dimColor>{a.desc}</Text>
                      </Box>
                      <Text dimColor>{a.running ? ago(at - a.at) : 'finito'}</Text>
                    </Box>
                  ))}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
