// Pixel-art crab: pure functions, no DOM/Node. Output = animated SVG string (SMIL).
// Crab local coordinates: 20 wide x 13 tall, drawn at (OX,OY) on a W x H canvas.
export const W = 26
export const H = 20
const OX = 3
const OY = 7

export const PAL                         = {
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

                             
                                  
                                                  
// back stands still behind the crab; fx is drawn on the body (it bobs with it)
// what a skin may need of the crab's current look: the claws' poses and the eyes
                                                     
                                                                                              
const isFront = (p      ) => p === 'type'
// working: busy · asking: a question · approval: a permission prompt · waiting: turn done, your move · idle: waiting for long
                                                                              
const cv0 = ()     => Array.from({ length: H }, () => Array(W).fill(null))
const put = (cv    , x        , y        , c        ) => {
  const X = x + OX
  const Y = y + OY
  if (X >= 0 && X < W && Y >= 0 && Y < H) cv[Y][X] = c
}
const putAbs = (cv    , x        , y        , c        ) => {
  if (x >= 0 && x < W && y >= 0 && y < H) cv[y][x] = c
}

const LEGS = [
  [[6, 8, 11, 13], [5, 8, 11, 14]],
  [[7, 9, 10, 12], [6, 9, 10, 13]],
]

const EYES                       = {
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
function claw(side           , pose      )       {
  const px       = []
  const add = (x        , y        , c        ) => px.push([side === 'L' ? x : 19 - x, y, c])
  const pinc = (x0        , y0        ) => PINCER.forEach((r, dy) => [...r].forEach((c, dx) => c !== '.' && add(x0 + dx, y0 + dy, c)))
  if (pose === 'down') { pinc(0, 5); add(4, 7, 'O'); add(4, 8, 'D') }
  else if (pose === 'mid') { pinc(0, 3); add(3, 7, 'O'); add(4, 8, 'D'); add(3, 6, 'O') }
  else if (pose === 'up') { pinc(0, 0); add(1, 4, 'O'); add(2, 5, 'O'); add(3, 6, 'O'); add(4, 7, 'O') }
  else if (pose === 'low') { pinc(0, 8); add(4, 9, 'O'); add(4, 10, 'D') }
  else if (pose === 'type') { pinc(2, 8); add(1, 8, 'O'); add(1, 7, 'O') }
  return px
}

// Rows of pixels to Px: a digit goes through `tint`, any other letter is a palette key, a dot is empty.
const art = (rows          , x0        , y0        , tint                        = c => c)       =>
  rows.flatMap((row, dy) =>
    [...row].flatMap((c, dx)       => (c === '.' ? [] : [[x0 + dx, y0 + dy, /\d/.test(c) ? tint(c) : c]])),
  )

const skins                       = {
  plain: { label: 'Base', fx: () => [] },
  code: {
    label: 'Sviluppo',
    fx: ()       => [],
    // a monitor around the crab: code scrolls above its head, it stands on the bottom edge
    back: (t        )       => {
      const px       = []
      for (let x = -1; x <= 21; x++) px.push([x, -6, 'g'], [x, 11, 'g'])
      for (let y = -5; y <= 10; y++) {
        px.push([-1, y, 'g'], [21, y, 'g'])
        for (let x = 0; x <= 20; x++) px.push([x, y, 'K'])
      }
      for (let i = 0; i < 6; i++) {
        if ((i + t) % 5 === 4) continue
        const len = 4 + ((i * 5 + t * 3) % 11)
        for (let x = 2; x < 2 + len && x <= 18; x++) px.push([x, -4 + i, 'G'])
      }
      return px
    },
  },
  game: {
    label: 'Gioco',
    fx: (t        )       => {
      const px       = []
      for (let x = 6; x <= 13; x++) px.push([x, 8, 'P'], [x, 9, 'P'])
      px.push([5, 9, 'P'], [14, 9, 'P'], [5, 10, 'p'], [14, 10, 'p'], [6, 7, 'P'], [13, 7, 'P'])
      px.push([9, 8, 'U'], [10, 8, 'U'], [7, 8, 'p'], [7, 9, 'p'], [6, 9, 'p'])
      px.push([12, 8, t % 2 ? 'R' : 'U'], [13, 9, 'U'], [12, 9, 'p'], [13, 8, 'p'])
      return px
    },
  },
  devops: {
    label: 'Infrastruttura',
    fx: ()       => {
      const px       = []
      for (let x = 8; x <= 11; x++) px.push([x, 0, 'Y'])
      for (let x = 7; x <= 12; x++) px.push([x, 1, 'Y'])
      for (let x = 5; x <= 14; x++) px.push([x, 2, 'y'])
      px.push([8, 0, 'W'], [9, 1, 'Y'])
      return px
    },
  },
  research: {
    label: 'Analisi',
    fx: (t        )       => {
      const px       = []
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
    fx: ()       => {
      const px       = []
      px.push([8, 8, 'W'], [11, 8, 'W'], [9, 8, 'R'], [10, 8, 'R'], [9, 9, 'R'], [10, 9, 'R'], [9, 10, 'R'], [10, 10, 'R'])
      return px
    },
  },
  design: {
    label: 'Design',
    fx: (t        )       => {
      const px       = []
      // red beret
      px.push([10, 0, 'R'])
      for (let x = 8; x <= 12; x++) px.push([x, 1, 'R'])
      for (let x = 6; x <= 13; x++) px.push([x, 2, 'R'])
      // a painter's palette at the lower right, the claw resting on it, its dabs changing colour
      const paint = ['R', 'Y', 'U', 'G']
      px.push(...art(['.ppppp.', 'pP1P2Pp', 'pP3P4Kp', '.ppppp.'], 15, 8, c => paint[(Number(c) - 1 + t) % 4] ))
      // a big brush in the left claw: the head sways, its tip changes colour, a drip falls beside it
      const tip = paint[t % 4] 
      const sway = t % 2
      px.push(
        ...art(['1111', 'PPPP', 'PPPP'], -sway, -1, () => tip),
        ...art(['.BB.', '.NN.', '.NN.', '.NN.'], 0, 2),
        [-1, 2 + (t % 4), paint[(t + 1) % 4] ],
      )
      return px
    },
  },
  app: {
    label: 'App',
    fx: (t        )       => {
      const icons = ['W', 'Y', 'R', 'G']
      // a phone on the left claw: blue screen, app icons changing colour
      return art(['ggggg', 'g1U2g', 'gUUUg', 'g3U4g', 'gUUUg', 'ggBgg'], -1, -6, c => icons[(Number(c) - 1 + t) % 4] )
    },
  },
  debug: {
    label: 'Debugging',
    fx: (t        , look      )       => {
      const px       = []
      // a dark hood around the face, drawstrings on the hoodie, eyes glowing green
      for (let x = 8; x <= 11; x++) px.push([x, 1, 'K'])
      for (let x = 6; x <= 13; x++) px.push([x, 2, 'K'])
      for (let x = 5; x <= 14; x++) px.push([x, 3, 'K'])
      for (let y = 4; y <= 9; y++) px.push([5, y, 'K'], [6, y, 'K'], [13, y, 'K'], [14, y, 'K'])
      for (let y = 7; y <= 9; y++) for (let x = 7; x <= 12; x++) px.push([x, y, 'K'])
      px.push([8, 7, 'W'], [8, 8, 'W'], [11, 7, 'W'], [11, 8, 'W'])
      EYES[look.eyes]?.forEach(([x, y]) => px.push([x, y, 'G']))
      // code raining beside it
      for (let i = 0; i < 3; i++) px.push([15 + i * 2, -5 + ((t + i * 2) % 5), 'G'])
      return px
    },
  },
  video: {
    label: 'Video',
    fx: (t        )       => {
      // a movie camera at the left, centred on the body and held from below (inside the visible area): reels turning, REC light blinking
      const reels = t % 2 ? '.KB.KB' : '.BK.BK'
      return art(['.BB.BB', reels, 'KKgggg', t % 2 ? 'CKgggK' : 'CKgggR', 'KKgggg'], -1, 3)
    },
  },
}
export const SKINS                         = Object.fromEntries(Object.entries(skins).map(([k, v]) => [k, v.label]))

// Which skin a task gets, from its title and working folder.
export function pickSkin(title = '', cwd = '')         {
  const s = `${title} ${cwd}`.toLowerCase()
  const has = (re        ) => re.test(s)
  if (has(/bug|debug|errore|crash|stacktrace|\bfix|diagnos/)) return 'debug'
  if (has(/video|remotion|ffmpeg|\bclip|render|animazion|youtube|\breel/)) return 'video'
  if (has(/design|figma|\bui\b|\bux\b|mockup|grafica|\blogo|branding/)) return 'design'
  if (has(/\bapp\b|react.?native|\bios\b|android|\bexpo\b|simulator|mobile|swift|flutter/)) return 'app'
  if (has(/ps5|game|gioco|unity|three|rts|remote-play/)) return 'game'
  if (has(/server|aws|terraform|docker|modem|rete|deploy|infra|devops|moodle|latenza|forge/)) return 'devops'
  if (has(/timesheet|report|document|present|pdf|word|email|cliente|fattur|giornalett|news/)) return 'docs'
  if (has(/analisi|audit|ricerca|seo|skill|controll|review|security|sicurezz|capire/)) return 'research'
  if (has(/laravel|react|gestionale|api|frontend|code|amedea|dft|osa|facility|plugin|mod\b|mascotte/)) return 'code'
  return 'plain'
}

const GLYPHS                           = {
  '?': ['.QQ.', 'Q..Q', '...Q', '..Q.', '.Q..', '....', '.Q..'],
  z: ['SSS', '..S', '.S.', 'SSS'],
  Z: ['SSSS', '...S', '..S.', '.S..', 'SSSS'],
  dot: ['QQ', 'QQ'],
  lock: ['.yy.', 'y..y', 'QQQQ', 'QyyQ', 'QQQQ'],
  unlock: ['.yy.', 'y...', 'QQQQ', 'QyyQ', 'QQQQ'],
  check: ['....G', '...GG', 'G.GG.', 'GGG..', '.G...'],
}
function glyph(cv    , name        , x        , y        ) {
  GLYPHS[name].forEach((row, dy) => [...row].forEach((c, dx) => c !== '.' && putAbs(cv, x + dx, y + dy, c)))
}

                                                                                                                                              
function frame({ skin, t = 0, lift = 0, left = 'down', right = 'down', eyes = 'open', leg = 0, extra }           )     {
  const cv = cv0()
  const sk = skins[skin] ?? skins.plain
  sk.back?.(t).forEach(([x, y, c]) => put(cv, x, y, c))
  BODY_ROWS.forEach((row, y) => [...row].forEach((c, x) => c !== '.' && put(cv, x, y - lift, c)))
  LEGS[leg].forEach((xs, i) => xs.forEach((x) => put(cv, x, 10 + i, 'D')))
  const typing = isFront(left) || isFront(right)
  ;[...claw('L', left), ...claw('R', right)].forEach(([x, y, c]) => put(cv, x, y - (typing ? 0 : lift), c))
  EYES[eyes].forEach(([x, y, c]) => put(cv, x, y - lift, c))
  sk.fx(t, { left, right, eyes }).forEach(([x, y, c]) => put(cv, x, y - lift, c))
  // typing claws drawn in front of the pad
  if (isFront(left)) claw('L', left).forEach(([x, y, c]) => put(cv, x, y, c))
  if (isFront(right)) claw('R', right).forEach(([x, y, c]) => put(cv, x, y, c))
  extra?.(cv)
  return cv
}

// skins with a prop on the left claw: that claw keeps its pose in every state, and the right one does the gestures
const HELD                                               = {
  design: { left: 'down', right: 'down' },
  app: { left: 'up' },
  video: { left: 'low' },
}

export function framesFor(skin        , state           ) {
  const held = HELD[skin]
  const hold = (o                         )                          =>
    !held
      ? o
      : {
          ...o,
          left: held.left,
          right: held.right ?? (o.left && o.left !== 'down' && o.left !== held.left ? o.left : o.right),
        }
  const F = (ms        , o                         ) => ({ ms, cv: frame({ skin, ...hold(o) }) })
  if (state === 'working') {
    const dotRow = (n        ) => (cv    ) => { for (let i = 0; i < n; i++) glyph(cv, 'dot', 20 + i * 3, 4) }
    if (held) {
      return [
        F(240, { t: 0, left: held.left, right: 'down', leg: 0, extra: dotRow(1) }),
        F(240, { t: 1, left: held.left, right: 'mid', leg: 1, lift: 1, extra: dotRow(2) }),
        F(240, { t: 2, left: held.left, right: 'down', leg: 0, extra: dotRow(3) }),
        F(240, { t: 3, left: held.left, right: 'mid', leg: 1, lift: 1, extra: dotRow(2) }),
      ]
    }
    const a       = skin === 'game' ? 'type' : 'up'
    return [
      F(240, { t: 0, left: a, right: 'down', leg: 0, extra: dotRow(1) }),
      F(240, { t: 1, left: 'down', right: a, leg: 1, lift: 1, extra: dotRow(2) }),
      F(240, { t: 2, left: a, right: 'down', leg: 0, extra: dotRow(3) }),
      F(240, { t: 3, left: 'down', right: a, leg: 1, lift: 1, extra: dotRow(2) }),
    ]
  }
  if (state === 'asking') {
    return [
      F(320, { t: 0, left: 'down', right: 'up', eyes: 'wide', extra: (cv    ) => glyph(cv, '?', 20, 1) }),
      F(320, { t: 1, left: 'down', right: 'mid', eyes: 'wide', lift: 1, extra: (cv    ) => glyph(cv, '?', 20, 2) }),
    ]
  }
  if (state === 'approval') {
    // both claws up, a padlock that clicks open: "let me through"
    const lock = (name        , y        ) => (cv    ) => glyph(cv, name, 20, y)
    return [
      F(300, { t: 0, left: 'up', right: 'up', eyes: 'wide', extra: lock('lock', 1) }),
      F(300, { t: 1, left: 'up', right: 'up', eyes: 'wide', lift: 1, extra: lock('lock', 2) }),
      F(300, { t: 2, left: 'up', right: 'up', eyes: 'wide', extra: lock('lock', 1) }),
      F(450, { t: 3, left: 'mid', right: 'up', eyes: 'wide', lift: 1, extra: lock('unlock', 2) }),
    ]
  }
  if (state === 'waiting') {
    // turn finished: a green tick, one claw waving, a blink now and then
    const tick = (cv    ) => glyph(cv, 'check', 20, 1)
    return [
      F(380, { t: 0, left: 'up', right: 'down', leg: 0, extra: tick }),
      F(380, { t: 1, left: 'mid', right: 'down', leg: 1, extra: tick }),
      F(380, { t: 2, left: 'up', right: 'down', leg: 0, extra: tick }),
      F(160, { t: 3, left: 'mid', right: 'down', leg: 1, eyes: 'blink', extra: tick }),
    ]
  }
  return [
    F(1000, { t: 0, eyes: 'sleep', extra: (cv    ) => glyph(cv, 'z', 20, 5) }),
    F(1000, { t: 1, eyes: 'sleep', leg: 1, extra: (cv    ) => glyph(cv, 'Z', 20, 1) }),
  ]
}

function rects(cv    )         {
  const out           = []
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

export function crabSvg(skin        , state           , px = 4)         {
  const frames = framesFor(skin, state)
  const total = frames.reduce((s, f) => s + f.ms, 0)
  let acc = 0
  const groups = frames.map((f) => {
    const s = acc / total
    acc += f.ms
    const e = acc / total
    let kt        
    let vals        
    if (s === 0) { kt = `0;${e.toFixed(4)};1`; vals = 'visible;hidden;hidden' }
    else if (e >= 1) { kt = `0;${s.toFixed(4)};1`; vals = 'hidden;visible;visible' }
    else { kt = `0;${s.toFixed(4)};${e.toFixed(4)};1`; vals = 'hidden;visible;hidden;hidden' }
    return `<g visibility="hidden"><animate attributeName="visibility" calcMode="discrete" dur="${total}ms" repeatCount="indefinite" keyTimes="${kt}" values="${vals}"/>${rects(f.cv)}</g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 1 23 18" width="${23 * px}" height="${18 * px}" shape-rendering="crispEdges">${groups.join('')}</svg>`
}
