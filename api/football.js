// api/football.js — Scores et matchs d'une équipe, toutes compétitions confondues
// Source principale : ESPN (gratuit, sans clé) — couvre championnat, coupes d'Europe, sélections
// Secours : football-data.org (clé FOOTBALL_DATA_KEY) — championnat + Ligue des champions seulement
const TEAMS = {
  monaco: { espn: 174, fd: 548 },
  barce:  { espn: 83,  fd: 81  },
  france: { espn: 478, fd: 773 },
};
const HOW_MANY = 2; // nombre de derniers résultats / prochains matchs affichés

const FR_NAMES = {
  Italy: 'Italie', Belgium: 'Belgique', 'Türkiye': 'Turquie', Turkey: 'Turquie', Spain: 'Espagne',
  England: 'Angleterre', Germany: 'Allemagne', Netherlands: 'Pays-Bas', Switzerland: 'Suisse',
  Croatia: 'Croatie', Portugal: 'Portugal', Ukraine: 'Ukraine', Iceland: 'Islande',
  Azerbaijan: 'Azerbaïdjan', Norway: 'Norvège', Sweden: 'Suède', Denmark: 'Danemark',
  Poland: 'Pologne', Austria: 'Autriche', Scotland: 'Écosse', Wales: 'Pays de Galles',
  Brazil: 'Brésil', Morocco: 'Maroc', Senegal: 'Sénégal', 'Ivory Coast': "Côte d'Ivoire",
};
const frName = (n) => FR_NAMES[n] || n;

function cleanCompetition(name = '') {
  return name
    .replace(/^French\s+/i, '').replace(/^Spanish\s+/i, '')
    .replace(/LALIGA/i, 'LaLiga')
    .replace(/\s+\d{4}-\d{2,4}$/, '')
    .trim();
}

// ── ESPN ──────────────────────────────────────────────────────
function mapEspnEvent(e, teamId) {
  const c = e.competitions?.[0];
  if (!c) return null;
  const me  = c.competitors.find((x) => String(x.team?.id) === String(teamId));
  const opp = c.competitors.find((x) => String(x.team?.id) !== String(teamId));
  if (!me || !opp) return null;
  const score = (x) => {
    const v = x.score?.displayValue ?? x.score?.value ?? x.score;
    return v === undefined || v === null || v === '' ? null : Number(v);
  };
  return {
    isHome: me.homeAway === 'home',
    opponent: frName(opp.team?.shortDisplayName || opp.team?.displayName || '?'),
    myScore: score(me),
    oppScore: score(opp),
    utcDate: e.date || c.date || null,
    competition: cleanCompetition(e.league?.name || e.league?.abbreviation || e.seasonType?.name || ''),
    state: c.status?.type?.state || 'pre',        // pre | in | post
    clock: c.status?.displayClock || null,
    shootout: /PEN/i.test(c.status?.type?.name || ''),
  };
}

async function fromEspn(teamId) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/${teamId}/schedule`;
  const opts = { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } };
  const [pastRes, nextRes] = await Promise.all([fetch(base, opts), fetch(base + '?fixture=true', opts)]);
  if (!pastRes.ok || !nextRes.ok) throw new Error(`ESPN HTTP ${pastRes.status}/${nextRes.status}`);
  const [past, next] = await Promise.all([pastRes.json(), nextRes.json()]);

  const byDate = (a, b) => new Date(a.utcDate) - new Date(b.utcDate);
  const done = (past.events || []).map((e) => mapEspnEvent(e, teamId)).filter(Boolean)
    .filter((m) => m.state === 'post').sort(byDate);
  const upcoming = (next.events || []).map((e) => mapEspnEvent(e, teamId)).filter(Boolean).sort(byDate);

  const live = upcoming.find((m) => m.state === 'in') || null;
  return {
    live,
    last: done.slice(-HOW_MANY).reverse(),                                   // le plus récent d'abord
    next: upcoming.filter((m) => m.state === 'pre').slice(0, HOW_MANY),
  };
}

// ── football-data.org (secours) ───────────────────────────────
async function fromFootballData(fdId) {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_KEY manquante');
  const headers = { 'X-Auth-Token': key };
  const BASE = 'https://api.football-data.org/v4';
  const map = (m) => {
    const isHome = Number(m.homeTeam?.id) === Number(fdId);
    const my = isHome ? m.score?.fullTime?.home : m.score?.fullTime?.away;
    const op = isHome ? m.score?.fullTime?.away : m.score?.fullTime?.home;
    return {
      isHome,
      opponent: isHome ? (m.awayTeam?.shortName || m.awayTeam?.name || '?') : (m.homeTeam?.shortName || m.homeTeam?.name || '?'),
      myScore: my ?? null, oppScore: op ?? null,
      utcDate: m.utcDate || null,
      competition: m.competition?.name || '',
      state: m.status === 'FINISHED' ? 'post' : 'pre',
    };
  };
  const [lastRes, nextRes] = await Promise.all([
    fetch(`${BASE}/teams/${fdId}/matches?status=FINISHED&limit=10`, { headers, signal: AbortSignal.timeout(8000) }),
    fetch(`${BASE}/teams/${fdId}/matches?status=SCHEDULED&limit=${HOW_MANY}`, { headers, signal: AbortSignal.timeout(8000) }),
  ]);
  if (!lastRes.ok || !nextRes.ok) throw new Error(`football-data HTTP ${lastRes.status}/${nextRes.status}`);
  const [lastData, nextData] = await Promise.all([lastRes.json(), nextRes.json()]);
  return {
    live: null,
    last: (lastData.matches || []).slice(-HOW_MANY).reverse().map(map),
    next: (nextData.matches || []).slice(0, HOW_MANY).map(map),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const cfg = TEAMS[req.query.team];
  if (!cfg) return res.status(400).json({ error: `Équipe inconnue: ${req.query.team}` });

  try {
    const data = await fromEspn(cfg.espn);
    return res.status(200).json({ source: 'espn', ...data });
  } catch (e) {
    console.warn('ESPN indisponible, bascule sur football-data:', e.message);
  }
  try {
    const data = await fromFootballData(cfg.fd);
    return res.status(200).json({ source: 'football-data', ...data });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: e.message });
  }
};
