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
export const inboxDir = (home        ) => `${crabDir(home)}/inbox`
export const commandFile = (home        , id        ) => `${inboxDir(home)}/${id}.json`
export const resultFile = (home        , id        ) => `${inboxDir(home)}/${id}.result.json`
// sessions the person hid from the board: terminal ones, which the app cannot archive
export const hiddenFile = (home        ) => `${crabDir(home)}/hidden.json`
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
// turn, and the newest stamp of all wins. Empty when no session stamped one yet.
export async function stampedLimits(io    , home        )                   {
  const dir = crabDir(home)
  const entries = await io.list(dir).catch(() => [])
  let best                        
  for (const entry of entries) {
    if (!/^limits-.+\.json$/.test(entry.name)) continue
    try {
      const file = JSON.parse(await io.read(`${dir}/${entry.name}`))              
      if (!best || file.at > best.at) best = file
    } catch {
      // half-written: skipped until the next refresh
    }
  }
  return best?.limits ?? []
}

// What the artifact asks a session to do; the mod in that session runs it and answers.
                                                                     

                                                                                                        

                             
            
                       
                                                  
            
                  
 

// A command older than this, never picked up (the session was closed), is not run any more.
export const COMMAND_TTL_MS = 2 * 60 * 1000
