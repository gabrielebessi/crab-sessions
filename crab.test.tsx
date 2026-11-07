import { expect, test } from 'claude-code/testing'

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
  on('state.get', () => ({ value: { value: { shape: 'view-3', value: VIEW }, version: 1 } }))

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
  on('state.get', () => ({ value: { value: { shape: 'view-3', value: VIEW }, version: 1 } }))

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
  const store: Record<string, unknown> = { view: { shape: 'view-3', value: VIEW } }
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
