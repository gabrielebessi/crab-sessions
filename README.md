# crab-sessions

Mod di Claude Code: un pannello a destra della chat con le sessioni aperte sul Mac (dove lavorano, quali aspettano
una risposta), la percentuale e il reset della sessione da 5 ore e della settimana, gli agenti che lavorano sotto
ogni sessione e token e costo. Ogni sessione ha un granchio in pixel art animato, con una skin scelta dal titolo e
dalla cartella.

Legge solo file locali (`~/.claude/sessions`, `~/.claude/projects`) e scrive i suoi contatori in `~/.claude/crab-sessions/`.

## Installazione

Nel prompt di un terminale:

```
/plugin install crab-sessions --marketplace gabrielebessi/crab-sessions
```

Poi `/reload-plugins` nelle sessioni già aperte. Il pannello si apre da solo; `/crab` lo riapre.

## Variante artifact

`artifact/crab-sessions.html` è la stessa vista come pagina claude.ai, pubblicata su
https://claude.ai/artifact/LpUQMRei6v9s9f3KQRcJMC e aperta nel pannello Artifact dell'app desktop (in un browser
non raggiunge il Mac). Si aggiorna in diretta, apre una sessione nell'app, e per ogni sessione ha **Compatta**,
**Pulisci**, **Dividi** (una copia della conversazione che lavora in parallelo su un nuovo incarico) e **Archivia**
(**Nascondi** per le sessioni del Terminale); **Mostra** apre gli agenti in un popover accanto alla card, con il
dettaglio di ognuno (incarico, modello, token, ultimi passi). Compatta lancia `/compact`: dove è attivo
`jev-router` la compattazione la fa Jev. Le icone sono in `artifact/icons/` (foglio generato, `pixelate.py` le
porta su una griglia 24×24).

Un click su una sessione apre il suo dettaglio, con le altre sessioni in una colonna a sinistra per passare
dall'una all'altra, e tre schede: **Esecuzione** (ultima richiesta, agenti, passi dal più recente), **Modifiche**
(i file cambiati rispetto all'ultimo commit con righe aggiunte e tolte, e il diff di ognuno come su GitHub) e
**Grafo git** (i commit di tutti i rami con le loro corsie).

La pagina legge i dati dal server MCP locale `server/crab-mcp.ts` (nessuna dipendenza), che l'app desktop raggiunge
come `host:crab-sessions`. Si installa come estensione dell'app, che gira sul Node interno dell'app:

```
node server/build-extension.ts
```

scrive `dist/crab-sessions.mcpb`: doppio click e conferma (o trascinalo in Impostazioni → Estensioni). Va rifatto
dopo ogni modifica al server. Non va messo in `claude_desktop_config.json`: l'app riscrive quel file e ne toglie i
server (`server/register-desktop.ts` è rimasto dal primo tentativo).

Compatta, Pulisci e Dividi (per le sessioni dell'app) li esegue la mod dentro la sessione: il server scrive il
comando in `~/.claude/crab-sessions/inbox/`, la mod lo legge e risponde lì. Dividi per una sessione del Terminale
apre una nuova finestra con `claude --resume <id> --fork-session`.

## Sviluppo

```
claude plugin validate .
claude plugin test .
```

Le sprite sono in `hooks/sprites.ts`, il pannello in `hooks/register.tsx`, la lettura delle sessioni (condivisa con il
server) in `core/sessions.ts`.
