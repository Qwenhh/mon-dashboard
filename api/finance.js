// api/finance.js — Proxy Yahoo Finance (contourne les restrictions CORS)
// Utilise des données horaires sur 2 jours pour calculer le % depuis minuit Paris
// (Yahoo previousClose = minuit UTC → décalage de 1-2h vs Google qui utilise minuit local)

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Paramètre ticker manquant' });

  try {
    // interval=1h + range=2d pour avoir suffisamment de points autour de minuit Paris
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=2d&interval=1h&includePrePost=false`;

    const yahooRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!yahooRes.ok) throw new Error(`Yahoo Finance a retourné HTTP ${yahooRes.status}`);

    const data = await yahooRes.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('Aucun résultat pour ce ticker');

    const meta   = result.meta;
    const price  = meta.regularMarketPrice;

    // ── Calcul du timestamp minuit Paris (gère CET/CEST automatiquement) ──
    const now  = new Date();
    const fmt  = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const secondsSinceMidnightParis = parts.hour * 3600 + parts.minute * 60 + parts.second;
    const midnightParisUnix = Math.floor(now.getTime() / 1000) - secondsSinceMidnightParis;

    // ── Cherche le cours le plus proche de minuit Paris dans les données horaires ──
    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];
    let bestIdx = -1, bestDiff = Infinity;
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      const diff = Math.abs(timestamps[i] - midnightParisUnix);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }

    // Fallback sur previousClose si pas de données horaires
    const prev = bestIdx >= 0 ? closes[bestIdx] : (meta.previousClose ?? meta.chartPreviousClose);

    return res.status(200).json({
      ticker,
      price,
      prev,
      change: prev ? ((price - prev) / prev) * 100 : null,
      currency: meta.currency,
      name: meta.longName || meta.shortName || ticker,
      marketState: meta.marketState,
    });
  } catch (err) {
    console.error(`Finance error for ${ticker}:`, err.message);
    return res.status(502).json({ error: err.message });
  }
};
