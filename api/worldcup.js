// api/worldcup.js — Matchs Coupe du Monde 2026 via football-data.org
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=30');

  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return res.status(500).json({ error: 'FOOTBALL_DATA_KEY manquante' });

  // Fenêtre : hier → dans 3 jours
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 2);
  const to   = new Date(now); to.setDate(to.getDate() + 7);
  const fmt  = d => d.toISOString().split('T')[0];

  const url = `https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${fmt(from)}&dateTo=${fmt(to)}&limit=100`;

  try {
    const r = await fetch(url, {
      headers: { 'X-Auth-Token': key },
      signal: AbortSignal.timeout(8000),
    });

    if (r.status === 429) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(429).json({ error: 'Rate limit — réessaie dans une minute.' });
    }
    if (!r.ok) return res.status(r.status).json({ error: `football-data: HTTP ${r.status}` });

    const data = await r.json();
    const matches = (data.matches || []).map(m => ({
      id:       m.id,
      utcDate:  m.utcDate,
      status:   m.status,           // SCHEDULED | IN_PLAY | PAUSED | FINISHED
      home:     m.homeTeam?.shortName || m.homeTeam?.name || '?',
      away:     m.awayTeam?.shortName || m.awayTeam?.name || '?',
      homeCrest: m.homeTeam?.crest || null,
      awayCrest: m.awayTeam?.crest || null,
      scoreHome: m.score?.fullTime?.home ?? null,
      scoreAway: m.score?.fullTime?.away ?? null,
      stage:    m.stage || '',
      group:    m.group || null,
    }));

    res.status(200).json({ matches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
