// Pixel-art crab: pure functions, no DOM/Node. Output = animated SVG string (SMIL).
// Crab local coordinates: 20 wide x 13 tall, drawn at (OX,OY) on a W x H canvas.
export const W = 26
export const H = 20
const OX = 3
const OY = 7

export const PAL: Record<string, string> = {
  O: '#D97757', // body
  L: '#F0A184', // body light
  D: '#A94E34', // body dark
  E: '#2A1A14', // eye
  W: '#FFFFFF',
  Y: '#F5C518', // hat
  y: '#C99A0A',
  K: '#26334D', // screen
  G: '#5BE08A', // code green
  g: '#8F98AB', // grey
  B: '#C9CEDA', // light grey
  P: '#EDEDF2', // pad white
  p: '#9096A8', // pad shade
  U: '#3D8BFF', // blue
  R: '#E5484D', // red
  C: '#BFEFFF', // lens
  Q: '#FFC933', // bubble yellow
  S: '#8892A6', // zzz
  N: '#4A3228',
}

const BODY_ROWS = [
  '',
  '',
  '',
  '.......OOOOOO.......',
  '.....OOOOOOOOOO.....',
  '.....OOOOOOOOOO.....',
  '.....OOOOOOOOOO.....',
  '.....OLOOOOOOLO.....',
  '.....OOOOOOOOOO.....',
  '......DDDDDDDD......',
]

type Cv = (string | null)[][]
type Px = [number, number, string]
type Pose = 'down' | 'mid' | 'up' | 'type'
type Skin = { label: string; fx: (t: number) => Px[] }
export type CrabState = 'working' | 'idle' | 'asking'
const cv0 = (): Cv => Array.from({ length: H }, () => Array(W).fill(null))
const put = (cv: Cv, x: number, y: number, c: string) => {
  const X = x + OX
  const Y = y + OY
  if (X >= 0 && X < W && Y >= 0 && Y < H) cv[Y][X] = c
}
const putAbs = (cv: Cv, x: number, y: number, c: string) => {
  if (x >= 0 && x < W && y >= 0 && y < H) cv[y][x] = c
}

const LEGS = [
  [[6, 8, 11, 13], [5, 8, 11, 14]],
  [[7, 9, 10, 12], [6, 9, 10, 13]],
]

const EYES: Record<string, Px[]> = {
  open: [[7, 5, 'W'], [8, 5, 'E'], [7, 6, 'E'], [8, 6, 'E'], [11, 5, 'W'], [12, 5, 'E'], [11, 6, 'E'], [12, 6, 'E']],
  wide: [
    [7, 4, 'W'], [8, 4, 'W'], [7, 5, 'E'], [8, 5, 'E'], [7, 6, 'E'], [8, 6, 'E'],
    [11, 4, 'W'], [12, 4, 'W'], [11, 5, 'E'], [12, 5, 'E'], [11, 6, 'E'], [12, 6, 'E'],
  ],
  blink: [[7, 6, 'E'], [8, 6, 'E'], [11, 6, 'E'], [12, 6, 'E']],
  sleep: [[7, 6, 'E'], [8, 6, 'E'], [11, 6, 'E'], [12, 6, 'E'], [7, 5, 'D'], [8, 5, 'D'], [11, 5, 'D'], [12, 5, 'D']],
}

// pincer 4x4 with a notch, left side orientation; mirrored for the right.
const PINCER = ['O..O', 'OLOO', 'OOOD', '.DD.']
function claw(side: 'L' | 'R', pose: Pose): Px[] {
  const px: Px[] = []
  const add = (x: number, y: number, c: string) => px.push([side === 'L' ? x : 19 - x, y, c])
  const pinc = (x0: number, y0: number) => PINCER.forEach((r, dy) => [...r].forEach((c, dx) => c !== '.' && add(x0 + dx, y0 + dy, c)))
  if (pose === 'down') { pinc(0, 5); add(4, 7, 'O'); add(4, 8, 'D') }
  else if (pose === 'mid') { pinc(0, 3); add(3, 7, 'O'); add(4, 8, 'D'); add(3, 6, 'O') }
  else if (pose === 'up') { pinc(0, 0); add(1, 4, 'O'); add(2, 5, 'O'); add(3, 6, 'O'); add(4, 7, 'O') }
  else if (pose === 'type') { pinc(2, 8); add(1, 8, 'O'); add(1, 7, 'O') }
  return px
}

const skins: Record<string, Skin> = {
  plain: { label: 'Base', fx: () => [] },
  code: {
    label: 'Sviluppo',
    fx: (t: number): Px[] => {
      const px: Px[] = []
      for (let x = 6; x <= 13; x++) px.push([x, 7, 'K'], [x, 8, 'K'])
      ;[[7, 7], [8, 7], [10, 8], [11, 8], [7, 8], [9, 7], [12, 7]].forEach(([x, y], i) => {
        if ((i + t) % 3 !== 0) px.push([x, y, 'G'])
      })
      for (let x = 5; x <= 14; x++) px.push([x, 9, 'B'])
      return px
    },
  },
  game: {
    label: 'Gioco',
    fx: (t: number): Px[] => {
      const px: Px[] = []
      for (let x = 6; x <= 13; x++) px.push([x, 8, 'P'], [x, 9, 'P'])
      px.push([5, 9, 'P'], [14, 9, 'P'], [5, 10, 'p'], [14, 10, 'p'], [6, 7, 'P'], [13, 7, 'P'])
      px.push([9, 8, 'U'], [10, 8, 'U'], [7, 8, 'p'], [7, 9, 'p'], [6, 9, 'p'])
      px.push([12, 8, t % 2 ? 'R' : 'U'], [13, 9, 'U'], [12, 9, 'p'], [13, 8, 'p'])
      return px
    },
  },
  devops: {
    label: 'Infrastruttura',
    fx: (): Px[] => {
      const px: Px[] = []
      for (let x = 8; x <= 11; x++) px.push([x, 0, 'Y'])
      for (let x = 7; x <= 12; x++) px.push([x, 1, 'Y'])
      for (let x = 5; x <= 14; x++) px.push([x, 2, 'y'])
      px.push([8, 0, 'W'], [9, 1, 'Y'])
      return px
    },
  },
  research: {
    label: 'Analisi',
    fx: (t: number): Px[] => {
      const px: Px[] = []
      // monocle around the right eye + chain
      ;[[11, 4], [12, 4], [13, 5], [13, 6], [10, 5], [10, 6], [11, 7], [12, 7]].forEach(([x, y]) => px.push([x, y, 'g']))
      px.push([13, 4, 'g'], [10, 4, 'g'], [10, 7, 'g'], [13, 7, 'g'])
      if (t % 2) px.push([13, 4, 'W'])
      px.push([13, 8, 'N'], [14, 9, 'N'])
      return px
    },
  },
  docs: {
    label: 'Documenti',
    fx: (): Px[] => {
      const px: Px[] = []
      px.push([8, 8, 'W'], [11, 8, 'W'], [9, 8, 'R'], [10, 8, 'R'], [9, 9, 'R'], [10, 9, 'R'], [9, 10, 'R'], [10, 10, 'R'])
      return px
    },
  },
}
export const SKINS: Record<string, string> = Object.fromEntries(Object.entries(skins).map(([k, v]) => [k, v.label]))

// Which skin a task gets, from its title and working folder.
export function pickSkin(title = '', cwd = ''): string {
  const s = `${title} ${cwd}`.toLowerCase()
  const has = (re: RegExp) => re.test(s)
  if (has(/ps5|game|gioco|unity|three|rts|remote-play/)) return 'game'
  if (has(/server|aws|terraform|docker|modem|rete|deploy|infra|devops|moodle|latenza|forge/)) return 'devops'
  if (has(/timesheet|report|document|present|pdf|word|email|cliente|fattur|giornalett|news/)) return 'docs'
  if (has(/analisi|audit|ricerca|seo|skill|controll|review|security|sicurezz|capire/)) return 'research'
  if (has(/laravel|react|gestionale|api|frontend|code|amedea|dft|osa|facility|plugin|mod\b|mascotte/)) return 'code'
  return 'plain'
}

const GLYPHS: Record<string, string[]> = {
  '?': ['.QQ.', 'Q..Q', '...Q', '..Q.', '.Q..', '....', '.Q..'],
  z: ['SSS', '..S', '.S.', 'SSS'],
  Z: ['SSSS', '...S', '..S.', '.S..', 'SSSS'],
  dot: ['QQ', 'QQ'],
}
function glyph(cv: Cv, name: string, x: number, y: number) {
  GLYPHS[name].forEach((row, dy) => [...row].forEach((c, dx) => c !== '.' && putAbs(cv, x + dx, y + dy, c)))
}

type FrameOpts = { skin: string; t?: number; lift?: number; left?: Pose; right?: Pose; eyes?: string; leg?: number; extra?: (cv: Cv) => void }
function frame({ skin, t = 0, lift = 0, left = 'down', right = 'down', eyes = 'open', leg = 0, extra }: FrameOpts): Cv {
  const cv = cv0()
  const sk = skins[skin] ?? skins.plain
  BODY_ROWS.forEach((row, y) => [...row].forEach((c, x) => c !== '.' && put(cv, x, y - lift, c)))
  LEGS[leg].forEach((xs, i) => xs.forEach((x) => put(cv, x, 10 + i, 'D')))
  const typing = left === 'type' || right === 'type'
  ;[...claw('L', left), ...claw('R', right)].forEach(([x, y, c]) => put(cv, x, y - (typing ? 0 : lift), c))
  EYES[eyes].forEach(([x, y, c]) => put(cv, x, y - lift, c))
  sk.fx(t).forEach(([x, y, c]) => put(cv, x, y - lift, c))
  // typing claws drawn in front of the laptop / pad
  if (left === 'type') claw('L', 'type').forEach(([x, y, c]) => put(cv, x, y, c))
  if (right === 'type') claw('R', 'type').forEach(([x, y, c]) => put(cv, x, y, c))
  extra?.(cv)
  return cv
}

export function framesFor(skin: string, state: CrabState) {
  const F = (ms: number, o: Omit<FrameOpts, 'skin'>) => ({ ms, cv: frame({ skin, ...o }) })
  if (state === 'working') {
    const dotRow = (n: number) => (cv: Cv) => { for (let i = 0; i < n; i++) glyph(cv, 'dot', 20 + i * 3, 4) }
    const a: Pose = skin === 'code' || skin === 'game' ? 'type' : 'up'
    return [
      F(240, { t: 0, left: a, right: 'down', leg: 0, extra: dotRow(1) }),
      F(240, { t: 1, left: 'down', right: a, leg: 1, lift: 1, extra: dotRow(2) }),
      F(240, { t: 2, left: a, right: 'down', leg: 0, extra: dotRow(3) }),
      F(240, { t: 3, left: 'down', right: a, leg: 1, lift: 1, extra: dotRow(2) }),
    ]
  }
  if (state === 'asking') {
    return [
      F(320, { t: 0, left: 'down', right: 'up', eyes: 'wide', extra: (cv: Cv) => glyph(cv, '?', 20, 1) }),
      F(320, { t: 1, left: 'down', right: 'mid', eyes: 'wide', lift: 1, extra: (cv: Cv) => glyph(cv, '?', 20, 2) }),
    ]
  }
  return [
    F(1000, { t: 0, eyes: 'sleep', extra: (cv: Cv) => glyph(cv, 'z', 20, 5) }),
    F(1000, { t: 1, eyes: 'sleep', leg: 1, extra: (cv: Cv) => glyph(cv, 'Z', 20, 1) }),
  ]
}

function rects(cv: Cv): string {
  const out: string[] = []
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      const c = cv[y][x]
      if (!c) { x++; continue }
      let x2 = x
      while (x2 + 1 < W && cv[y][x2 + 1] === c) x2++
      out.push(`<rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1" fill="${PAL[c] ?? '#f0f'}"/>`)
      x = x2 + 1
    }
  }
  return out.join('')
}

export function crabSvg(skin: string, state: CrabState, px = 4): string {
  const frames = framesFor(skin, state)
  const total = frames.reduce((s, f) => s + f.ms, 0)
  let acc = 0
  const groups = frames.map((f) => {
    const s = acc / total
    acc += f.ms
    const e = acc / total
    let kt: string
    let vals: string
    if (s === 0) { kt = `0;${e.toFixed(4)};1`; vals = 'visible;hidden;hidden' }
    else if (e >= 1) { kt = `0;${s.toFixed(4)};1`; vals = 'hidden;visible;visible' }
    else { kt = `0;${s.toFixed(4)};${e.toFixed(4)};1`; vals = 'hidden;visible;hidden;hidden' }
    return `<g visibility="hidden"><animate attributeName="visibility" calcMode="discrete" dur="${total}ms" repeatCount="indefinite" keyTimes="${kt}" values="${vals}"/>${rects(f.cv)}</g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 1 23 18" width="${23 * px}" height="${18 * px}" shape-rendering="crispEdges">${groups.join('')}</svg>`
}
