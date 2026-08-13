#!/usr/bin/env node
// Speiler Prosjekt-planlegger-dataene (appen i wp4-repoet) fra Firestore til
// Obsidian-vaulten «Jobb-hjernen».
// ÉN VEI: sky → filer. Filene er lesekopier for Obsidian/Claude og skrives
// aldri tilbake til Firestore (skriving til appen skjer via fangst.mjs, som
// bruker innboks-kanalen appen selv tømmer).
//
// Kjøres av launchd hvert kvarter (se no.eiriksorbo.prosjekt-planlegger-synk.plist)
// og manuelt/av Claude ved behov. Uten nokkel.json avslutter den stille
// med kode 0, så launchd-jobben er ufarlig før oppsettet er fullført.
//
// Bruk:
//   node vault-synk.mjs            skriv/oppdater filene i vaulten
//   node vault-synk.mjs --json     skriv rådata til stdout i stedet (for Claude)
//   node vault-synk.mjs --demo     testdata, skrives til $TMPDIR/prosjekt-planlegger-demo
//   node vault-synk.mjs --maal DIR overstyr målmappe
//
// Vault-konvensjoner som følges (se vaultens AGENTS.md): frontmatter med
// title/created/updated/tags/status, kebab-case-filnavn uten æøå, ingen
// lang tankestrek i generert tekst, aldri slette (foreldreløse filer får
// status: stale i stedet).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HER = dirname(fileURLToPath(import.meta.url));
const NOKKEL_STI = join(HER, 'nokkel.json');
const STANDARD_MAAL = '/Users/eiriks05/Library/Mobile Documents/iCloud~md~obsidian/Documents/Jobb-hjernen/projects/project-app/prosjekt-planlegger';

const arg = process.argv.slice(2);
const SOM_JSON = arg.includes('--json');
const DEMO = arg.includes('--demo');
const MAAL = arg.includes('--maal') ? arg[arg.indexOf('--maal') + 1]
           : DEMO ? join(process.env.TMPDIR || '/tmp', 'prosjekt-planlegger-demo')
           : STANDARD_MAAL;

// ── Firestore-hjelpere ──────────────────────────────────────────────────────

// Firestore REST pakker verdier inn i typeobjekter; pakk ut til vanlig JS.
function utpakk(v) {
  if (v === null || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(utpakk);
  if ('mapValue' in v) return utpakkFelter(v.mapValue.fields || {});
  return v;
}
function utpakkFelter(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields)) o[k] = utpakk(v);
  return o;
}

async function loggInn(n) {
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + n.apiKey,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: n.epost, password: n.passord, returnSecureToken: true }) });
  if (!r.ok) throw new Error('Innlogging feilet (' + r.status + '): ' + (await r.text()).slice(0, 300));
  return (await r.json()).idToken;
}

async function hentDok(n, token, sti) {
  const r = await fetch(
    'https://firestore.googleapis.com/v1/projects/' + n.projectId + '/databases/(default)/documents/' + sti,
    { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Henting av ' + sti + ' feilet (' + r.status + '): ' + (await r.text()).slice(0, 300));
  const d = await r.json();
  return utpakkFelter(d.fields || {});
}

async function listSamling(n, token, sti) {
  const ut = [];
  let side = '';
  do {
    const r = await fetch(
      'https://firestore.googleapis.com/v1/projects/' + n.projectId + '/databases/(default)/documents/' + sti
      + '?pageSize=300' + (side ? '&pageToken=' + encodeURIComponent(side) : ''),
      { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Listing av ' + sti + ' feilet (' + r.status + '): ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    for (const dok of d.documents || [])
      ut.push({ id: dok.name.split('/').pop(), ...utpakkFelter(dok.fields || {}) });
    side = d.nextPageToken || '';
  } while (side);
  return ut;
}

// ── Markdown-generering ─────────────────────────────────────────────────────

function slug(s) {
  return String(s || 'uten-navn').toLowerCase()
    .replaceAll('å', 'a').replaceAll('ø', 'o').replaceAll('æ', 'ae')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uten-navn';
}
const iDag = () => new Date().toISOString().slice(0, 10);
const naa  = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

// Behold created fra eksisterende fil; skriv bare når innholdet (minus
// updated-linja) faktisk er endret, så iCloud slipper unødig churn.
function skrivNotat(sti, lagInnhold) {
  let created = iDag();
  let gammel = null;
  if (existsSync(sti)) {
    gammel = readFileSync(sti, 'utf8');
    const m = gammel.match(/^created: (.+)$/m);
    if (m) created = m[1].trim();
  }
  const ny = lagInnhold(created);
  const strippUpdated = t => t.replace(/^updated: .+$/m, '');
  if (gammel !== null && strippUpdated(gammel) === strippUpdated(ny)) return false;
  writeFileSync(sti, ny);
  return true;
}

const ADVARSEL = '> Generert automatisk fra Prosjekt-planlegger-appen. Ikke rediger her: endringer synkes ikke tilbake og overskrives ved neste kjøring.';

function frontmatter(tittel, created, status) {
  return ['---',
    'title: ' + tittel,
    'created: ' + created,
    'updated: ' + iDag(),
    'tags: [teknologi, personlig-utvikling]',
    'status: ' + status,
    'source: Prosjekt-planlegger-appen (Firestore-prosjektet mishmash-wp4)',
    '---'].join('\n');
}

function radTodo(t) {
  const deler = [t.tittel || '(uten tittel)'];
  if (t.frist) deler.push('(frist ' + t.frist + ')');
  return '- [' + (t.fullfort ? 'x' : ' ') + '] ' + deler.join(' ');
}
function radOppgave(o) {
  const deler = [o.beskrivelse || o.navn || '(uten navn)'];
  if (o.frist) deler.push('(frist ' + o.frist + ')');
  return '- [' + (o.fullfort ? 'x' : ' ') + '] ' + deler.join(' ');
}
function radAktivitet(a) {
  const navn = a.navn || a.tittel || a.beskrivelse || '(uten navn)';
  const periode = [a.start, a.slutt].filter(Boolean).join(' til ');
  return '- ' + navn + (periode ? ' (' + periode + ')' : '');
}

function seksjon(overskrift, rader) {
  if (!rader.length) return '';
  return '\n## ' + overskrift + '\n\n' + rader.join('\n') + '\n';
}

function prosjektNotat(p, data, created) {
  const todos    = data.todos || [];
  const oppgaver = data.oppgaver || [];
  const aktiv    = data.aktiviteter || [];
  const apneT = todos.filter(t => t && !t.fullfort);
  const apneO = oppgaver.filter(o => o && !o.fullfort);
  return frontmatter(p.navn + ' (Prosjekt-planlegger)', created, 'active') + '\n\n'
    + ADVARSEL + '\n'
    + seksjon('To do (' + apneT.length + ' åpne)', todos.filter(Boolean).map(radTodo))
    + seksjon('Oppgaver (' + apneO.length + ' åpne)', oppgaver.filter(Boolean).map(radOppgave))
    + seksjon('Aktiviteter', aktiv.filter(Boolean).map(radAktivitet))
    + '\nSist synket: ' + naa() + '\n';
}

function oversiktNotat(prosjekter, dataPerPid, innboksAntall, created) {
  const rader = prosjekter.map(p => {
    const d = dataPerPid[p.id] || {};
    const apne = (d.todos || []).filter(t => t && !t.fullfort).length
               + (d.oppgaver || []).filter(o => o && !o.fullfort).length;
    return '- [' + p.navn + '](' + slug(p.navn) + '.md): ' + apne + ' åpne punkter';
  });
  return frontmatter('Oversikt over Prosjekt-planlegger', created, 'active') + '\n\n'
    + ADVARSEL + '\n\n'
    + '## Prosjekter\n\n' + (rader.join('\n') || '- (ingen prosjekter)') + '\n\n'
    + '## Status\n\n'
    + '- Sist synket: ' + naa() + '\n'
    + '- Siri-innboks: ' + innboksAntall + (innboksAntall === 1 ? ' fangst' : ' fangster') + ' venter på at appen åpnes\n';
}

// Foreldreløse notater (prosjekt slettet i appen): aldri slett i vaulten,
// merk dem som stale i stedet.
function merkForeldrelose(maal, gyldigeSlugs) {
  if (!existsSync(maal)) return;
  for (const fil of readdirSync(maal)) {
    if (!fil.endsWith('.md') || fil === 'oversikt.md') continue;
    if (gyldigeSlugs.has(fil.replace(/\.md$/, ''))) continue;
    const sti = join(maal, fil);
    const innhold = readFileSync(sti, 'utf8');
    if (/^status: stale$/m.test(innhold)) continue;
    writeFileSync(sti, innhold
      .replace(/^status: .+$/m, 'status: stale')
      .replace(ADVARSEL, ADVARSEL + '\n\n> Prosjektet finnes ikke lenger i Prosjekt-planlegger. Notatet beholdes som historikk.'));
    console.log('merket stale:', fil);
  }
}

// ── Hoveddel ────────────────────────────────────────────────────────────────

async function hentAlt() {
  if (DEMO) {
    return {
      prosjekter: [{ id: 'demo1', navn: 'Demo prosjekt Æøå' }, { id: 'demo2', navn: 'Annet demo' }],
      dataPerPid: {
        demo1: {
          todos: [{ tittel: 'Ringe Vålerenga', frist: '2026-08-20', fullfort: false },
                  { tittel: 'Ferdig ting', fullfort: true }],
          oppgaver: [{ beskrivelse: 'Skrive rapport', frist: '2026-09-01', fullfort: false }],
          aktiviteter: [{ navn: 'Høstplanlegging', start: '2026-08-01', slutt: '2026-10-01' }]
        },
        demo2: { todos: [], oppgaver: [], aktiviteter: [] }
      },
      innboks: [{ tekst: 'demo-fangst' }]
    };
  }
  if (!existsSync(NOKKEL_STI)) {
    console.log('nokkel.json mangler (' + NOKKEL_STI + '); hopper over. Se SETUP-CLAUDE.md.');
    process.exit(0);
  }
  const n = JSON.parse(readFileSync(NOKKEL_STI, 'utf8'));
  const token = await loggInn(n);
  const bruker = await hentDok(n, token, 'brukere/' + n.eierUid);
  if (!bruker) throw new Error('Fant ikke brukerdokumentet for eierUid ' + n.eierUid);
  const prosjekter = (bruker.prosjekter || []).filter(p => p && p.id && !p.arkivert);
  const dataPerPid = {};
  for (const p of prosjekter)
    dataPerPid[p.id] = await hentDok(n, token, 'brukere/' + n.eierUid + '/prosjekter/' + p.id) || {};
  const innboks = await listSamling(n, token, 'brukere/' + n.eierUid + '/innboks');
  return { prosjekter, dataPerPid, innboks, fangstProsjekt: bruker.fangstProsjekt || null };
}

const { prosjekter, dataPerPid, innboks } = await hentAlt();

if (SOM_JSON) {
  console.log(JSON.stringify({ hentet: new Date().toISOString(), prosjekter, dataPerPid, innboks }, null, 2));
  process.exit(0);
}

mkdirSync(MAAL, { recursive: true });
let endret = 0;
const slugs = new Set();
for (const p of prosjekter) {
  const s = slug(p.navn);
  slugs.add(s);
  if (skrivNotat(join(MAAL, s + '.md'), created => prosjektNotat(p, dataPerPid[p.id] || {}, created))) {
    endret++;
    console.log('oppdatert:', s + '.md');
  }
}
skrivNotat(join(MAAL, 'oversikt.md'), created => oversiktNotat(prosjekter, dataPerPid, innboks.length, created));
writeFileSync(join(MAAL, 'prosjekt-planlegger-data.json'),
  JSON.stringify({ hentet: new Date().toISOString(), prosjekter, dataPerPid, innboks }, null, 2));
merkForeldrelose(MAAL, slugs);
console.log(naa() + ': synket ' + prosjekter.length + ' prosjekter til ' + MAAL + ' (' + endret + ' endret)');
