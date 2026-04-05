// api/finance.js — Proxy Yahoo Finance (contourne les restrictions CORS)
// Appelé par le frontend : /api/finance?ticker=IWDA.AS

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const { ticker } = req.query;
  if (!ticker) {
    return res.status(400).json({ error: 'Paramètre ticker manquant' });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d&includePrePost=false`;

    const yahooRes = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!yahooRes.ok) {
      throw new Error(`Yahoo Finance a retourné HTTP ${yahooRes.status}`);
    }

    const data = await yahooRes.json();
    const result = data.chart?.result?.[0];

    if (!result) {
      throw new Error('Aucun résultat pour ce ticker');
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose ?? meta.chartPreviousClose;

    return res.status(200).json({
      ticker,
      price,
      prev,
      change: prev ? ((price - prev) / prev) * 100 : null,
      currency: meta.currency,
      name: meta.longName || meta.shortName || ticker,
      marketState: meta.marketState, // REGULAR, PRE, POST, CLOSED
    });
  } catch (err) {
    console.error(`Finance error for ${ticker}:`, err.message);
    return res.status(502).json({ error: err.message });
  }
};
