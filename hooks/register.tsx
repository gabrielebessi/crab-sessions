import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  agentSkin,
  collectSessions,
  commandFile,
  COMMAND_TTL_MS,
  crabState,
  flagFile,
  ledgerFile,
  limitsFile,
  readFlag,
  resultFile,
  stampedLimits,
} from '../core/sessions'
import type { Command, CommandResult, Flag, Io } from '../core/sessions'
import type { Ledger, Limit, SessionsView } from '../types'
import { crabSvg, pickSkin } from './sprites'

const PANE = 'crab-sessions'
const REFRESH_MS = 5000

// Change the tag when the view's fields change: it declines what an earlier
// version stored, which outlives a reload.
const view = atom(
  { plugin: 'crab-sessions', key: 'view' } as const,
  { rows: [], limits: [], at: 0 },
  { shape: 'view-4' },
)

// session ids whose agent list the person opened
const open = atom({ plugin: 'crab-sessions', key: 'open' } as const, [], { shape: 'open-1' })

const fmtTokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n)

const PANE_AGENTS = { windowMs: 30 * 60 * 1000, max: 12 }
const INBOX_MS = 1500

// $.fs as the shared reader wants it
const ioOf = ($: EngineInterface): Io => ({
  list: dir => $.fs.list(dir),
  read: path => $.fs.read(path),
  exists: path => $.fs.exists(path),
})

const TRACE_LINES = 300

// The registry cannot tell a question or a permission prompt from a busy turn:
// each session writes what it waits on, and every panel reads it.
async function setFlag($: EngineInterface, kind?: Flag) {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    await $.fs.write(flagFile(home, await $.session.id()), kind ? `${kind}:${await $.clock.now()}` : '0')
  } catch {
    // a flag must never break a turn
  }
}

// Trial log of the events that set or clear the flag: ~/.claude/crab-sessions/events.log
async function trace($: EngineInterface, name: string, detail = '') {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    const file = `${home}/.claude/crab-sessions/events.log`
    const old = await $.fs.read(file).catch(() => '')
    const at = new Date(await $.clock.now()).toISOString()
    const line = `${at} ${(await $.session.id()).slice(0, 8)} ${name} ${detail}`.trim()
    await $.fs.write(file, [...old.split('\n').filter(Boolean), line].slice(-TRACE_LINES).join('\n') + '\n')
  } catch {
    // tracing must never break a turn
  }
}

// Drops the flag when something proves the wait is over; logs only when it had one.
async function clearFlag($: EngineInterface, by: string) {
  const home = (await $.env.get('HOME')) ?? ''
  const flag = await readFlag(ioOf($), home, await $.session.id())
  if (!flag) return
  await setFlag($)
  await trace($, `clear(${flag})`, `by ${by}`)
}

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
const stateTone = { approval: 'warning', asking: 'warning', waiting: 'subtle', working: 'success' } as const
const stateLabel = {
  approval: 'Chiede il permesso',
  asking: 'Ti ha fatto una domanda',
  waiting: 'Fermo, ti aspetta',
  working: 'Sta lavorando',
} as const
const shortLabel = { approval: 'Permesso', asking: 'Domanda', waiting: 'Ti aspetta', working: 'Lavora' } as const

const LIMIT_KINDS = ['five_hour', 'seven_day']

// An idle session's own rate limits go stale: they refresh only when that session talks to the API.
// So each session stamps what it saw right after a turn, and the panel shows the newest one of all.
async function saveLimits($: EngineInterface, home: string, now: number) {
  const limits = await ownLimits($)
  if (limits.length === 0) return
  await $.fs.write(limitsFile(home, await $.session.id()), JSON.stringify({ at: now, limits }))
}

async function ownLimits($: EngineInterface): Promise<Limit[]> {
  const usage = await $.session.usage().catch(() => undefined)
  return (usage?.rateLimits ?? [])
    .filter(l => LIMIT_KINDS.includes(l.kind))
    .map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt }))
}

async function refresh($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const io = ioOf($)
  const now = await $.clock.now()
  const rows = await collectSessions(io, home, { now, ownId: await $.session.id(), agents: PANE_AGENTS, skinOf: pickSkin })
  // nothing stamped yet: this session's own reading, better than nothing
  const stamped = await stampedLimits(io, home)
  const limits = stamped.length > 0 ? stamped : await ownLimits($)

  const next: SessionsView = { rows, limits, at: now }
  await update($, view, () => next)
}

// Commands the artifact queued for this session through the local MCP server: one file per
// session, run here once, answered in a result file the artifact reads back.
async function runInbox($: EngineInterface, inbox: { handled?: string; isBusy: boolean }) {
  if (inbox.isBusy) return
  const home = (await $.env.get('HOME')) ?? ''
  const id = await $.session.id()
  const cmd = await $.fs
    .read(commandFile(home, id))
    .then(text => JSON.parse(text) as Command)
    .catch(() => undefined)
  if (!cmd) return
  inbox.handled ??= await $.fs
    .read(resultFile(home, id))
    .then(text => (JSON.parse(text) as CommandResult).id)
    .catch(() => '')
  if (cmd.id === inbox.handled) return
  inbox.handled = cmd.id

  const answer = async (status: CommandResult['status'], message?: string) => {
    const result: CommandResult = { id: cmd.id, action: cmd.action, status, at: await $.clock.now(), message }
    await $.fs.write(resultFile(home, id), JSON.stringify(result)).catch(() => undefined)
  }
  if ((await $.clock.now()) - cmd.at > COMMAND_TTL_MS) return answer('expired')

  inbox.isBusy = true
  await answer('running')
  try {
    if (cmd.action === 'compact') {
      await $.command.run({ command: 'compact' })
      await answer('done')
    } else if (cmd.action === 'clear') {
      // written first: once cleared, the session answers under a new id
      await answer('done')
      await $.command.run({ command: 'clear' })
    } else if (cmd.action === 'split') {
      // the desktop app forks this conversation into a new session with the task the person wrote
      const res = await $.mcp.call('ccd_session', 'start_session', {
        initiation: 'user_asked',
        context: 'fork',
        title: cmd.title ?? 'Copia',
        prompt: cmd.prompt ?? '',
      })
      const text = res.content.map(b => ('text' in b && typeof b.text === 'string' ? b.text : '')).join(' ').trim()
      await answer(res.isError ? 'error' : 'done', text.slice(0, 300) || undefined)
    } else if (cmd.action === 'archive') {
      // the app stops this session once archived: the answer may be the last thing it writes
      const res = await $.mcp.call('ccd_session_mgmt', 'archive_session', { session_id: 'self', reason: 'Archiviata da Crab Sessions' })
      const text = res.content.map(b => ('text' in b && typeof b.text === 'string' ? b.text : '')).join(' ').trim()
      await answer(res.isError ? 'error' : 'done', text.slice(0, 300) || undefined)
    }
  } catch (err) {
    await answer('error', err instanceof Error ? err.message : String(err))
  } finally {
    inbox.isBusy = false
  }
}

export const register: Register = on => {
  let timer: { cancel: () => void } | undefined
  let inboxTimer: { cancel: () => void } | undefined
  const inbox: { handled?: string; isBusy: boolean } = { isBusy: false }

  on('session.start', async ($, e, next) => {
    // every session, the terminal's too, runs what the artifact asks of it
    inboxTimer?.cancel()
    inboxTimer = $.clock.every(INBOX_MS, () => void runInbox($, inbox))

    // The CLI's REPL starts on the terminal surface: it gets no panel, but its turns still feed the desktop panel.
    if (e.surface === 'terminal') return next(e)

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
      const file = ledgerFile(home, await $.session.id())
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
      await saveLimits($, home, await $.clock.now())
    } catch {
      // counting must never break a turn
    }

    return result
  })

  // A question for the person: the flag stands for as long as the tool waits.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await setFlag($, 'question')
    await trace($, 'set(question)', 'AskUserQuestion')
    try {
      return await next(e)
    } finally {
      await setFlag($)
    }
  })

  // A permission prompt is about to be shown.
  on('classic.PermissionRequest', async ($, e, next) => {
    await setFlag($, 'approval')
    await trace($, 'set(approval)', `PermissionRequest ${e.tool_name}`)

    return next(e)
  })

  // An MCP server asks the person for input.
  on('classic.Elicitation', async ($, e, next) => {
    await setFlag($, 'question')
    await trace($, 'set(question)', `Elicitation ${e.mcp_server_name}`)

    return next(e)
  })

  // Same signals as the engine's own notifications: a second path, and the log shows which types arrive.
  on('classic.Notification', async ($, e, next) => {
    await trace($, 'Notification', e.notification_type)
    if (e.notification_type === 'permission_prompt') await setFlag($, 'approval')
    if (e.notification_type === 'elicitation_dialog') await setFlag($, 'question')

    return next(e)
  })

  // Anything that happens only after the person has answered, or the turn is over, ends the wait.
  on('classic.PostToolUse', async ($, e, next) => {
    await clearFlag($, `PostToolUse ${e.tool_name}`)

    return next(e)
  })
  on('classic.PostToolUseFailure', async ($, e, next) => {
    await clearFlag($, `PostToolUseFailure ${e.tool_name}`)

    return next(e)
  })
  on('classic.PermissionDenied', async ($, e, next) => {
    await clearFlag($, 'PermissionDenied')

    return next(e)
  })
  on('classic.ElicitationResult', async ($, e, next) => {
    await clearFlag($, `ElicitationResult ${e.action}`)

    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    await clearFlag($, 'Stop')

    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await clearFlag($, 'UserPromptSubmit')

    return next(e)
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
                      source={crabSvg(row.skin, crabState(row.state, at - row.since))}
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
