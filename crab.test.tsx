import { expect, mock, test } from 'claude-code/testing'

import { fableWeek, stampedLimits, weekStart } from './core/sessions'
import type { Io } from './core/sessions'
import { crabSvg, pickSkin, SKINS } from './hooks/sprites'

const PANE = {
  plugin: 'crab-sessions',
  component: 'Pane',
  requestId: 'crab-sessions',
  props: {
    title: 'Sessioni',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const VIEW = {
  at: 1_800_000_000_000,
  limits: [
    { kind: 'five_hour', percent: 37, resetsAt: '2027-01-15T11:20:00.000Z' },
    { kind: 'seven_day', percent: 71, resetsAt: '2027-01-20T08:00:00.000Z' },
  ],
  rows: [
    { id: 'a', title: 'Riduzione latenza modem', dir: 'ps5-remote-play', origin: 'desktop', state: 'asking', since: 1_799_999_000_000, skin: 'devops', isOwn: false, agents: [] },
    { id: 'c', title: 'Deploy staging', dir: 'infra', origin: 'cli', state: 'approval', since: 1_799_999_500_000, skin: 'plain', isOwn: false, agents: [] },
    { id: 'd', title: 'Report mensile', dir: 'report', origin: 'desktop', state: 'waiting', since: 1_799_999_800_000, skin: 'docs', isOwn: false, agents: [] },
    { id: 'e', title: 'Vecchia sessione', dir: 'old', origin: 'desktop', state: 'waiting', since: 1_799_990_000_000, skin: 'plain', isOwn: false, agents: [] },
    { id: 'b', title: 'Mod sessioni', dir: 'ps5-remote-play', origin: 'desktop', state: 'working', since: 1_799_999_900_000, skin: 'game', isOwn: true, ledger: { fresh: 1_250_000, cached: 9_000_000, usd: 3.4, since: 1 }, agents: [{ id: 'x1', type: 'Explore', desc: 'Cerca PhonePadServer', running: true, at: 1_799_999_990_000 }, { id: 'x2', type: 'Plan', desc: 'Piano certificati', running: false, at: 1_799_999_000_000 }] },
  ],
}

test('the pane shows limits and one card per session', async ($, on) => {
  on('state.get', () => ({ value: { value: { shape: 'view-4', value: VIEW }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Sessione 5 ore/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /37%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /71%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Riduzione latenza modem/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /●/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Domanda/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Permesso/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Ti aspetta/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1,3 M token/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('the terminal draws a plain crab instead of the Svg', async ($, on) => {
  on('state.get', () => ({ value: { value: { shape: 'view-4', value: VIEW }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Riduzione latenza modem/ })).toBeDefined()
  await ui.unmount()
})

test('a value an earlier version stored is declined and the pane says so', async ($, on) => {
  on('clock.now', () => ({ value: 1_800_000_000_000 }))
  // the shape tag of an older version differs: the stored value is declined
  on('state.get', () => ({ value: { value: { shape: 'view-0', value: [] }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Nessuna sessione aperta/ })).toBeDefined()
  await ui.unmount()
})

test('the agent list opens on a press of the dots line', async ($, on) => {
  const store: Record<string, unknown> = { view: { shape: 'view-4', value: VIEW } }
  on('state.get', (_, e) => ({ value: { value: store[e.key], version: 1 } }))
  on('state.set', (_, e) => {
    store[e.key] = e.value

    return { value: { isSet: true, version: 2 } }
  })

  on('ui.invalidate', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Cerca PhonePadServer/ })).toBeUndefined()
  const button = await ui.find({ key: 'agents-b' })
  expect(button?.type).toBe('Button')
  await ui.press({ key: 'agents-b' })
  expect(JSON.stringify(store.open)).toContain('b')
  await ui.unmount()

  // what the press stored is what the next drawing shows
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await again.find({ type: 'Text', text: /Cerca PhonePadServer/ })).toBeDefined()
  await again.unmount()
})

test('each task gets its own skin, and every skin draws every state', () => {
  expect(pickSkin('Fix errore login', '/work/crm')).toBe('debug')
  expect(pickSkin('Montaggio video promo', '/work/clip')).toBe('video')
  expect(pickSkin('Mockup nuova home', '/work/site')).toBe('design')
  expect(pickSkin('Schermata profilo', '/work/mobile-app')).toBe('app')
  expect(pickSkin('Gestionale clienti', '/work/laravel')).toBe('code')
  expect(pickSkin('Pulizia', '/work/misc')).toBe('plain')

  const plain = crabSvg('plain', 'working')
  for (const skin of Object.keys(SKINS)) {
    for (const state of ['working', 'asking', 'approval', 'waiting', 'idle'] as const) {
      expect(crabSvg(skin, state)).toContain('<svg')
    }
    if (skin !== 'plain') expect(crabSvg(skin, 'working')).not.toBe(plain)
  }
})

// The artifact's commands reach a session as a file the mod reads on its timer.
test('a command the artifact queued runs once in its session and is answered', async ($, on) => {
  const T = 1_800_000_000_000
  const clock = mock.clock(on, { now: T })
  mock.env(on, { HOME: '/h' })
  const inbox = '/h/.claude/crab-sessions/inbox'
  const files: Record<string, string> = {
    [`${inbox}/s1.json`]: JSON.stringify({ id: 'c1', action: 'compact', at: T }),
  }
  const runs: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'missing' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.run', (_, e) => {
    runs.push(e.command)
    return { text: '' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  expect(runs).toEqual(['compact'])
  expect(JSON.parse(files[`${inbox}/s1.result.json`])).toEqual(expect.objectContaining({ id: 'c1', status: 'done' }))

  // already answered: not run again
  await clock.advance(3000)
  expect(runs).toEqual(['compact'])

  // left in the inbox too long (the session was closed): answered, never run
  files[`${inbox}/s1.json`] = JSON.stringify({ id: 'c2', action: 'clear', at: T - 10 * 60 * 1000 })
  await clock.advance(1500)
  expect(runs).toEqual(['compact'])
  expect(JSON.parse(files[`${inbox}/s1.result.json`])).toEqual(expect.objectContaining({ id: 'c2', status: 'expired' }))
})

// A terminal session moved to the app runs its /desktop, answered first: the terminal then closes.
test('a move to the app runs /desktop, or says why it cannot', async ($, on) => {
  const T = 1_800_000_000_000
  const clock = mock.clock(on, { now: T })
  mock.env(on, { HOME: '/h' })
  const inbox = '/h/.claude/crab-sessions/inbox'
  const files: Record<string, string> = {
    [`${inbox}/s1.json`]: JSON.stringify({ id: 'd1', action: 'desktop', at: T }),
  }
  const runs: string[] = []
  let hasDesktop = true
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'missing' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.list', () => ({
    value: hasDesktop ? [{ name: 'desktop', description: 'Continue the current session in Claude Desktop', source: 'builtin' }] : [],
  }))
  on('command.run', (_, e) => {
    runs.push(e.command)
    expect(JSON.parse(files[`${inbox}/s1.result.json`])).toEqual(expect.objectContaining({ id: 'd1', status: 'done' }))
    return { text: '' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  expect(runs).toEqual(['desktop'])

  // a Claude Code without /desktop (not signed in with a Claude account): answered, not run
  hasDesktop = false
  files[`${inbox}/s1.json`] = JSON.stringify({ id: 'd2', action: 'desktop', at: T + 1500 })
  await clock.advance(1500)
  expect(runs).toEqual(['desktop'])
  expect(JSON.parse(files[`${inbox}/s1.result.json`])).toEqual(expect.objectContaining({ id: 'd2', status: 'error' }))
})

// what the pane does on a desktop session's start, with the given options
async function paneOnStart($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) {
  mock.clock(on, { now: 1_800_000_000_000 })
  mock.env(on, { HOME: '/h' })
  const calls: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', () => ({ deny: 'missing' }))
  on('fs.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    calls.push(`open ${e.id}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    calls.push(`close ${e.id}`)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return calls
}

test('the pane opens by itself in the desktop app by default', async ($, on) => {
  expect(await paneOnStart($, on)).toEqual(['open crab-sessions'])
})

test('with the pane turned off it closes instead, and /crab still opens it', { options: { showPane: false } }, async ($, on) => {
  const calls = await paneOnStart($, on)
  expect(calls).toEqual(['close crab-sessions'])
  await $.command.run({ command: 'crab' })
  expect(calls).toEqual(['close crab-sessions', 'open crab-sessions'])
})

// A command the app runs (an archive, by default) queued for another session (OTHER), seen by this
// one (ME); `answer` stands for the app.
const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const INBOX = '/h/.claude/crab-sessions/inbox'

async function archiveSetup(
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  answer: (call: { tool: string; args: Record<string, unknown> }) => unknown,
  cmd: Record<string, unknown> = { id: 'c9', action: 'archive', hostId: 'local_other' },
) {
  const T = 1_800_000_000_000
  const clock = mock.clock(on, { now: T })
  mock.env(on, { HOME: '/h' })
  const files: Record<string, string> = {
    [`${INBOX}/${OTHER}.json`]: JSON.stringify({ at: T, ...cmd }),
  }
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: ME }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'missing' }))
  on('fs.list', (_, e) => ({
    value: Object.keys(files)
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path.length + 1), kind: 'file' as const, size: 0, mtimeMs: T, isLink: false })),
  }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('mcp.call', (_, e) => {
    calls.push(e)
    return answer(e) as never
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  return { clock, files, calls }
}

test('any session archives the session the artifact asked for, by its app id, once', async ($, on) => {
  const { clock, files, calls } = await archiveSetup($, on, () => ({ value: { content: [{ type: 'text', text: 'Archived.' }], isError: false } }))
  await clock.advance(1500)
  await clock.advance(1500)
  expect(calls).toEqual([expect.objectContaining({ server: 'ccd_session_mgmt', tool: 'archive_session', args: expect.objectContaining({ session_id: 'local_other' }) })])
  expect(JSON.parse(files[`${INBOX}/${OTHER}.result.json`])).toEqual(expect.objectContaining({ id: 'c9', status: 'done', message: 'Archived.' }))
})

test('any session asks the app to rename an app session, by its app id', async ($, on) => {
  const { clock, files, calls } = await archiveSetup($, on, () => ({ value: { content: [{ type: 'text', text: 'Renamed.' }], isError: false } }), {
    id: 'r1', action: 'rename', title: 'Report clienti', hostId: 'local_other',
  })
  await clock.advance(1500)
  expect(calls).toEqual([expect.objectContaining({ server: 'ccd_session_mgmt', tool: 'set_session_title', args: { session_id: 'local_other', title: 'Report clienti' } })])
  expect(JSON.parse(files[`${INBOX}/${OTHER}.result.json`])).toEqual(expect.objectContaining({ id: 'r1', action: 'rename', status: 'done' }))
})

// A terminal session has no app id: the session itself renames, with its /rename.
test('a terminal session renames itself with /rename', async ($, on) => {
  const T = 1_800_000_000_000
  const clock = mock.clock(on, { now: T })
  mock.env(on, { HOME: '/h' })
  const files: Record<string, string> = {
    [`${INBOX}/s1.json`]: JSON.stringify({ id: 'r2', action: 'rename', title: 'Deploy staging', at: T }),
  }
  const runs: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'missing' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.run', (_, e) => {
    runs.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1500)
  expect(runs).toEqual(['/rename Deploy staging'])
  expect(JSON.parse(files[`${INBOX}/s1.result.json`])).toEqual(expect.objectContaining({ id: 'r2', status: 'done' }))
})

const LIVE = 'Session local_other ("X") was not archived: it still has live work (an agent run, a Remote Control client, a queued message or a background task).'
const reply = (text: string, isError = false) => ({ value: { content: [{ type: 'text', text }], isError } })

test('an archive the app refuses for a Remote Control client turns Remote Control off and asks again', async ($, on) => {
  let archives = 0
  const { clock, files, calls } = await archiveSetup($, on, ({ tool }) => {
    if (tool === 'archive_session') return ++archives === 1 ? reply(LIVE, true) : reply('Archived.')
    if (tool === 'get_session') return reply(JSON.stringify({ sessionId: 'local_other', remoteControlActive: true }))
    return reply('off')
  })
  await clock.advance(1500)
  expect(calls.map(c => c.tool)).toEqual(['archive_session', 'get_session', 'set_remote_control', 'archive_session'])
  expect(calls[2].args).toEqual({ session_id: 'local_other', enabled: false })
  expect(JSON.parse(files[`${INBOX}/${OTHER}.result.json`])).toEqual(expect.objectContaining({ id: 'c9', status: 'done' }))
})

test('an archive refused for other live work says so in Italian, Remote Control left alone', async ($, on) => {
  const { clock, files, calls } = await archiveSetup($, on, ({ tool }) =>
    tool === 'get_session' ? reply(JSON.stringify({ remoteControlActive: false })) : reply(LIVE, true),
  )
  await clock.advance(1500)
  expect(calls.map(c => c.tool)).toEqual(['archive_session', 'get_session'])
  expect(JSON.parse(files[`${INBOX}/${OTHER}.result.json`])).toEqual(expect.objectContaining({ status: 'error', message: expect.stringMatching(/^L’app non la archivia/) }))
})

test('a session the app does not answer gives the archive up after 10 s for another to take', async ($, on) => {
  const { clock, files, calls } = await archiveSetup($, on, () => new Promise(() => undefined))
  await clock.advance(1500)
  await clock.advance(10_000)
  await clock.advance(1500)
  expect(calls).toHaveLength(1)
  expect(JSON.parse(files[`${INBOX}/${OTHER}.result.json`])).toEqual(expect.objectContaining({ id: 'c9', status: 'running' }))
  expect(JSON.parse(files[`${INBOX}/${OTHER}.claim.json`])).toEqual({ cmdId: 'c9', by: ME, at: 0 })
})

test('the pane shows Fable\'s tokens this week beside the limits', async ($, on) => {
  const fable = { fresh: 2_400_000, cached: 31_000_000, replies: 128, since: Date.parse('2027-01-13T08:00:00.000Z'), at: 1 }
  on('state.get', () => ({ value: { value: { shape: 'view-4', value: { ...VIEW, fable } }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Fable · settimana/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2,4 M token/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /128 risposte · 31,0 M dalla cache/ })).toBeDefined()
  await ui.unmount()
})

test('Fable is counted once per reply, from the weekly reset, and counted again only when stale', async () => {
  const P = '/h/.claude/projects'
  const reply = (id: string, at: string, model: string, input: number, read = 0) =>
    JSON.stringify({ type: 'assistant', timestamp: at, message: { id, model, usage: { input_tokens: input, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: read } } })
  const files: Record<string, string> = {
    // the same reply written once per content block
    [`${P}/-a/s1.jsonl`]: [reply('m1', '2027-01-14T10:00:00Z', 'claude-fable-5-2', 100, 1000), reply('m1', '2027-01-14T10:00:00Z', 'claude-fable-5-2', 100, 1000), reply('m0', '2027-01-12T10:00:00Z', 'claude-fable-5-2', 9999), reply('o1', '2027-01-14T11:00:00Z', 'claude-opus-5-5', 5000)].join('\n'),
    // a fork copies m1 before its own reply
    [`${P}/-a/s2.jsonl`]: [reply('m1', '2027-01-14T10:00:00Z', 'claude-fable-5-2', 100, 1000), reply('m2', '2027-01-14T12:00:00Z', 'claude-fable-5-1', 200)].join('\n'),
    [`${P}/-a/s2/subagents/agent-x.jsonl`]: reply('m3', '2027-01-14T13:00:00Z', 'claude-fable-5-2', 300),
  }
  const mtimes: Record<string, number> = { [`${P}/-a/s1.jsonl`]: 5e12, [`${P}/-a/s2.jsonl`]: 5e12, [`${P}/-a/s2/subagents/agent-x.jsonl`]: 5e12 }
  const reads: string[] = []
  const io: Io = {
    list: async dir => {
      const names = new Set(Object.keys(files).filter(f => f.startsWith(`${dir}/`)).map(f => f.slice(dir.length + 1).split('/')[0]!))
      if (names.size === 0) throw new Error('missing')
      return [...names].map(name => ({ name, mtimeMs: mtimes[`${dir}/${name}`] ?? 0 }))
    },
    read: async path => {
      reads.push(path)
      if (!(path in files)) throw new Error('missing')
      return files[path]!
    },
    exists: async path => path in files,
    write: async (path, text) => void (files[path] = text),
  }
  const since = weekStart([{ kind: 'seven_day', percent: 5, resetsAt: '2027-01-20T08:00:00.000Z' }], 0)
  const now = Date.parse('2027-01-14T14:00:00Z')

  const week = await fableWeek(io, '/h', since, now)
  expect(week).toEqual({ fresh: 110 + 210 + 310, cached: 1000, replies: 3, since: Date.parse('2027-01-13T08:00:00.000Z'), at: now })

  // within the minute: the saved count, no transcript read
  reads.length = 0
  expect(await fableWeek(io, '/h', since, now + 30_000)).toEqual(week)
  expect(reads.filter(r => r.endsWith('.jsonl'))).toEqual([])

  // past it: only the transcript that changed is read again
  files[`${P}/-a/s1.jsonl`] += '\n' + reply('m4', '2027-01-14T15:00:00Z', 'claude-fable-5-2', 1000)
  mtimes[`${P}/-a/s1.jsonl`] = 6e12
  reads.length = 0
  const later = await fableWeek(io, '/h', since, now + 61_000)
  expect(later?.replies).toBe(4)
  expect(later?.fresh).toBe(630 + 1010)
  expect(reads.filter(r => r.endsWith('.jsonl'))).toEqual([`${P}/-a/s1.jsonl`])
})

test('Fable\'s window draws a bar with what is still available', async ($, on) => {
  const limits = [...VIEW.limits, { kind: 'seven_day_fable', percent: 34, resetsAt: '2027-01-20T08:00:00.000Z' }]
  const fable = { fresh: 2_400_000, cached: 0, replies: 128, since: 1, at: 1 }
  on('state.get', () => ({ value: { value: { shape: 'view-4', value: { ...VIEW, limits, fable } }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /34%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /66% ancora disponibile/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2,4 M token · 128 risposte/ })).toBeDefined()
  await ui.unmount()
})

test('a session in the app stamps Fable\'s weekly window from the usage card, once a minute', async ($, on) => {
  const card = { plan: { windows: [{ label: 'Weekly · all models', percentUsed: 12 }, { label: 'Weekly · Fable', percentUsed: 34, resetsAt: '2027-01-20T08:00:00.000Z' }] } }
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  mock.env(on, { HOME: '/h' })
  const files: Record<string, string> = {}
  const asked: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: ME }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'missing' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('mcp.call', (_, e) => {
    asked.push(e.tool)
    return { value: { content: [{ type: 'text', text: JSON.stringify(card) }], isError: false } } as never
  })
  // the app opens the pane by itself, and its refresh reads the card
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(100)
  expect(JSON.parse(files[`/h/.claude/crab-sessions/limits-${ME}.fable.json`]!)).toEqual({
    at: expect.any(Number),
    limits: [{ kind: 'seven_day_fable', percent: 34, resetsAt: '2027-01-20T08:00:00.000Z' }],
  })
  // refreshes every 5 s, the card at most once a minute
  await clock.advance(30_000)
  expect(asked.filter(t => t === 'get_usage')).toHaveLength(1)
  await clock.advance(31_000)
  expect(asked.filter(t => t === 'get_usage')).toHaveLength(2)
})

test('each window takes its newest stamp: a later reading without Fable keeps Fable\'s', async () => {
  const dir = '/h/.claude/crab-sessions'
  const files: Record<string, string> = {
    // listed newest first: the order of the listing decides nothing
    [`${dir}/limits-b.json`]: JSON.stringify({ at: 3, limits: [{ kind: 'five_hour', percent: 11 }, { kind: 'seven_day', percent: 21 }] }),
    [`${dir}/limits-a.fable.json`]: JSON.stringify({ at: 2, limits: [{ kind: 'seven_day_fable', percent: 34 }] }),
    [`${dir}/limits-a.json`]: JSON.stringify({ at: 1, limits: [{ kind: 'five_hour', percent: 10 }, { kind: 'seven_day', percent: 20 }] }),
  }
  const io: Io = {
    list: async () => Object.keys(files).map(f => ({ name: f.slice(dir.length + 1), mtimeMs: 0 })),
    read: async path => files[path]!,
    exists: async () => true,
  }
  const limits = await stampedLimits(io, '/h')
  expect(limits.find(l => l.kind === 'five_hour')?.percent).toBe(11)
  expect(limits.find(l => l.kind === 'seven_day')?.percent).toBe(21)
  expect(limits.find(l => l.kind === 'seven_day_fable')?.percent).toBe(34)
})
