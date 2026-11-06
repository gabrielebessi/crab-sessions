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

## Sviluppo

```
claude plugin validate .
claude plugin test .
```

Le sprite sono in `hooks/sprites.ts`, il pannello in `hooks/register.tsx`.
