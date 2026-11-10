// The sessions open on this Mac, read from Claude Code's own files. Shared by the mod's pane
// (through `$.fs`) and the local MCP server behind the artifact (through node:fs): no `$`, no
// Node here, and only type imports, so Node can run this file as it is.
                                                                                        

                  
                                                                              
                                         
                                            
                                                       
 

                 
             
                   
             
               
                 
                     
                          
                    
                    
                              
                        
                          
 

                                          

// A session left waiting this long stops waving and falls asleep.
export const SLEEP_AFTER_MS = 10 * 60 * 1000
const AGENT_RUNNING_MS = 120 * 1000

export const ORDER = { approval: 0, asking: 1, waiting: 2, working: 3 }         

export const crabDir = (home        ) => `${home}/.claude/crab-sessions`
export const flagFile = (home        , id        ) => `${crabDir(home)}/ask-${id}.txt`
export const ledgerFile = (home        , id        ) => `${crabDir(home)}/tokens-${id}.json`
export const limitsFile = (home        , id        ) => `${crabDir(home)}/limits-${id}.json`
// Fable's weekly window, read from the desktop app's usage card: a stamp of its own, as only
// the app's sessions can read it
export const fableLimitFile = (home        , id        ) => `${crabDir(home)}/limits-${id}.fable.json`
export const FABLE_LIMIT = 'seven_day_fable'
export const inboxDir = (home        ) => `${crabDir(home)}/inbox`
export const commandFile = (home        , id        ) => `${inboxDir(home)}/${id}.json`
export const resultFile = (home        , id        ) => `${inboxDir(home)}/${id}.result.json`
// which session took an archive command on, and when
export const claimFile = (home        , id        ) => `${inboxDir(home)}/${id}.claim.json`
// sessions the person hid from the board: terminal ones, which the app cannot archive
export const hiddenFile = (home        ) => `${crabDir(home)}/hidden.json`
// Fable's weekly count, and the per-transcript tally it is summed from
export const fableFile = (home        ) => `${crabDir(home)}/fable-week.json`
export const fableCacheFile = (home        ) => `${crabDir(home)}/fable-cache.json`
export const transcriptDir = (home        , cwd        , id        ) =>
  `${home}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}`

export const lastDir = (cwd        ) => cwd.split('/').filter(Boolean).pop() ?? cwd

export const agentSkin = (type        ) =>
  /explore|fetch|search/i.test(type) ? 'research' : /plan/i.test(type) ? 'docs' : 'plain'

                                                                              

export const crabState = (state          , waitedMs        )            =>
  state === 'waiting' ? (waitedMs >= SLEEP_AFTER_MS ? 'idle' : 'waiting') : state === 'working' ? 'working' : state

export async function readFlag(io    , home        , id        )                            {
  const kind = (await io.read(flagFile(home, id)).catch(() => '0')).split(':')[0]

  return kind === 'question' || kind === 'approval' ? kind : undefined
}

                                                           

// Agents of one session: its transcripts keep one meta file per agent.
export async function agentsOf(
  io    ,
  home        ,
  cwd        ,
  id        ,
  now        ,
  { windowMs, max }             ,
)                      {
  const dir = `${transcriptDir(home, cwd, id)}/subagents`
  const entries = await io.list(dir).catch(() => [])
  const recent = entries
    .filter(x => x.name.endsWith('.jsonl') && now - x.mtimeMs < windowMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, max)
  const out             = []
  for (const file of recent) {
    const agentId = file.name.replace(/\.jsonl$/, '')
    try {
      const meta = JSON.parse(await io.read(`${dir}/${agentId}.meta.json`))     
                          
                            
                          
                      
                             
       
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

                              
             
                
                     
                                                
 

// One row per live session, the ones that wait on the person first.
export async function collectSessions(io    , home        , opts                )                        {
  const dir = `${home}/.claude/sessions`
  const rows               = []

  const entries = await io.list(dir).catch(() => [])
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue
    try {
      const reg = JSON.parse(await io.read(`${dir}/${entry.name}`))            
      // a registry file whose process is gone leaves no socket behind
      if (reg.messagingSocketPath && !(await io.exists(reg.messagingSocketPath))) continue
      const busy = reg.status === 'busy'
      const flag = busy ? await readFlag(io, home, reg.sessionId) : undefined
      const state           = flag === 'approval' ? 'approval' : flag === 'question' ? 'asking' : busy ? 'working' : 'waiting'
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
          .then(text => JSON.parse(text)          )
          .catch(() => undefined),
      })
    } catch {
      // one unreadable file must not hide the others
    }
  }

  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.since - b.since)
}

                                                 

// An idle session's own rate limits go stale: each session stamps what it saw right after a
// turn, and for each window the newest stamp of all wins. Empty when no session stamped one yet.
export async function stampedLimits(io    , home        )                   {
  const dir = crabDir(home)
  const entries = await io.list(dir).catch(() => [])
  const best = new Map                                      ()
  for (const entry of entries) {
    if (!/^limits-.+\.json$/.test(entry.name)) continue
    try {
      const file = JSON.parse(await io.read(`${dir}/${entry.name}`))              
      for (const limit of file.limits) {
        if ((best.get(limit.kind)?.at ?? -1) < file.at) best.set(limit.kind, { at: file.at, limit })
      }
    } catch {
      // half-written: skipped until the next refresh
    }
  }
  return [...best.values()].map(b => b.limit)
}

// What the artifact asks a session to do; the mod in that session runs it and answers.
// desktop: a terminal session moves to the desktop app (its /desktop), and the terminal closes
                                                                                 

// hostId: the app's id of the session (`local_…`), for an archive any session can run
                                                                                                                         

                                                             

                             
            
                       
                                                  
            
                  
 

// A command older than this, never picked up (the session was closed), is not run any more.
export const COMMAND_TTL_MS = 2 * 60 * 1000

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// every open pane and the artifact's server ask for it: one of them counts again this often
export const FABLE_EVERY_MS = 60 * 1000

// The week the count covers: since the last weekly reset, else the last seven days.
export const weekStart = (limits                  , now        ) => {
  const reset = limits.find(l => l.kind === 'seven_day')?.resetsAt
  const at = reset ? Date.parse(reset) : NaN
  // without a reset to go by, on the hour: the count is not started over at every call
  return Number.isFinite(at) ? at - WEEK_MS : Math.floor((now - WEEK_MS) / 3_600_000) * 3_600_000
}

// one reply's tokens and time: [fresh, cached, at]
                                                     
// `since`: the oldest reply the tallies hold, so they serve any later week start
                                                                                               

// The Fable replies of one transcript since `since`. A reply is written once per content block,
// all with the same id and usage: counted once.
function fableReplies(text        , since        )        {
  const out        = {}
  for (const line of text.split('\n')) {
    if (!line.includes('"claude-fable')) continue
    try {
      const d = JSON.parse(line)     
                     
                          
                                                                                             
       
      const m = d.message
      if (d.type !== 'assistant' || !m?.id || !m.model?.startsWith('claude-fable') || !m.usage) continue
      const at = d.timestamp ? Date.parse(d.timestamp) : NaN
      if (!(at >= since)) continue
      const u = m.usage
      out[m.id] = [
        (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        u.cache_read_input_tokens ?? 0,
        at,
      ]
    } catch {
      // a line still being written
    }
  }
  return out
}

// Every transcript touched since `since`: the sessions' own and their agents'.
async function weekTranscripts(io    , home        , since        ) {
  const root = `${home}/.claude/projects`
  const out                                      = []
  for (const project of await io.list(root).catch(() => [])) {
    const dir = `${root}/${project.name}`
    for (const file of await io.list(dir).catch(() => [])) {
      if (!file.name.endsWith('.jsonl') || file.mtimeMs < since) continue
      out.push({ path: `${dir}/${file.name}`, mtimeMs: file.mtimeMs })
      const agents = `${dir}/${file.name.replace(/\.jsonl$/, '')}/subagents`
      for (const a of await io.list(agents).catch(() => [])) {
        if (a.name.endsWith('.jsonl') && a.mtimeMs >= since) out.push({ path: `${agents}/${a.name}`, mtimeMs: a.mtimeMs })
      }
    }
  }
  return out
}

let counting                                

// Fable's use this week. Whoever finds the count older than FABLE_EVERY_MS counts again,
// reading only the transcripts changed since the last count; the others read its file.
export async function fableWeek(io    , home        , since        , now        )                                 {
  const saved = await io
    .read(fableFile(home))
    .then(t => JSON.parse(t)             )
    .catch(() => undefined)
  if (saved && saved.since === since && now - saved.at < FABLE_EVERY_MS) return saved
  if (!io.write) return saved?.since === since ? saved : undefined
  counting ??= countFable(io, home, since, now).finally(() => (counting = undefined))
  return counting
}

async function countFable(io    , home        , since        , now        )                     {
  const old = await io
    .read(fableCacheFile(home))
    .then(t => JSON.parse(t)              )
    .catch(() => undefined)
  const cache             = { since: old && old.since <= since ? old.since : since, files: {} }
  for (const file of await weekTranscripts(io, home, since)) {
    const hit = old && old.since <= since ? old.files[file.path] : undefined
    const replies =
      hit && hit.mtimeMs === file.mtimeMs ? hit.replies : fableReplies(await io.read(file.path).catch(() => ''), cache.since)
    cache.files[file.path] = { mtimeMs: file.mtimeMs, replies }
  }
  // a forked session copies the replies before the fork: one id, counted once
  const all        = {}
  for (const f of Object.values(cache.files)) Object.assign(all, f.replies)
  const week            = { fresh: 0, cached: 0, replies: 0, since, at: now }
  for (const [fresh, cached, at] of Object.values(all)) {
    if (at < since) continue
    week.fresh += fresh
    week.cached += cached
    week.replies += 1
  }
  await io.write?.(fableCacheFile(home), JSON.stringify(cache)).catch(() => undefined)
  await io.write?.(fableFile(home), JSON.stringify(week)).catch(() => undefined)
  return week
}
