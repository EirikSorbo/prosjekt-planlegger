# Oppsett: Claude-kobling for Prosjekt-planlegger

Kobler Prosjekt-planlegger-dataene (Firestore-prosjektet
`mishmash-wp4`; den ID-en er permanent og kan ikke døpes om) til Claude og
Obsidian-vaulten «Jobb-hjernen»:

- **Lesing:** `vault-synk.mjs` speiler alle prosjekter fra Firestore til
  `Jobb-hjernen/projects/project-app/prosjekt-planlegger/` som markdown
  (én vei, sky → filer), automatisk hvert kvarter via launchd, og på
  forespørsel når Claude jobber.
- **Skriving:** `fangst.mjs` legger forespørsler i innbokskøen, som appen
  (eneste skriver til prosjektdokumentene) utfører trygt neste gang den er
  åpen: nye to-dos og oppgaver i hvilket som helst prosjekt, med valgfri
  frist, og fullføring av eksisterende elementer. Reglene gir Claude-brukeren
  kun `create` i køen: ingenting eksisterende kan endres eller slettes direkte.

  ```bash
  node tools/fangst.mjs "Ringe tannlegen"                            # todo i fangstprosjektet
  node tools/fangst.mjs "Skrive utkast" --prosjekt "UiA"             # todo i navngitt prosjekt
  node tools/fangst.mjs "Rapport" --oppgave --prosjekt UiA --frist 2026-09-01
  node tools/fangst.mjs --fullfor "Send epost" --prosjekt "MishMash WP4"
  ```
- **Kill switch:** deaktiver Claude-brukeren i Firebase-konsollen
  (Authentication → Users → ⋮ → Disable account), så er all tilgang død.

## Engangsoppsett

### 1. Opprett Claude-brukeren (Firebase-konsollen)

1. [console.firebase.google.com](https://console.firebase.google.com) → prosjektet **mishmash-wp4**.
2. **Authentication → Sign-in method**: aktiver leverandøren **E-post/passord**
   (bare «Email/Password», ikke «Email link»).
3. **Authentication → Users → Add user**: valgfri e-post (f.eks.
   `claude-planlegger@eiriksorbo.no`, den trenger ikke å eksistere) og et langt,
   generert passord. Trykk **Add user** og **kopier uid-en** til den nye brukeren.
4. Noter samtidig **din egen uid** fra samme liste (Google-brukeren din).

### 2. Publiser reglene

1. Åpne `firestore.rules` i dette repoet og erstatt `LIM-INN-CLAUDE-UID-HER`
   med Claude-brukerens uid (eller gi uid-en til Claude, så gjøres det for deg).
2. Lim hele fila inn i **Firestore Database → Rules** og trykk **Publish**.

### 3. Lag nøkkelfila

```bash
cp "/Users/eiriks05/Documents/Eiriks Script/prosjekt-planlegger/tools/nokkel.eksempel.json" "/Users/eiriks05/Documents/Eiriks Script/prosjekt-planlegger/tools/nokkel.json"
```

Fyll inn `eierUid` (din uid), `epost` og `passord` (Claude-brukerens).
Fila er gitignored og skal aldri committes. Den gir kun lese- og
innbokstilgang, og drepes med kill switchen over.

### 4. Installer/oppdater autosynken (hvert kvarter)

macOS nekter bakgrunnsjobber å lese `~/Documents` (TCC-personvernlaget), så
launchd-jobben kjører en KOPI av skript + nøkkel fra
`~/Library/Application Support/prosjekt-planlegger-synk/`. Denne blokka
installerer kopien, plist-en og (re)starter jobben. Kjør den både første gang
og etter endringer i `vault-synk.mjs` eller `nokkel.json`:

```bash
KILDE="/Users/eiriks05/Documents/Eiriks Script/prosjekt-planlegger/tools" && MAAL="$HOME/Library/Application Support/prosjekt-planlegger-synk" && mkdir -p "$MAAL" && cp "$KILDE/vault-synk.mjs" "$KILDE/nokkel.json" "$MAAL/" && chmod 600 "$MAAL/nokkel.json" && cp "$KILDE/no.eiriksorbo.prosjekt-planlegger-synk.plist" "$HOME/Library/LaunchAgents/" && { launchctl bootout "gui/$(id -u)/no.eiriksorbo.prosjekt-planlegger-synk" 2>/dev/null || true; } && launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/no.eiriksorbo.prosjekt-planlegger-synk.plist" && launchctl kickstart -k "gui/$(id -u)/no.eiriksorbo.prosjekt-planlegger-synk" && echo "Autosynk installert og startet."
```

Logg havner i `~/Library/Logs/prosjekt-planlegger-synk.log`. Jobben er ufarlig
å installere før steg 1 til 3 er gjort: uten nøkkelfil gjør den ingenting.

### 5. Test

```bash
node "/Users/eiriks05/Documents/Eiriks Script/prosjekt-planlegger/tools/vault-synk.mjs"
```

Sjekk at `Jobb-hjernen/projects/project-app/prosjekt-planlegger/` fikk
`oversikt.md` og ett notat per prosjekt.

```bash
node "/Users/eiriks05/Documents/Eiriks Script/prosjekt-planlegger/tools/fangst.mjs" "Test fra oppsettet"
```

Åpne appen og se at testen dukker opp i fangstprosjektet.

## Drift

- **Stoppe autosynken:** `launchctl bootout gui/$(id -u)/no.eiriksorbo.prosjekt-planlegger-synk`
- **Kjøre synken nå:** `launchctl kickstart -k gui/$(id -u)/no.eiriksorbo.prosjekt-planlegger-synk`
- **Bytte passord:** slett Claude-brukeren i konsollen og opprett en ny,
  oppdater så uid i reglene (publiser på nytt) og nøkkelfila.
- Speilfilene er generert: rediger dem aldri for hånd, de overskrives.
  Slettes et prosjekt i appen, får notatet `status: stale` men beholdes
  (vaultens «slett aldri»-regel).
