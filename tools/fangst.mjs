#!/usr/bin/env node
// Legger et gjøremål i Prosjekt-planleggerens Siri-innboks (brukere/<eier>/innboks) som
// Claude-brukeren. Appen tømmer innboksen inn i fangstprosjektet med samme
// flyt som Siri-fangsten, så dette er den trygge skrivekanalen: reglene gir
// Claude-brukeren KUN create her, aldri endring eller sletting av noe annet.
//
// Bruk:
//   node fangst.mjs "Ringe tannlegen"
//   node fangst.mjs "Les denne" --url "https://example.com"

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HER = dirname(fileURLToPath(import.meta.url));
const NOKKEL_STI = join(HER, 'nokkel.json');

const arg = process.argv.slice(2);
let tekst = '';
let url = '';
for (let i = 0; i < arg.length; i++) {
  if (arg[i] === '--url') url = arg[++i] || '';
  else if (!tekst) tekst = arg[i];
}

if (!tekst || !tekst.trim()) {
  console.error('Bruk: node fangst.mjs "tekst" [--url "https://..."]');
  process.exit(1);
}
if (!existsSync(NOKKEL_STI)) {
  console.error('nokkel.json mangler; se SETUP-CLAUDE.md.');
  process.exit(1);
}

const n = JSON.parse(readFileSync(NOKKEL_STI, 'utf8'));

const inn = await fetch(
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + n.apiKey,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: n.epost, password: n.passord, returnSecureToken: true }) });
if (!inn.ok) { console.error('Innlogging feilet:', (await inn.text()).slice(0, 300)); process.exit(1); }
const token = (await inn.json()).idToken;

const felter = {
  tekst: { stringValue: tekst.trim().slice(0, 500) },
  kilde: { stringValue: 'claude' },
  opprettet: { stringValue: new Date().toISOString() }
};
if (url) felter.url = { stringValue: url.slice(0, 500) };

const r = await fetch(
  'https://firestore.googleapis.com/v1/projects/' + n.projectId + '/databases/(default)/documents/brukere/' + n.eierUid + '/innboks',
  { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: felter }) });
if (!r.ok) { console.error('Skriving feilet (' + r.status + '):', (await r.text()).slice(0, 300)); process.exit(1); }
console.log('Lagt i innboksen: ' + tekst.trim() + ' (dukker opp i fangstprosjektet neste gang appen åpnes)');
