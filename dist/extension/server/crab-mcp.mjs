// Local MCP server behind the crab-sessions artifact. The Claude desktop app runs it (it is
// listed in claude_desktop_config.json) and hands it the page's `host:crab-sessions` calls:
// the sessions live, an agent's detail, opening a session, and the commands the mod runs.
//
// Node 22.18+ runs this TypeScript file as it is (type stripping): no build, no dependencies.
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'

import {
  agentSkin,
  collectSessions,
  commandFile,
  COMMAND_TTL_MS,
  crabDir,
  hiddenFile,
  crabState,
  inboxDir,
  resultFile,
  stampedLimits,
  transcriptDir,
} from '../core/sessions.mjs'
                                                                                    
import { crabSvg, pickSkin } from '../hooks/sprites.mjs'
import { fileDiff, gitGraph, gitState } from './git.mjs'
                                        
                                                                      

const VERSION = '0.3.0'
const HOME = homedir()
const LOG = `${crabDir(HOME)}/mcp.log`
const LOG_LINES = 400

const WATCH_TIMEOUT_MS = 40_000
const WATCH_TICK_MS = 1000
const SNAPSHOT_TTL_MS = 800
const AGENTS = { windowMs: 3 * 60 * 60 * 1000, max: 30 }
// a command's answer stays on the card this long
const RESULT_SHOWN_MS = 90_000
// the open session's git status is read again at most this often
const GIT_TTL_MS = 2000
const DETAIL_STEPS = 80
const GRAPH_COMMITS = 150

const io     = {
  list: async dir => {
    const names = await readdir(dir)
    return Promise.all(
      names.map(async name => ({ name, mtimeMs: (await stat(`${dir}/${name}`).catch(() => undefined))?.mtimeMs ?? 0 })),
    )
  },
  read: path => readFile(path, 'utf8'),
  exists: path => access(path).then(
    () => true,
    () => false,
  ),
}

// ---------------------------------------------------------------- log

let logBuffer                      
async function log(line        ) {
  try {
    logBuffer ??= (await readFile(LOG, 'utf8').catch(() => '')).split('\n').filter(Boolean)
    logBuffer.push(`${new Date().toISOString()} ${line}`)
    logBuffer = logBuffer.slice(-LOG_LINES)
    await writeFile(LOG, logBuffer.join('\n') + '\n')
  } catch {
    // the log must never break a call
  }
}

// ---------------------------------------------------------------- transcripts

                                                                                        

const clip = (text        , max        ) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const oneLine = (text        ) => text.replace(/\s+/g, ' ').trim()

// What a tool call is about, in one short line.
function toolSummary(input         )         {
  if (!input || typeof input !== 'object') return ''
  const x = input                           
  const str = (k        ) => (typeof x[k] === 'string' ? (x[k]          ) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  const short = path ? path.split('/').slice(-2).join('/') : undefined
  const pick =
    str('description') ??
    short ??
    str('command') ??
    str('pattern') ??
    str('url') ??
    str('query') ??
    str('skill') ??
    str('subject') ??
    str('prompt') ??
    str('message')
  return clip(oneLine(pick ?? JSON.stringify(x)), 120)
}

             
               
                    
                  
                                                                                                             
 

function parseLines(text        , dropFirst         )         {
  const lines = text.split('\n')
  if (dropFirst) lines.shift()
  const out         = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line)        )
    } catch {
      // a line cut by the tail read, or one still being written
    }
  }
  return out
}

// What the person typed: system notes and command echoes start with a tag and are left out.
function promptText(line      )         {
  if (line.type !== 'user' || line.isMeta) return ''
  const content = line.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map(b => (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')
        : ''
  return text.trim().startsWith('<') ? '' : text.trim()
}

function stepsOf(lines        , { withPrompts = false, textMax = 280 } = {})         {
  const steps         = []
  for (const line of lines) {
    if (withPrompts) {
      const prompt = promptText(line)
      if (prompt) steps.push({ at: line.timestamp, kind: 'user', text: clip(oneLine(prompt), textMax) })
    }
    if (line.type !== 'assistant' || !Array.isArray(line.message?.content)) continue
    for (const block of line.message.content                                                                      ) {
      if (block.type === 'tool_use') {
        steps.push({ at: line.timestamp, kind: 'tool', name: block.name ?? 'tool', text: toolSummary(block.input) })
      } else if (block.type === 'text' && block.text?.trim()) {
        steps.push({ at: line.timestamp, kind: 'text', text: clip(oneLine(block.text), textMax) })
      }
    }
  }
  return steps
}

async function readTail(path        , bytes        )                                                {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    await file.read(buf, 0, buf.length, start)
    return { text: buf.toString('utf8'), isPartial: start > 0 }
  } finally {
    await file.close()
  }
}

const agentFile = (row            , agentId        ) =>
  `${transcriptDir(HOME, row.cwd ?? '', row.id)}/subagents/${agentId}.jsonl`

// The last thing a running agent did, for its line on the card.
async function lastStep(row            , agentId        )                            {
  try {
    const { text, isPartial } = await readTail(agentFile(row, agentId), 256 * 1024)
    return stepsOf(parseLines(text, isPartial)).at(-1)
  } catch {
    return undefined
  }
}

function firstPrompt(lines        )         {
  const content = lines.find(l => l.type === 'user')?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(b => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : ''))
      .join('\n')
  }
  return ''
}

async function agentDetail(row            , agentId        ) {
  const path = agentFile(row, agentId)
  const text = await readFile(path, 'utf8')
  const lines = parseLines(text, false)
  const meta = await readFile(path.replace(/\.jsonl$/, '.meta.json'), 'utf8')
    .then(t => JSON.parse(t)                           )
    .catch(() => ({})                           )

  // one assistant message is written as several lines that repeat its usage: count each id once
  const seen = new Set        ()
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let model                    
  for (const line of lines) {
    const m = line.message
    if (line.type !== 'assistant' || !m?.usage) continue
    model = m.model ?? model
    if (m.id && seen.has(m.id)) continue
    if (m.id) seen.add(m.id)
    usage.input += m.usage.input_tokens ?? 0
    usage.output += m.usage.output_tokens ?? 0
    usage.cacheRead += m.usage.cache_read_input_tokens ?? 0
    usage.cacheWrite += m.usage.cache_creation_input_tokens ?? 0
  }
  const stamps = lines.map(l => l.timestamp).filter((t)              => typeof t === 'string')

  return {
    sessionId: row.id,
    agentId,
    type: typeof meta.agentType === 'string' ? meta.agentType : 'agent',
    description: typeof meta.description === 'string' ? meta.description : '',
    model: model ?? (typeof meta.model === 'string' ? meta.model : undefined),
    finished: meta.finished === true,
    background: meta.requestShape === 'background',
    startedAt: stamps[0],
    lastAt: stamps.at(-1),
    prompt: clip(firstPrompt(lines), 4000),
    usage,
    steps: stepsOf(lines).slice(-60),
  }
}

// ---------------------------------------------------------------- one session in full

                                                                                             

const mainFile = (row            ) => `${transcriptDir(HOME, row.cwd ?? '', row.id)}.jsonl`

// The session's own steps, read incrementally: a seed from the transcript's last few MB (its
// tool results make lines huge), then only the bytes written since.
// `prompt` is the person's last request, kept when the steps after it push it out of the window
                                                                                
const stepLogs = new Map                 ()
const SEED_BYTES = 4 * 1024 * 1024

async function mainSteps(row            )                               {
  const path = mainFile(row)
  const file = await open(path, 'r').catch(() => undefined)
  if (!file) return undefined
  try {
    const { size } = await file.stat()
    let log = stepLogs.get(path)
    // a transcript that shrank was rewritten: start over
    if (!log || size < log.offset) log = { offset: Math.max(0, size - SEED_BYTES), steps: [], isSeed: true }
    if (size > log.offset) {
      const buf = Buffer.alloc(size - log.offset)
      await file.read(buf, 0, buf.length, log.offset)
      const end = buf.lastIndexOf(10)
      if (end >= 0) {
        const lines = parseLines(buf.subarray(0, end + 1).toString('utf8'), log.isSeed && log.offset > 0)
        const fresh = stepsOf(lines, { withPrompts: true, textMax: 600 })
        log.prompt = fresh.findLast(st => st.kind === 'user') ?? log.prompt
        log.steps = [...log.steps, ...fresh].slice(-DETAIL_STEPS)
        log.offset += end + 1
        log.isSeed = false
      }
    }
    stepLogs.set(path, log)
    return log
  } finally {
    await file.close()
  }
}

const gitCache = new Map                                                          ()

async function gitOf(row            , isFresh = false) {
  const now = Date.now()
  const hit = gitCache.get(row.id)
  if (hit && !isFresh && now - hit.at < GIT_TTL_MS) return hit
  let entry                                                  
  try {
    entry = { at: now, state: await gitState(row.cwd ?? HOME) }
  } catch (err) {
    entry = { at: now, error: err instanceof Error ? clip(err.message, 200) : String(err) }
  }
  gitCache.set(row.id, entry)
  return entry
}

async function detailOf(row            )                  {
  const g = await gitOf(row)
  const log = await mainSteps(row)
  return { id: row.id, steps: log?.steps ?? [], prompt: log?.prompt, git: g.state, gitError: g.error }
}

// ---------------------------------------------------------------- snapshot

                                                                                                                                 
                                                         
                                                                                                      
                                                        
                                                                                                   

async function actionOf(id        , now        )                                  {
  const cmd = await readFile(commandFile(HOME, id), 'utf8')
    .then(t => JSON.parse(t)           )
    .catch(() => undefined)
  if (!cmd) return undefined
  const res = await readFile(resultFile(HOME, id), 'utf8')
    .then(t => JSON.parse(t)                 )
    .catch(() => undefined)
  if (res?.id === cmd.id) {
    if (res.status !== 'running' && now - res.at > RESULT_SHOWN_MS) return undefined
    return { id: cmd.id, action: cmd.action, status: res.status, message: res.message, at: res.at }
  }
  if (now - cmd.at > COMMAND_TTL_MS + RESULT_SHOWN_MS) return undefined
  return { id: cmd.id, action: cmd.action, status: now - cmd.at > COMMAND_TTL_MS ? 'expired' : 'queued', at: cmd.at }
}

let cached                                            

async function snapshot()                    {
  const now = Date.now()
  if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.snap

  const sessions = await collectSessions(io, HOME, { now, agents: AGENTS, skinOf: pickSkin })
  const hiddenIds = await readHidden()
  const hidden           = sessions.filter(r => hiddenIds.includes(r.id)).map(r => ({ id: r.id, title: r.title, dir: r.dir }))
  const rows            = []
  for (const row of sessions) {
    if (hiddenIds.includes(row.id)) continue
    const agents              = []
    for (const a of row.agents) {
      agents.push({ ...a, crab: `${agentSkin(a.type)}/working`, last: a.running ? await lastStep(row, a.id) : undefined })
    }
    rows.push({ ...row, crab: `${row.skin}/${crabState(row.state, now - row.since)}`, agents, action: await actionOf(row.id, now) })
  }
  const limits = await stampedLimits(io, HOME)

  // the version changes with what the page shows, not with every file's mtime
  const stable = rows.map(r => ({ ...r, agents: r.agents.map(a => ({ ...a, at: 0 })) }))
  const version = createHash('sha1').update(JSON.stringify({ stable, hidden, limits })).digest('hex').slice(0, 16)
  const snap = { version, at: now, rows, hidden, limits }
  cached = { at: now, snap }
  return snap
}

// The crabs the page needs and does not have yet: each one is drawn once per page.
function spritesFor(snap          , have                   )                         {
  const keys = new Set        ()
  for (const row of snap.rows) {
    keys.add(row.crab)
    for (const a of row.agents) keys.add(a.crab)
  }
  const out                         = {}
  for (const key of keys) {
    if (have.includes(key)) continue
    const [skin, state] = key.split('/')
    out[key] = crabSvg(skin, state                                 )
  }
  return out
}

const sleep = (ms        ) => new Promise(resolve => setTimeout(resolve, ms))

// The board, and the open session in full when the page shows one: one version for both.
async function view(focus                    ) {
  const snap = await snapshot()
  const row = focus ? snap.rows.find(r => r.id === focus) : undefined
  if (!focus) return { ...snap, detail: undefined }
  const detail = row ? await detailOf(row) : undefined
  const version = createHash('sha1').update(`${snap.version}:${JSON.stringify(detail ?? null)}`).digest('hex').slice(0, 16)
  return { ...snap, version, detail }
}

async function watch(since                    , have                   , focus                    , cancelled               ) {
  const deadline = Date.now() + WATCH_TIMEOUT_MS
  let current = await view(focus)
  while (current.version === since && Date.now() < deadline && !cancelled()) {
    await sleep(WATCH_TICK_MS)
    current = await view(focus)
  }
  return { ...current, sprites: spritesFor(current, have) }
}

// ---------------------------------------------------------------- actions

async function findRow(sessionId         )                   {
  if (typeof sessionId !== 'string') throw new Error('sessionId mancante')
  const row = (await snapshot()).rows.find(r => r.id === sessionId)
  if (!row) throw new Error('Sessione non trovata: forse è stata chiusa.')
  return row
}

const run = (cmd        , args          ) =>
  new Promise      ((resolve, reject) =>
    execFile(cmd, args, { timeout: 15_000 }, err => (err ? reject(new Error(err.message)) : resolve())),
  )

async function openSession(row         ) {
  if (row.origin !== 'desktop' || !row.hostId || !/^local_[0-9a-f-]+$/.test(row.hostId)) {
    throw new Error('Questa sessione gira nel Terminale: aprila da lì.')
  }
  await run('open', [`claude://claude.ai/epitaxy/${row.hostId}`])
  return { opened: true }
}

const shellQuote = (s        ) => `'${s.replace(/'/g, `'\\''`)}'`
const appleQuote = (s        ) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// A terminal session has no app to fork it: a new Terminal window resumes a copy of it.
async function splitInTerminal(row         , prompt        ) {
  const line = `cd ${shellQuote(row.cwd ?? HOME)} && claude --resume ${shellQuote(row.id)} --fork-session ${shellQuote(prompt)}`
  await run('osascript', ['-e', `tell application "Terminal" to do script ${appleQuote(line)}`, '-e', 'tell application "Terminal" to activate'])
  return { started: true }
}

async function queue(row         , action               , prompt         ) {
  const cmd          = { id: randomUUID(), action, at: Date.now() }
  if (prompt) {
    cmd.prompt = prompt
    cmd.title = clip(oneLine(prompt), 58)
  }
  await mkdir(inboxDir(HOME), { recursive: true })
  await writeFile(commandFile(HOME, row.id), JSON.stringify(cmd))
  cached = undefined
  return { queued: cmd.id }
}

async function readHidden()                    {
  const ids = await readFile(hiddenFile(HOME), 'utf8')
    .then(t => JSON.parse(t)           )
    .catch(() => [])
  return Array.isArray(ids) ? ids.filter((x)              => typeof x === 'string') : []
}

// Hidden ids of sessions no longer open are dropped, so the file does not grow forever.
async function setHidden(id        , isHidden         ) {
  const live = new Set((await collectSessions(io, HOME, { now: Date.now(), agents: { windowMs: 0, max: 0 }, skinOf: () => '' })).map(r => r.id))
  const ids = new Set((await readHidden()).filter(x => live.has(x)))
  if (isHidden) ids.add(id)
  else ids.delete(id)
  await writeFile(hiddenFile(HOME), JSON.stringify([...ids]))
  cached = undefined
  return { hidden: isHidden }
}

async function sessionAction(args                         ) {
  const action = args.action
  // a hidden session is not on the board: it is looked up among the live ones directly
  if (action === 'unhide') {
    if (typeof args.sessionId !== 'string') throw new Error('sessionId mancante')
    return setHidden(args.sessionId, false)
  }
  const row = await findRow(args.sessionId)
  if (action === 'hide') return setHidden(row.id, true)
  // the app archives its own sessions; the mod inside the session asks it to
  if (action === 'archive') {
    if (row.origin !== 'desktop') throw new Error('Le sessioni del Terminale non si archiviano: nascondila.')
    return queue(row, 'archive')
  }
  if (action === 'split') {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    if (!prompt) throw new Error('Scrivi cosa deve fare la copia.')
    return row.origin === 'desktop' ? queue(row, 'split', prompt) : splitInTerminal(row, prompt)
  }
  if (action === 'compact' || action === 'clear') return queue(row, action)
  throw new Error(`Azione sconosciuta: ${String(action)}`)
}

// ---------------------------------------------------------------- MCP over stdio

             
              
                     
                                      
                                                                                            
 

const TOOLS         = [
  {
    name: 'sessions_watch',
    description:
      'Le sessioni di Claude Code aperte su questo Mac, con stato, agenti, token e limiti. Con `since` aspetta (fino a 40 s) che qualcosa cambi.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'La `version` già mostrata: risponde quando cambia.' },
        have: { type: 'array', items: { type: 'string' }, description: 'Le sprite già in pagina, chiave skin/stato.' },
        focus: { type: 'string', description: 'La sessione aperta in pagina: aggiunge i suoi passi e le modifiche git.' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'agent_detail',
    description: "Il dettaglio di un agente di una sessione: incarico, modello, token e i suoi ultimi passi.",
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, agentId: { type: 'string' } },
      required: ['sessionId', 'agentId'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'session_diff',
    description: 'Il diff di un file modificato nella cartella di una sessione, rispetto a HEAD.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, path: { type: 'string' } },
      required: ['sessionId', 'path'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'git_graph',
    description: 'Il grafo dei commit del repository di una sessione: tutti i rami, i più recenti.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'session_open',
    description: "Apre la sessione nell'app desktop Claude.",
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'session_action',
    description:
      'Compatta o pulisce la conversazione di una sessione, ne avvia una copia (split), la archivia nell\'app o la nasconde dalla pagina.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        action: { type: 'string', enum: ['compact', 'clear', 'split', 'archive', 'hide', 'unhide'] },
        prompt: { type: 'string', description: 'Per split: cosa deve fare la copia.' },
      },
      required: ['sessionId', 'action'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
]

                                                                                                      

const send = (msg         ) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const pending = new Map                                         ()

async function callTool(name        , args                         , cancelled               ) {
  switch (name) {
    case 'sessions_watch': {
      const since = typeof args.since === 'string' ? args.since : undefined
      const have = Array.isArray(args.have) ? args.have.filter((x)              => typeof x === 'string') : []
      const focus = typeof args.focus === 'string' ? args.focus : undefined
      return watch(since, have, focus, cancelled)
    }
    case 'agent_detail': {
      const row = await findRow(args.sessionId)
      if (typeof args.agentId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(args.agentId)) throw new Error('agentId non valido')
      return agentDetail(row, args.agentId)
    }
    case 'session_diff': {
      const row = await findRow(args.sessionId)
      if (typeof args.path !== 'string') throw new Error('path mancante')
      const { state, error } = await gitOf(row, true)
      if (!state) throw new Error(error ?? 'La cartella della sessione non è un repository git.')
      // only a path git lists as changed is read: never an arbitrary file
      return fileDiff(state, args.path)
    }
    case 'git_graph': {
      const row = await findRow(args.sessionId)
      const { state, error } = await gitOf(row)
      if (!state) throw new Error(error ?? 'La cartella della sessione non è un repository git.')
      return gitGraph(state.root, GRAPH_COMMITS)
    }
    case 'session_open':
      return openSession(await findRow(args.sessionId))
    case 'session_action':
      return sessionAction(args)
    default:
      throw new Error(`Tool sconosciuto: ${name}`)
  }
}

async function handle(msg     ) {
  const { id, method, params = {} } = msg
  if (method === 'notifications/cancelled') {
    const target = pending.get(params.requestId                   )
    if (target) target.cancelled = true
    return
  }
  if (id === undefined) return
  switch (method) {
    case 'initialize':
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'crab-sessions', version: VERSION },
        },
      })
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} })
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    case 'tools/call': {
      const name = String(params.name)
      const args = (params.arguments ?? {})                           
      const state = { cancelled: false }
      pending.set(id, state)
      const started = Date.now()
      try {
        const payload = await callTool(name, args, () => state.cancelled)
        send({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload },
        })
        void log(`${name} ok ${Date.now() - started}ms`)
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }] } })
        void log(`${name} error ${text}`)
      } finally {
        pending.delete(id)
      }
      return
    }
    default:
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Metodo non supportato: ${method}` } })
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  let msg     
  try {
    msg = JSON.parse(line)       
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON non valido' } })
  }
  void handle(msg)
})
process.stdin.on('end', () => process.exit(0))
void log(`start ${VERSION} pid ${process.pid}`)
