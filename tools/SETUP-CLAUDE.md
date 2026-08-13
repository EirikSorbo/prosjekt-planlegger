# Oppsett: Claude-kobling for wp4

Kobler wp4-dataene til Claude og Obsidian-vaulten «Jobb-hjernen»:

- **Lesing:** `vault-synk.mjs` speiler alle prosjekter fra Firestore til
  `Jobb-hjernen/projects/project-app/wp4/` som markdown (én vei, sky → filer),
  automatisk hvert kvarter via launchd, og på forespørsel når Claude jobber.
- **Skriving:** `fangst.mjs` legger gjøremål i Siri-innboksen, som appen selv
  tømmer inn i fangstprosjektet. Reglene gir Claude-brukeren kun `create` der:
  ingenting eksisterende kan endres eller slettes, uansett.
- **Kill switch:** deaktiver Claude-brukeren i Firebase-konsollen
  (Authentication → Users → ⋮ → Disable account), så er all tilgang død.

## Engangsoppsett

### 1. Opprett Claude-brukeren (Firebase-konsollen)

1. [console.firebase.google.com](https://console.firebase.google.com) → prosjektet **mishmash-wp4**.
2. **Authentication → Sign-in method**: aktiver leverandøren **E-post/passord**
   (bare «Email/Password», ikke «Email link»).
3. **Authentication → Users → Add user**: valgfri e-post (f.eks.
   `claude-wp4@eiriksorbo.no`, den trenger ikke å eksistere) og et langt,
   generert passord. Trykk **Add user** og **kopier uid-en** til den nye brukeren.
4. Noter samtidig **din egen uid** fra samme liste (Google-brukeren din).

### 2. Publiser reglene

1. Åpne `firestore.rules` i dette repoet og erstatt `LIM-INN-CLAUDE-UID-HER`
   med Claude-brukerens uid (eller gi uid-en til Claude, så gjøres det for deg).
2. Lim hele fila inn i **Firestore Database → Rules** og trykk **Publish**.

### 3. Lag nøkkelfila

```bash
cp "/Users/eiriks05/Documents/Eiriks Script/wp4/tools/nokkel.eksempel.json" "/Users/eiriks05/Documents/Eiriks Script/wp4/tools/nokkel.json"
```

Fyll inn `eierUid` (din uid), `epost` og `passord` (Claude-brukerens).
Fila er gitignored og skal aldri committes. Den gir kun lese- og
innbokstilgang, og drepes med kill switchen over.

### 4. Installer launchd-jobben (autosynk hvert kvarter)

```bash
cp "/Users/eiriks05/Documents/Eiriks Script/wp4/tools/no.eiriksorbo.wp4-vaultsynk.plist" ~/Library/LaunchAgents/
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.eiriksorbo.wp4-vaultsynk.plist
```

Logg havner i `~/Library/Logs/wp4-vaultsynk.log`. Jobben er ufarlig å
installere før steg 1 til 3 er gjort: uten nøkkelfil gjør den ingenting.

### 5. Test

```bash
node "/Users/eiriks05/Documents/Eiriks Script/wp4/tools/vault-synk.mjs"
```

Sjekk at `Jobb-hjernen/projects/project-app/wp4/` fikk `oversikt.md` og ett
notat per prosjekt.

```bash
node "/Users/eiriks05/Documents/Eiriks Script/wp4/tools/fangst.mjs" "Test fra oppsettet"
```

Åpne wp4-appen og se at testen dukker opp i fangstprosjektet.

## Drift

- **Stoppe autosynken:** `launchctl bootout gui/$(id -u)/no.eiriksorbo.wp4-vaultsynk`
- **Kjøre synken nå:** `launchctl kickstart -k gui/$(id -u)/no.eiriksorbo.wp4-vaultsynk`
- **Bytte passord:** endre i konsollen (Users → ⋮ → Reset password fungerer ikke
  for konsollbrukere; slett og opprett heller på nytt, oppdater regler + nøkkelfil).
- Speilfilene er generert: rediger dem aldri for hånd, de overskrives.
  Slettes et prosjekt i wp4, får notatet `status: stale` men beholdes (vaultens
  «slett aldri»-regel).
