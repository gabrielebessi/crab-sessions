// What a session changed in its repository, read with git: the working tree against HEAD
// (files, lines added and removed, one file's diff) and the commit graph with its lanes.
import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'

const MAX_FILES = 500
const MAX_DIFF_LINES = 4000
const MAX_UNTRACKED_BYTES = 1024 * 1024
const MAX_GRAPH_LANES = 16

function git(cwd: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '--no-optional-locks', ...args],
      { cwd, maxBuffer, timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    ),
  )
}

// ---------------------------------------------------------------- working tree

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export type FileChange = {
  path: string
  oldPath?: string
  status: FileStatus
  // null for a binary file
  added: number | null
  removed: number | null
  isStaged: boolean
}

export type GitState = {
  root: string
  branch: string | null
  head: string | null
  upstream?: string
  ahead: number
  behind: number
  files: FileChange[]
  isTruncated: boolean
  totals: { files: number; added: number; removed: number }
}

// Lines in a new file nobody added yet: null when binary or too big to read.
async function countLines(path: string): Promise<number | null> {
  const file = await open(path, 'r').catch(() => undefined)
  if (!file) return null
  try {
    const { size } = await file.stat()
    if (size > MAX_UNTRACKED_BYTES) return null
    const buf = Buffer.alloc(size)
    await file.read(buf, 0, size, 0)
    if (buf.includes(0)) return null
    if (size === 0) return 0
    let n = 0
    for (const byte of buf) if (byte === 10) n++
    return buf[size - 1] === 10 ? n : n + 1
  } finally {
    await file.close()
  }
}

export async function gitState(cwd: string): Promise<GitState | undefined> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => '')).trim()
  if (!root) return undefined

  const status = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  const state: GitState = { root, branch: null, head: null, ahead: 0, behind: 0, files: [], isTruncated: false, totals: { files: 0, added: 0, removed: 0 } }
  const byPath = new Map<string, FileChange>()
  const parts = status.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    if (entry.startsWith('# branch.oid ')) {
      const oid = entry.slice(13)
      state.head = oid === '(initial)' ? null : oid.slice(0, 7)
    } else if (entry.startsWith('# branch.head ')) {
      const head = entry.slice(14)
      state.branch = head === '(detached)' ? null : head
    } else if (entry.startsWith('# branch.upstream ')) {
      state.upstream = entry.slice(18)
    } else if (entry.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(entry)
      if (m) {
        state.ahead = Number(m[1])
        state.behind = Number(m[2])
      }
    } else if (entry.startsWith('1 ') || entry.startsWith('2 ')) {
      // 1 XY sub mH mI mW hH hI path · 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const fields = entry.split(' ')
      const xy = fields[1]
      const path = fields.slice(entry.startsWith('1 ') ? 8 : 9).join(' ')
      const change: FileChange = { path, status: 'modified', added: 0, removed: 0, isStaged: xy[0] !== '.' }
      if (entry.startsWith('2 ')) {
        change.oldPath = parts[++i]
        change.status = 'renamed'
      } else if (xy.includes('D')) change.status = 'deleted'
      else if (xy[0] === 'A') change.status = 'added'
      byPath.set(path, change)
    } else if (entry.startsWith('u ')) {
      const path = entry.split(' ').slice(10).join(' ')
      byPath.set(path, { path, status: 'conflict', added: 0, removed: 0, isStaged: false })
    } else if (entry.startsWith('? ')) {
      const path = entry.slice(2)
      byPath.set(path, { path, status: 'untracked', added: 0, removed: 0, isStaged: false })
    }
  }

  // lines added and removed against HEAD, staged and not alike
  if (state.head) {
    const numstat = await git(root, ['diff', 'HEAD', '--numstat', '-z', '-M']).catch(() => '')
    const nums = numstat.split('\0')
    for (let i = 0; i < nums.length; i++) {
      const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(nums[i])
      if (!m) continue
      // a rename: empty path, then the old path and the new one
      const path = m[3] === '' ? nums[(i += 2)] : m[3]
      const change = byPath.get(path)
      if (!change) continue
      change.added = m[1] === '-' ? null : Number(m[1])
      change.removed = m[2] === '-' ? null : Number(m[2])
    }
  }

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  state.isTruncated = files.length > MAX_FILES
  state.files = files.slice(0, MAX_FILES)
  for (const f of state.files) {
    if (f.status === 'untracked') f.added = await countLines(`${root}/${f.path}`)
  }
  state.totals = {
    files: files.length,
    added: state.files.reduce((n, f) => n + (f.added ?? 0), 0),
    removed: state.files.reduce((n, f) => n + (f.removed ?? 0), 0),
  }
  return state
}

// ---------------------------------------------------------------- one file's diff

export type DiffLine = { kind: 'add' | 'del' | 'ctx'; old?: number; new?: number; text: string }
export type Hunk = { header: string; lines: DiffLine[] }
export type FileDiff = { path: string; oldPath?: string; status: FileStatus; isBinary: boolean; isTruncated: boolean; hunks: Hunk[] }

function parseDiff(text: string): { hunks: Hunk[]; isBinary: boolean; isTruncated: boolean } {
  const hunks: Hunk[] = []
  let isBinary = false
  let count = 0
  let oldNo = 0
  let newNo = 0
  let hunk: Hunk | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith('Binary files ')) isBinary = true
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
    if (m) {
      oldNo = Number(m[1])
      newNo = Number(m[2])
      hunk = { header: line, lines: [] }
      hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    if (count >= MAX_DIFF_LINES) return { hunks, isBinary, isTruncated: true }
    if (line.startsWith('+')) hunk.lines.push({ kind: 'add', new: newNo++, text: line.slice(1) })
    else if (line.startsWith('-')) hunk.lines.push({ kind: 'del', old: oldNo++, text: line.slice(1) })
    else if (line.startsWith(' ')) hunk.lines.push({ kind: 'ctx', old: oldNo++, new: newNo++, text: line.slice(1) })
    else continue
    count++
  }
  return { hunks, isBinary, isTruncated: false }
}

export async function fileDiff(state: GitState, path: string): Promise<FileDiff> {
  const change = state.files.find(f => f.path === path)
  if (!change) throw new Error('Il file non risulta più modificato.')
  const base = { path, oldPath: change.oldPath, status: change.status }

  if (change.status === 'untracked') {
    const lines = await countLines(`${state.root}/${path}`)
    if (lines === null) return { ...base, isBinary: true, isTruncated: false, hunks: [] }
    const file = await open(`${state.root}/${path}`, 'r')
    try {
      const text = (await file.readFile('utf8')).replace(/\n$/, '')
      const all = text === '' ? [] : text.split('\n')
      const shown = all.slice(0, MAX_DIFF_LINES)
      return {
        ...base,
        isBinary: false,
        isTruncated: all.length > shown.length,
        hunks: [{ header: `@@ -0,0 +1,${all.length} @@`, lines: shown.map((t, i) => ({ kind: 'add', new: i + 1, text: t })) }],
      }
    } finally {
      await file.close()
    }
  }

  const paths = change.oldPath ? [change.oldPath, path] : [path]
  const text = state.head
    ? await git(state.root, ['diff', 'HEAD', '-M', '--no-color', '--no-ext-diff', '-U3', '--', ...paths])
    : await git(state.root, ['diff', '--cached', '--no-color', '--no-ext-diff', '-U3', '--', ...paths])
  return { ...base, ...parseDiff(text) }
}

// ---------------------------------------------------------------- commit graph

// A row's lines, in lane units: y 0 is the row's top, 0.5 its commit, 1 its bottom.
export type Segment = { x1: number; y1: number; x2: number; y2: number; lane: number }

export type GraphRow = {
  sha: string
  short: string
  refs: string[]
  isHead: boolean
  subject: string
  author: string
  time: number
  col: number
  segments: Segment[]
}

export type Graph = { head: string | null; lanes: number; rows: GraphRow[] }

export async function gitGraph(cwd: string, limit: number): Promise<Graph> {
  const out = await git(cwd, ['log', '--all', '--date-order', `-n${limit}`, '--format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%ct%x1e'])
  const head = (await git(cwd, ['rev-parse', 'HEAD']).catch(() => '')).trim() || null
  const commits = out
    .split('\x1e')
    .map(s => s.replace(/^\n/, ''))
    .filter(Boolean)
    .map(s => {
      const [sha, parents, refs, subject, author, time] = s.split('\x1f')
      return {
        sha,
        parents: parents ? parents.split(' ') : [],
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        subject,
        author,
        time: Number(time) * 1000,
      }
    })

  // each lane waits for the commit it leads to
  const lanes: (string | null)[] = []
  const free = () => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.push(null) - 1 : i
  }
  const rows: GraphRow[] = []
  let widest = 1
  for (const c of commits) {
    let col = lanes.indexOf(c.sha)
    const isNewLane = col === -1
    if (isNewLane) col = free()
    const segments: Segment[] = []
    lanes.forEach((sha, j) => {
      if (sha === null) return
      if (j === col) {
        if (!isNewLane) segments.push({ x1: j, y1: 0, x2: col, y2: 0.5, lane: j })
      } else if (sha === c.sha) {
        // a second branch reaching the same commit ends here
        segments.push({ x1: j, y1: 0, x2: col, y2: 0.5, lane: j })
        lanes[j] = null
      } else {
        segments.push({ x1: j, y1: 0, x2: j, y2: 1, lane: j })
      }
    })
    lanes[col] = c.parents[0] ?? null
    if (c.parents[0]) segments.push({ x1: col, y1: 0.5, x2: col, y2: 1, lane: col })
    for (const p of c.parents.slice(1)) {
      let k = lanes.indexOf(p)
      if (k === -1) {
        k = free()
        lanes[k] = p
      }
      segments.push({ x1: col, y1: 0.5, x2: k, y2: 1, lane: k })
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    widest = Math.max(widest, lanes.length, col + 1)
    rows.push({
      sha: c.sha,
      short: c.sha.slice(0, 7),
      refs: c.refs,
      isHead: c.sha === head,
      subject: c.subject,
      author: c.author,
      time: c.time,
      col,
      segments: segments.filter(s => s.x1 < MAX_GRAPH_LANES && s.x2 < MAX_GRAPH_LANES),
    })
  }
  return { head: head?.slice(0, 7) ?? null, lanes: Math.min(widest, MAX_GRAPH_LANES), rows }
}
