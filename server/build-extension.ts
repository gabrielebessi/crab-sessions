// Packs the crab-sessions server as a Claude desktop extension: `node server/build-extension.ts`
// writes dist/crab-sessions.mcpb, installed with a double click. An extension, unlike an entry in
// claude_desktop_config.json, is never dropped when the app rewrites that file.
//
// The app runs it on its built-in Node, so the TypeScript sources become plain .mjs here
// (node:module's type stripping): no bundler, no dependencies.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'dist', 'extension')
const PLUGIN = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }

// source → path inside the extension; imports between them keep their relative layout
const FILES: Record<string, string> = {
  'server/crab-mcp.ts': 'server/crab-mcp.mjs',
  'server/git.ts': 'server/git.mjs',
  'core/sessions.ts': 'core/sessions.mjs',
  'hooks/sprites.ts': 'hooks/sprites.mjs',
}

rmSync(OUT, { recursive: true, force: true })
for (const [src, dest] of Object.entries(FILES)) {
  const code = stripTypeScriptTypes(readFileSync(join(ROOT, src), 'utf8'))
    // type-only imports leave nothing behind; the others point at the .mjs copies
    .replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.ts(['"])/g, '$1.mjs$2')
    .replace(/(from\s+['"]\.{1,2}\/[^'"]+?\/sessions)(['"])/g, '$1.mjs$2')
  mkdirSync(dirname(join(OUT, dest)), { recursive: true })
  writeFileSync(join(OUT, dest), code)
}

const manifest = {
  manifest_version: '0.2',
  name: 'crab-sessions',
  // the artifact reaches it as host:crab-sessions: the app names an extension's server after this
  display_name: 'crab-sessions',
  version: PLUGIN.version,
  description: 'Le sessioni di Claude Code sul Mac per la pagina Crab Sessions: stato, agenti, modifiche git, comandi.',
  author: { name: 'Gabriele Bessi' },
  server: {
    type: 'node',
    entry_point: 'server/crab-mcp.mjs',
    mcp_config: { command: 'node', args: ['${__dirname}/server/crab-mcp.mjs'] },
  },
  tools: [
    { name: 'sessions_watch', description: 'Le sessioni aperte, aggiornate appena cambiano' },
    { name: 'agent_detail', description: "Il dettaglio di un agente" },
    { name: 'session_diff', description: 'Il diff di un file modificato' },
    { name: 'git_graph', description: 'Il grafo dei commit' },
    { name: 'session_open', description: "Apre una sessione nell'app" },
    { name: 'session_action', description: 'Compatta, pulisce o divide una sessione' },
  ],
  compatibility: { platforms: ['darwin'], runtimes: { node: '>=22.0.0' } },
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const bundle = join(ROOT, 'dist', 'crab-sessions.mcpb')
rmSync(bundle, { force: true })
execFileSync('zip', ['-qr', bundle, '.'], { cwd: OUT })
console.log(`Scritto ${bundle}`)
