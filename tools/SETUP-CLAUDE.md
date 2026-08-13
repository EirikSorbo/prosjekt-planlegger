# Oppsett: Claude-kobling for Prosjekt-planlegger

Kobler Prosjekt-planlegger-dataene (Firestore-prosjektet
`mishmash-wp4`; den ID-en er permanent og kan ikke døpes om) til Claude og
Obsidian-vaulten «Jobb-hjernen»:

- **Lesing:** `vault-synk.mjs` speiler alle prosjekter fra Firestore til
  `Jobb-hjernen/projects/project-app/prosjekt-planlegger/` som markdown
  (én vei, sky → filer), automatisk hvert kvarter via launchd, og på
  forespørsel når Claude jobber.
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

### 4. Installer launchd-jobben (autosynk hvert kvarter)

```bash
cp "/Users/eiriks05/Documents/Eiriks Script/prosjekt-planlegger/tools/no.eiriksorbo.prosjekt-planlegger-synk.plist" ~/Library/LaunchAgents/
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.eiriksorbo.prosjekt-planlegger-synk.plist
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
