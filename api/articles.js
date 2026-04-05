// api/articles.js — Récupération et parsing des flux RSS
const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  },
  customFields: { item: [['content:encoded', 'contentFull'], 'category'] },
});

// ── Sources RSS avec URLs alternatives (fallback) ─────────────
const SOURCES = [
  {
    id: 'vdm',
    urls: [
      'https://www.viedemerde.fr/rss',
      'https://www.viedemerde.fr/feed',
    ],
    category: 'fun',
    label: 'VDM',
    limit: 15,
  },
  {
    id: 'dtc',
    urls: [
      'https://danstonchat.com/feeds/',
      'https://danstonchat.com/rss',
      'https://danstonchat.com/feed',
    ],
    category: 'fun',
    label: 'DTC',
    limit: 15,
  },
  {
    id: 'f1',
    urls: [
      'https://www.lequipe.fr/rss/actu-hebdo_Formule-1.xml',
      'https://www.lequipe.fr/Xml/Formule1/Titres/actu_rss.xml',
      'https://www.lequipe.fr/Xml/actu_rss_Formule-1.xml',
      // Fallback Google News si L'Équipe bloque le serveur
      'https://news.google.com/rss/search?q=formule+1+source:lequipe.fr&hl=fr&gl=FR&ceid=FR:fr',
      'https://news.google.com/rss/search?q=formule+1+F1&hl=fr&gl=FR&ceid=FR:fr',
    ],
    category: 'f1',
    label: 'leq',
    limit: 20,
  },
  {
    id: 'biathlon',
    urls: [
      'https://www.lequipe.fr/rss/actu-hebdo_Biathlon.xml',
      'https://www.lequipe.fr/Xml/Biathlon/Titres/actu_rss.xml',
      'https://www.lequipe.fr/Xml/actu_rss_Biathlon.xml',
      // Fallback Google News
      'https://news.google.com/rss/search?q=biathlon+coupe+du+monde&hl=fr&gl=FR&ceid=FR:fr',
    ],
    category: 'biathlon',
    label: 'leq',
    limit: 20,
  },
  {
    id: 'foot-leq',
    urls: [
      'https://www.lequipe.fr/rss/actu-hebdo_Football.xml',
      'https://www.lequipe.fr/Xml/Football/Titres/actu_rss.xml',
      'https://www.lequipe.fr/Xml/actu_rss_Football.xml',
      // Fallback Google News
      'https://news.google.com/rss/search?q=football+ligue+1+champions+league&hl=fr&gl=FR&ceid=FR:fr',
    ],
    category: 'foot',
    label: 'leq',
    limit: 15,
  },
  {
    id: 'foot-fm',
    urls: [
      'https://www.footmercato.net/club/fc-barcelone/rss',
      'https://www.footmercato.net/club/rss-fc-barcelone/',
      'https://www.footmercato.net/flux-rss/club/fc-barcelone',
      'https://www.footmercato.net/rss.xml',
      // Fallback Google News Barça
      'https://news.google.com/rss/search?q=fc+barcelone+mercato+transfert&hl=fr&gl=FR&ceid=FR:fr',
    ],
    category: 'foot',
    label: 'fm',
    limit: 15,
  },
];

// ── Filtre articles abonnés L'Équipe ──────────────────────────
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

// ── ID stable ─────────────────────────────────────────────────
function makeId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

// ── Nettoyage HTML ────────────────────────────────────────────
function strip(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// ── Essaie chaque URL jusqu'à ce qu'une fonctionne ───────────
async function fetchSource(src) {
  let lastError;
  for (const url of src.urls) {
    try {
      const feed = await parser.parseURL(url);
      console.log(`✓ ${src.id} → ${url} (${feed.items.length} items)`);
      return {
        category: src.category,
        items: feed.items
          .filter((item) => !isPremium(item))
          .slice(0, src.limit)
          .map((item) => ({
            id: makeId(item.link || item.guid || item.title || String(Math.random())),
            title: strip(item.title || ''),
            link: item.link || '',
            date: item.isoDate || item.pubDate || new Date().toISOString(),
            content: strip(
              item.contentFull || item.contentSnippet || item.content || item.summary || ''
            ).slice(0, 800),
            source: src.id,
            label: src.label,
            category: src.category,
          })),
      };
    } catch (e) {
      console.warn(`✗ ${src.id} → ${url}: ${e.message}`);
      lastError = e;
    }
  }
  throw lastError || new Error(`Toutes les URLs ont échoué pour ${src.id}`);
}

// ── Handler ───────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=60');

  const results = await Promise.allSettled(SOURCES.map(fetchSource));

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

  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // Toujours renvoyer toutes les catégories même vides
  ['fun', 'f1', 'biathlon', 'foot'].forEach(cat => {
    if (!byCategory[cat]) byCategory[cat] = [];
  });

  res.status(200).json(byCategory);
};
