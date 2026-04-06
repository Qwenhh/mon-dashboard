// api/football.js — Scores et matchs via football-data.org
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const { team } = req.query;
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return res.status(500).json({ error: 'FOOTBALL_DATA_KEY manquante dans Vercel' });

  // Pour chaque équipe : liste de compétitions à essayer pour trouver l'ID
  // (Reims peut être en D2 si relégué, Barça peut aussi jouer CL)
  const TEAMS = {
    monaco: { competitions: ['FL1'],       search: 'Monaco'    },
    barce:  { competitions: ['PD', 'CL'],  search: 'Barcelona' },
    reims:  { competitions: ['FL1', 'D2'], search: 'Reims'     },
  };

  const cfg = TEAMS[team];
  if (!cfg) return res.status(400).json({ error: `Équipe inconnue: ${team}` });

  const headers = { 'X-Auth-Token': key };

  // ── Calcule côté serveur les infos à afficher ──────────────────
  function computeMatchInfo(match, teamId) {
    const isHome = Number(match.homeTeam?.id) === Number(teamId);
    return {
      isHome,
      opponent : isHome
        ? (match.awayTeam?.shortName || match.awayTeam?.name || '?')
        : (match.homeTeam?.shortName || match.homeTeam?.name || '?'),
      myScore  : isHome ? (match.score?.fullTime?.home ?? null) : (match.score?.fullTime?.away ?? null),
      oppScore : isHome ? (match.score?.fullTime?.away ?? null) : (match.score?.fullTime?.home ?? null),
      utcDate  : match.utcDate || null,
      competition: match.competition?.name || '',
    };
  }

  try {
    // 1. Trouver l'ID de l'équipe (essaie chaque compétition jusqu'au succès)
    let teamId = null;
    for (const competition of cfg.competitions) {
      try {
        const teamsRes = await fetch(
          `https://api.football-data.org/v4/competitions/${competition}/teams`,
          { headers, signal: AbortSignal.timeout(8000) }
        );
        if (!teamsRes.ok) continue;
        const teamsData = await teamsRes.json();
        const found = (teamsData.teams || []).find(t =>
          (t.name      || '').toLowerCase().includes(cfg.search.toLowerCase()) ||
          (t.shortName || '').toLowerCase().includes(cfg.search.toLowerCase())
        );
        if (found) { teamId = found.id; break; }
      } catch { /* essaie la compétition suivante */ }
    }

    if (!teamId) {
      return res.status(404).json({ error: `${cfg.search} introuvable dans les compétitions ${cfg.competitions.join(', ')}` });
    }

    // 2. Dernier match terminé + prochain match (toutes compétitions confondues)
    //    limit=5 pour avoir la bonne direction de tri (asc par date)
    const [lastRes, nextRes] = await Promise.all([
      fetch(
        `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=5`,
        { headers, signal: AbortSignal.timeout(8000) }
      ),
      fetch(
        `https://api.football-data.org/v4/teams/${teamId}/matches?status=SCHEDULED&limit=1`,
        { headers, signal: AbortSignal.timeout(8000) }
      ),
    ]);
    const [lastData, nextData] = await Promise.all([lastRes.json(), nextRes.json()]);

    // Les matchs FINISHED sont triés par date ASC → on prend le dernier du tableau
    const lastMatches = lastData.matches || [];
    const lastMatch   = lastMatches.length ? lastMatches[lastMatches.length - 1] : null;
    const nextMatch   = (nextData.matches || [])[0] || null;

    res.status(200).json({
      teamId,
      last: lastMatch ? computeMatchInfo(lastMatch, teamId) : null,
      next: nextMatch ? computeMatchInfo(nextMatch, teamId) : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
