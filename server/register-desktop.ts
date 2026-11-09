// Registers the crab-sessions server in the Claude desktop app's config, run with the Node that
// will serve it: `node server/register-desktop.ts`.
//
// The app keeps the file in memory and writes it back every few minutes: with the app open, the
// new entry holds only once the app has read it, so right after this script run the app's menu
// Developer → Reload MCP Configuration (Help → Troubleshooting → Enable Developer Mode shows it).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const CONFIG = `${homedir()}/Library/Application Support/Claude/claude_desktop_config.json`
const SERVER = fileURLToPath(new URL('./crab-mcp.ts', import.meta.url))

// the app's main process is .../Contents/MacOS/Claude: its helpers are named "Claude Helper"
const isAppRunning = () =>
  execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' })
    .split('\n')
    .some(line => line.trim().endsWith('.app/Contents/MacOS/Claude'))

const config = existsSync(CONFIG) ? (JSON.parse(readFileSync(CONFIG, 'utf8')) as { mcpServers?: Record<string, unknown> }) : {}
if (existsSync(CONFIG)) copyFileSync(CONFIG, `${CONFIG}.bak-crab`)
config.mcpServers = { ...config.mcpServers, 'crab-sessions': { command: process.execPath, args: [SERVER] } }
writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`)

console.log(`crab-sessions registrato con ${process.execPath}.`)
if (isAppRunning()) {
  console.log("Ora, subito: nell'app Claude menu Developer → Reload MCP Configuration.")
  console.log("(Se il menu Developer non c'è: Help → Troubleshooting → Enable Developer Mode.)")
  console.log("Se aspetti, l'app può riscrivere il file e togliere la voce: in quel caso rilancia questo comando.")
} else {
  console.log("Riapri l'app Claude.")
}
