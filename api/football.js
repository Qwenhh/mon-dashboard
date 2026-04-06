// api/football.js — Scores et matchs via api-football.com (api-sports.io)
// Couvre toutes compétitions dont Ligue 2 (Reims)
// Free tier : 100 req/jour → cache 2h → 3 équipes × 2 calls × 12 = 72 req/jour
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=300');

  const { team } = req.query;
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return res.status(500).json({ error: 'API_FOOTBALL_KEY manquante dans Vercel' });

  // IDs api-football.com (api-sports.io)
  const TEAMS = {
    monaco: { id: 91  },
    barce:  { id: 529 },
    reims:  { id: 97  },
  };

  const cfg = TEAMS[team];
  if (!cfg) return res.status(400).json({ error: `Équipe inconnue: ${team}` });

  const headers = {
    'x-apisports-key': key,
    'x-rapidapi-host': 'v3.football.api-sports.io',
  };
  const BASE = 'https://v3.football.api-sports.io';
  const teamId = cfg.id;

  // ── Calcule côté serveur les infos à afficher ──────────────────
  function computeMatchInfo(fixture) {
    const isHome = Number(fixture.teams?.home?.id) === Number(teamId);
    return {
      isHome,
      opponent   : isHome
        ? (fixture.teams?.away?.name || '?')
        : (fixture.teams?.home?.name || '?'),
      myScore    : isHome ? (fixture.goals?.home ?? null) : (fixture.goals?.away ?? null),
      oppScore   : isHome ? (fixture.goals?.away ?? null) : (fixture.goals?.home ?? null),
      utcDate    : fixture.fixture?.date || null,
      competition: fixture.league?.name || '',
    };
  }

  try {
    // 2 appels par équipe (last match + next match)
    const [lastRes, nextRes] = await Promise.all([
      fetch(`${BASE}/fixtures?team=${teamId}&last=5`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${BASE}/fixtures?team=${teamId}&next=1`, { headers, signal: AbortSignal.timeout(8000) }),
    ]);

    if (!lastRes.ok) {
      const err = await lastRes.json().catch(() => ({}));
      return res.status(lastRes.status).json({ error: err.message || `API error ${lastRes.status}` });
    }

    const [lastData, nextData] = await Promise.all([lastRes.json(), nextRes.json()]);

    const lastFixtures = lastData.response || [];
    const lastFixture  = lastFixtures.length ? lastFixtures[lastFixtures.length - 1] : null;
    const nextFixture  = (nextData.response || [])[0] || null;

    res.status(200).json({
      teamId,
      last: lastFixture ? computeMatchInfo(lastFixture) : null,
      next: nextFixture ? computeMatchInfo(nextFixture) : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
