// Regresjonstest for synkroniseringen (v4.93). Kjør etter HVER endring i
// synk-laget:   node tools/synk-test.mjs
//
// Kjører appens EKTE synk-kode (trukket ut av index.html mellom faste
// markørkommentarer) på to simulerte enheter (telefon og Mac) med hver sin
// localStorage, mot én felles falsk Firestore med ekte transaksjonssemantikk
// (nytt forsøk ved kollisjon) og av/på-nett. Scenarioene er de som ga datatap
// før fletting ble innført. Kontroll: erstatt flettingen i _lagreNå med
// `const flettet = lokal;` (gammel oppførsel), da skal 1b, 1c, 2 og 5 feile.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const mod = html.slice(html.indexOf('<script type="module">'));
const mellom = (fra, til) => {
  const i = mod.indexOf(fra), j = mod.indexOf(til, i + 1);
  if (i < 0 || j < 0) throw new Error('fant ikke ' + fra);
  return mod.slice(i, j);
};
const KODE = mellom('  // ── Synkronisering med fletting (v4.93)', '  // Start-fanen viser elementer fra ALLE prosjekter')
           + mellom('  async function _lastProsjektFraSky(userId, prosjektId) {', '  // Lytter: fanger opp elementer som kommer mens appen står åpen.');

// ── Falsk Firestore ─────────────────────────────────────────────────────────
const kopi = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const sky = { docs: new Map(), ver: new Map(), online: true, førLes: null, skriv: 0 };
const ref = (...deler) => ({ path: deler.slice(1).join('/') });
const snapAv = path => {
  const d = sky.docs.get(path);
  return { exists: () => d !== undefined, data: () => kopi(d) };
};
const skrivDok = (path, data, opts) => {
  const gammel = sky.docs.get(path);
  sky.docs.set(path, (opts && opts.merge && gammel) ? { ...gammel, ...kopi(data) } : kopi(data));
  sky.ver.set(path, (sky.ver.get(path) || 0) + 1);
  sky.skriv++;
};
const nettfeil = () => { const e = new Error('offline'); e.code = 'unavailable'; return e; };
const fb = {
  db: {},
  doc: (db, ...deler) => ref(db, ...deler),
  collection: (db, ...deler) => ref(db, ...deler),
  getDocFromServer: async r => { if (!sky.online) throw nettfeil(); return snapAv(r.path); },
  getDoc: async r => snapAv(r.path),
  setDoc: async (r, data, opts) => { if (!sky.online) throw nettfeil(); skrivDok(r.path, data, opts); },
  deleteDoc: async r => { sky.docs.delete(r.path); },
  getDocs: async r => {
    const docs = [...sky.docs.entries()].filter(([p]) => p.startsWith(r.path + '/'))
      .map(([p, d]) => ({ id: p.split('/').pop(), data: () => kopi(d) }));
    return { empty: !docs.length, forEach: cb => docs.forEach(cb) };
  },
  onSnapshot: () => () => {},
  runTransaction: async (db, fn) => {
    for (let forsøk = 0; forsøk < 5; forsøk++) {
      if (!sky.online) throw nettfeil();
      const lest = new Map(), skrevet = [];
      const tx = {
        get: async r => {
          if (sky.førLes) { const h = sky.førLes; sky.førLes = null; await h(); }
          lest.set(r.path, sky.ver.get(r.path) || 0);
          const snap = snapAv(r.path);
          // Etter lesing, før skriving: her havner en ekte kollisjon.
          if (sky.etterLes) { const h = sky.etterLes; sky.etterLes = null; await h(); }
          return snap;
        },
        set: (r, data, opts) => { skrevet.push([r.path, data, opts]); }
      };
      const res = await fn(tx);
      if ([...lest].every(([p, v]) => (sky.ver.get(p) || 0) === v)) {   // ingen andre skrev imellom
        skrevet.forEach(([p, d, o]) => skrivDok(p, d, o));
        return res;
      }
      sky.konflikter = (sky.konflikter || 0) + 1;                         // prøv igjen, som Firestore
    }
    throw new Error('transaksjon ga opp');
  }
};

// ── Én enhet = egen localStorage + egen instans av koden ─────────────────────
function lagEnhet(navn) {
  const lager = new Map();
  const localStorage = {
    getItem: k => lager.has(k) ? lager.get(k) : null,
    setItem: (k, v) => lager.set(k, String(v)),
    removeItem: k => lager.delete(k),
  };
  const window = {
    _getAktivtProsjektId: () => 'P', _getProsjekter: () => [{ id: 'P', navn: 'P' }],
    _flogUnion: (a, b) => { const ut = [], s = new Set(); [...(a||[]), ...(b||[])].forEach(e => { if (e && e.eid) { if (s.has(e.eid)) return; s.add(e.eid); } ut.push(e); }); return ut; },
    _lokalDatoStr: () => '2026-10-28', _fangstProsjektId: () => 'P', addEventListener: () => {},
  };
  const navigator = { get onLine() { return sky.online; } };
  const stubs = { visSynkStatus: () => {}, _oppdaterAppFraSky: () => {}, renderAlleLister: () => {}, renderStartside: () => {} };
  const fabrikk = new Function('fb', 'localStorage', 'window', 'navigator', 'stubs',
    `const { db, doc, collection, getDoc, getDocFromServer, setDoc, deleteDoc, getDocs, onSnapshot, runTransaction } = fb;
     const { visSynkStatus, _oppdaterAppFraSky, renderAlleLister, renderStartside } = stubs;
     ${KODE}
     return { lagreTilSky, _lastProsjektFraSky, _tommInnboks, _adopterSky, _skyDok };`);
  const api = fabrikk(fb, localStorage, window, navigator, stubs);
  const les = n => JSON.parse(localStorage.getItem('lp_P_' + n) || '[]');
  return {
    navn, api, localStorage,
    todos: () => les('t').map(t => t.id + (t.fullfort ? '✓' : '')).sort().join(','),
    // Slik appens lagre() gjør: skriv lokalt, merk dirty, send.
    endre: async (mutér, vent = true) => {
      const t = les('t'); mutér(t);
      localStorage.setItem('lp_P_t', JSON.stringify(t));
      localStorage.setItem('lp_P_dirty', String(Math.random()));
      const p = api.lagreTilSky('u', 'P');
      if (vent) await p; return p;
    },
    hent: () => api._lastProsjektFraSky('u', 'P'),
  };
}
const skyTodos = () => ((sky.docs.get('brukere/u/prosjekter/P') || {}).todos || []).map(t => t.id + (t.fullfort ? '✓' : '')).sort().join(',');
const td = (id, x = {}) => ({ id, tittel: id, fullfort: false, ...x });

let feil = 0;
const sjekk = (navn, fikk, forventet) => {
  const ok = fikk === forventet; if (!ok) feil++;
  console.log((ok ? 'OK  ' : 'FEIL') + ' ' + navn + (ok ? '' : `\n        fikk      ${fikk}\n        forventet ${forventet}`));
};
const nullstill = (todos) => {
  sky.docs.clear(); sky.ver.clear(); sky.online = true; sky.førLes = null; sky.etterLes = null; sky.konflikter = 0;
  skrivDok('brukere/u/prosjekter/P', { todos, aktiviteter: [], oppgaver: [], kategorier: [] });
  const tlf = lagEnhet('telefon'), mac = lagEnhet('mac');
  return { tlf, mac };
};

// ─── 1. Det opprinnelige tapsscenariet ──────────────────────────────────────
{
  const { tlf, mac } = nullstill([td('A'), td('B')]);
  await tlf.hent(); await mac.hent();
  sky.online = false;
  await tlf.endre(t => { t.find(x => x.id === 'A').fullfort = true; });   // offline-avhuking
  sjekk('1a offline: endringen ligger lokalt, ikke i skyen', skyTodos(), 'A,B');
  sky.online = true;
  skrivDok('brukere/u/prosjekter/P', { todos: [td('A'), td('B'), td('N')] }, { merge: true });  // Claude/Siri legger til N
  await tlf.api.lagreTilSky('u', 'P');                                       // nettet tilbake
  sjekk('1b skyen har både avhukingen og N', skyTodos(), 'A✓,B,N');
  sjekk('1c telefonen fikk N inn lokalt', tlf.todos(), 'A✓,B,N');
  sjekk('1d dirty tømt etter vellykket lagring', String(tlf.localStorage.getItem('lp_P_dirty')), 'null');
}
// ─── 2. To enheter endrer ulike ting ─────────────────────────────────────────
{
  const { tlf, mac } = nullstill([td('A'), td('B')]);
  await tlf.hent(); await mac.hent();
  await mac.endre(t => t.push(td('X')));
  await tlf.endre(t => { t.find(x => x.id === 'B').fullfort = true; });   // tlf har ikke sett X
  sjekk('2  begge endringene overlever', skyTodos(), 'A,B✓,X');
}
// ─── 3. Sletting formidles begge veier ───────────────────────────────────────
{
  const { tlf, mac } = nullstill([td('A'), td('B'), td('C')]);
  await tlf.hent(); await mac.hent();
  await tlf.endre(t => t.splice(t.findIndex(x => x.id === 'B'), 1));
  sjekk('3a sletting på telefon når skyen', skyTodos(), 'A,C');
  await mac.hent();
  sjekk('3b Mac får slettingen ved henting', mac.todos(), 'A,C');
  await mac.endre(t => t.push(td('D')));
  sjekk('3c Mac gjenoppliver ikke B ved neste lagring', skyTodos(), 'A,C,D');
}
// ─── 4. Endring MENS lagringen pågår ─────────────────────────────────────────
{
  const { tlf } = nullstill([td('A')]);
  await tlf.hent();
  let underveis;
  sky.førLes = async () => {   // midt i transaksjonen: brukeren legger til M
    const t = JSON.parse(tlf.localStorage.getItem('lp_P_t')); t.push(td('M'));
    tlf.localStorage.setItem('lp_P_t', JSON.stringify(t));
    tlf.localStorage.setItem('lp_P_dirty', 'ny-endring');
    underveis = tlf.api.lagreTilSky('u', 'P');
  };
  await tlf.endre(t => t.push(td('L')));
  sjekk('4a lokal kopi beholder M (gjort underveis)', tlf.todos(), 'A,L,M');
  await underveis;
  sjekk('4b oppfølgingslagringen sendte M', skyTodos(), 'A,L,M');
}
// ─── 5. Transaksjonskonflikt: noen skriver mellom lesing og skriving ─────────
{
  const { tlf } = nullstill([td('A')]);
  await tlf.hent();
  sky.etterLes = async () => { skrivDok('brukere/u/prosjekter/P', { todos: [td('A'), td('Z')] }, { merge: true }); };
  await tlf.endre(t => t.push(td('T')));
  sjekk('5  konflikt oppdaget og løst: både Z og T', skyTodos(), 'A,T,Z');
  sjekk('5b transaksjonen prøvde på nytt', String(sky.konflikter >= 1), 'true');
}
// ─── 6. Første oppstart etter oppgradering (uten grunnlag) ───────────────────
{
  const { tlf } = nullstill([td('A')]);                  // skyen: B er slettet et annet sted
  tlf.localStorage.setItem('lp_P_t', JSON.stringify([td('A'), td('B')]));   // gammel lokal kopi, ikke dirty
  await tlf.hent();
  sjekk('6a uten grunnlag og ikke dirty: skyen tas som den er', tlf.todos(), 'A');
  await tlf.endre(t => t.push(td('C')));
  sjekk('6b slettet B kommer ikke tilbake', skyTodos(), 'A,C');
}
// ─── 7. Køen (Siri/Claude) mens telefonen har usynkede endringer ──────────────
{
  const { tlf } = nullstill([td('A')]);
  await tlf.hent();
  sky.online = false;
  await tlf.endre(t => { t[0].fullfort = true; });        // offline
  sky.online = true;
  skrivDok('brukere/u/innboks/q1', { tekst: 'Fra Siri', prosjektId: 'P' });
  await tlf.api._tommInnboks('u');
  sjekk('7a køen: Siri-to-do og offline-avhukingen begge i skyen', skyTodos(), 'A✓,inn_q1');
  sjekk('7b køen tømt', String([...sky.docs.keys()].some(p => p.includes('innboks'))), 'false');
  sjekk('7c telefonen har begge lokalt', tlf.todos(), 'A✓,inn_q1');
}
// ─── 8. Køen kjørt to ganger (nytt forsøk) dobler ikke ───────────────────────
{
  const { tlf } = nullstill([td('A')]);
  await tlf.hent();
  skrivDok('brukere/u/innboks/q2', { tekst: 'Én gang', prosjektId: 'P' });
  sky.etterLes = async () => { skrivDok('brukere/u/prosjekter/P', { oppdatert: 'annen' }, { merge: true }); };
  await tlf.api._tommInnboks('u');
  sjekk('8  konflikt i kø-transaksjonen: to-doen finnes én gang', skyTodos(), 'A,inn_q2');
  sjekk('8b kø-transaksjonen prøvde på nytt', String(sky.konflikter >= 1), 'true');
}

console.log(feil ? `\n${feil} FEIL` : '\nAlle scenarioer OK');
process.exit(feil ? 1 : 0);
