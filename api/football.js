// api/football.js — Scores et matchs via api-football.com (api-sports.io)
// Free tier : pas de param last/next → on filtre par plage de dates
// Cache 2h → 3 équipes × 2 calls × 12 = 72 req/jour (< 100 limit)
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=300');

  const { team } = req.query;
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return res.status(500).json({ error: 'API_FOOTBALL_KEY manquante dans Vercel' });

  const TEAMS = {
    monaco: { id: 91  },
    barce:  { id: 529 },
    reims:  { id: 97  },
  };

  const cfg = TEAMS[team];
  if (!cfg) return res.status(400).json({ error: `Équipe inconnue: ${team}` });

  const headers = { 'x-apisports-key': key };
  const BASE    = 'https://v3.football.api-sports.io';
  const teamId  = cfg.id;

  // Saison courante : août = début de saison
  const now    = new Date();
  const season = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;

  // Plages de dates
  const fmt = (d) => d.toISOString().split('T')[0];
  const today     = fmt(now);
  const past60    = fmt(new Date(now - 60 * 864e5));
  const future60  = fmt(new Date(now + 60 * 864e5));

  function computeMatchInfo(fixture) {
    const isHome = Number(fixture.teams?.home?.id) === Number(teamId);
    return {
      isHome,
      opponent   : isHome ? (fixture.teams?.away?.name || '?') : (fixture.teams?.home?.name || '?'),
      myScore    : isHome ? (fixture.goals?.home ?? null) : (fixture.goals?.away ?? null),
      oppScore   : isHome ? (fixture.goals?.away ?? null) : (fixture.goals?.home ?? null),
      utcDate    : fixture.fixture?.date || null,
      competition: fixture.league?.name || '',
    };
  }

  try {
    const [lastRes, nextRes] = await Promise.all([
      // Matchs terminés des 60 derniers jours
      fetch(`${BASE}/fixtures?team=${teamId}&season=${season}&status=FT&from=${past60}&to=${today}`, { headers, signal: AbortSignal.timeout(8000) }),
      // Matchs à venir dans les 60 prochains jours
      fetch(`${BASE}/fixtures?team=${teamId}&season=${season}&from=${today}&to=${future60}`, { headers, signal: AbortSignal.timeout(8000) }),
    ]);

    const [lastData, nextData] = await Promise.all([lastRes.json(), nextRes.json()]);

    const lastFixtures = lastData.response || [];
    const nextFixtures = (nextData.response || []).filter(f =>
      ['NS', 'TBD', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'].includes(f.fixture?.status?.short)
    );

    // Dernier match joué = dernier de la liste triée par date
    const lastFixture = lastFixtures.length ? lastFixtures[lastFixtures.length - 1] : null;
    // Prochain match = premier à venir
    const nextFixture = nextFixtures.length ? nextFixtures[0] : null;

    res.status(200).json({
      teamId,
      last: lastFixture ? computeMatchInfo(lastFixture) : null,
      next: nextFixture ? computeMatchInfo(nextFixture) : null,
      _debug: {
        season,
        past60, today, future60,
        lastErrors: lastData.errors,
        lastResults: lastData.results,
        nextErrors: nextData.errors,
        nextResults: nextData.results,
        lastSample: lastFixtures.slice(-2).map(f => ({ date: f.fixture?.date, status: f.fixture?.status?.short })),
        nextSample: nextFixtures.slice(0, 2).map(f => ({ date: f.fixture?.date, status: f.fixture?.status?.short })),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
