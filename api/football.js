// api/football.js — Scores et matchs via football-data.org
// Free tier : 10 req/min, couvre L1 (Monaco) et PD/CL (Barça)
// Cache 5min → bien en dessous de la limite
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const { team } = req.query;
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return res.status(500).json({ error: 'FOOTBALL_DATA_KEY manquante dans Vercel' });

  const TEAMS = {
    monaco: { id: 548 },
    barce:  { id: 81  },
    france: { id: 773 },
  };

  const cfg = TEAMS[team];
  if (!cfg) return res.status(400).json({ error: `Équipe inconnue: ${team}` });

  const headers  = { 'X-Auth-Token': key };
  const BASE     = 'https://api.football-data.org/v4';
  const teamId   = cfg.id;

  function computeMatchInfo(match) {
    const isHome = Number(match.homeTeam?.id) === Number(teamId);
    return {
      isHome,
      opponent   : isHome ? (match.awayTeam?.shortName || match.awayTeam?.name || '?') : (match.homeTeam?.shortName || match.homeTeam?.name || '?'),
      myScore    : isHome ? (match.score?.fullTime?.home ?? null) : (match.score?.fullTime?.away ?? null),
      oppScore   : isHome ? (match.score?.fullTime?.away ?? null) : (match.score?.fullTime?.home ?? null),
      utcDate    : match.utcDate || null,
      competition: match.competition?.name || '',
    };
  }

  try {
    const [lastRes, nextRes] = await Promise.all([
      fetch(`${BASE}/teams/${teamId}/matches?status=FINISHED&limit=5`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${BASE}/teams/${teamId}/matches?status=SCHEDULED&limit=1`, { headers, signal: AbortSignal.timeout(8000) }),
    ]);

    // Si rate limit → on ne met pas en cache pour réessayer vite
    if (lastRes.status === 429 || nextRes.status === 429) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(429).json({ error: 'Rate limit football-data.org — réessaie dans une minute.' });
    }

    const [lastData, nextData] = await Promise.all([lastRes.json(), nextRes.json()]);

    const lastMatches = lastData.matches || [];
    const nextMatches = nextData.matches || [];

    // FINISHED : football-data renvoie en ordre chronologique → le plus récent est à la fin
    const lastMatch = lastMatches.length ? lastMatches[lastMatches.length - 1] : null;
    // SCHEDULED : le plus proche est en premier
    const nextMatch = nextMatches.length ? nextMatches[0] : null;

    res.status(200).json({
      teamId,
      last: lastMatch ? computeMatchInfo(lastMatch) : null,
      next: nextMatch ? computeMatchInfo(nextMatch) : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
