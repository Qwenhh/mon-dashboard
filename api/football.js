// api/football.js — Scores et matchs via football-data.org
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const { team } = req.query;
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return res.status(500).json({ error: 'FOOTBALL_DATA_KEY manquante dans Vercel' });

  // Compétition + mot-clé de recherche par équipe
  const TEAMS = {
    monaco: { competition: 'FL1', search: 'Monaco' },
    barce:  { competition: 'PD',  search: 'Barcelona' },
    reims:  { competition: 'FL1', search: 'Reims' },
  };

  const cfg = TEAMS[team];
  if (!cfg) return res.status(400).json({ error: `Équipe inconnue: ${team}` });

  const headers = { 'X-Auth-Token': key };

  try {
    // 1. Trouver l'ID de l'équipe dans sa compétition (évite les IDs hardcodés)
    const teamsRes = await fetch(
      `https://api.football-data.org/v4/competitions/${cfg.competition}/teams`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    const teamsData = await teamsRes.json();
    const found = (teamsData.teams || []).find(t =>
      (t.name || '').toLowerCase().includes(cfg.search.toLowerCase()) ||
      (t.shortName || '').toLowerCase().includes(cfg.search.toLowerCase())
    );
    if (!found) return res.status(404).json({ error: `${cfg.search} introuvable dans ${cfg.competition}` });

    const teamId = found.id;

    // 2. Dernier match terminé + prochain match en parallèle
    const [lastRes, nextRes] = await Promise.all([
      fetch(`https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=1`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`https://api.football-data.org/v4/teams/${teamId}/matches?status=SCHEDULED&limit=1`, { headers, signal: AbortSignal.timeout(8000) }),
    ]);
    const [lastData, nextData] = await Promise.all([lastRes.json(), nextRes.json()]);

    res.status(200).json({
      teamId,
      last: lastData.matches?.[0] || null,
      next: nextData.matches?.[0] || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
