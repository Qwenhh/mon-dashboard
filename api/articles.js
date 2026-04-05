// api/articles.js — Récupération et parsing des flux RSS
// Vercel met en cache la réponse 3 min (s-maxage=180)

const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MonDashboard/1.0)' },
  customFields: { item: [['content:encoded', 'contentFull']] },
});

// ── Sources RSS ──────────────────────────────────────────────
const SOURCES = [
  {
    id: 'vdm',
    url: 'https://www.viedemerde.fr/rss',
    category: 'fun',
    label: 'VDM',
    limit: 15,
  },
  {
    id: 'dtc',
    url: 'https://danstonchat.com/feeds/',
    category: 'fun',
    label: 'DTC',
    limit: 15,
  },
  {
    id: 'f1',
    url: 'https://www.lequipe.fr/rss/actu-hebdo_Formule-1.xml',
    category: 'f1',
    label: 'leq',
    limit: 20,
  },
  {
    id: 'biathlon',
    url: 'https://www.lequipe.fr/rss/actu-hebdo_Biathlon.xml',
    category: 'biathlon',
    label: 'leq',
    limit: 20,
  },
  {
    id: 'foot-leq',
    url: 'https://www.lequipe.fr/rss/actu-hebdo_Football.xml',
    category: 'foot',
    label: 'leq',
    limit: 15,
  },
  {
    id: 'foot-fm',
    url: 'https://www.footmercato.net/club/fc-barcelone/rss',
    category: 'foot',
    label: 'fm',
    limit: 15,
  },
];

// ── Filtrer les articles réservés aux abonnés L'Équipe ───────
function isPremium(item) {
  const title = (item.title || '').toLowerCase();
  const cats = (item.categories || []).map((c) => String(c).toLowerCase());
  return (
    title.includes('abonnés') ||
    title.includes('réservé') ||
    title.includes('🔒') ||
    cats.some((c) => c.includes('abonné') || c === 'premium')
  );
}

// ── ID stable basé sur l'URL de l'article ────────────────────
function makeId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ── Nettoyage du HTML des flux RSS ───────────────────────────
function strip(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Handler principal ─────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Cache Vercel Edge : 3 min (sport), revalidation silencieuse
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=60');

  const results = await Promise.allSettled(
    SOURCES.map(async (src) => {
      const feed = await parser.parseURL(src.url);
      return {
        category: src.category,
        items: feed.items
          .filter((item) => !isPremium(item))
          .slice(0, src.limit)
          .map((item) => ({
            id: makeId(item.link || item.guid || item.title || Math.random().toString()),
            title: strip(item.title || ''),
            link: item.link || '',
            date: item.isoDate || item.pubDate || new Date().toISOString(),
            // Pour VDM/DTC : le contenu complet est souvent dans contentFull
            content: strip(
              item.contentFull || item.contentSnippet || item.content || item.summary || ''
            ).slice(0, 800),
            source: src.id,
            label: src.label,
            category: src.category,
          })),
      };
    })
  );

  const byCategory = {};
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      console.error('Source failed:', r.reason?.message);
      continue;
    }
    const { category, items } = r.value;
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(...items);
  }

  // Tri par date décroissante dans chaque catégorie
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  res.status(200).json(byCategory);
};
