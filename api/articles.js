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
  // typeAcces et payant : champs custom L'Équipe pour détecter les articles premium
  customFields: { item: [['content:encoded', 'contentFull'], 'category', 'typeAcces', 'payant'] },
});

// ── Sources RSS ───────────────────────────────────────────────
const SOURCES = [
  {
    id: 'vdm',
    urls: ['https://www.viedemerde.fr/rss', 'https://www.viedemerde.fr/feed'],
    category: 'fun', label: 'VDM', limit: 15,
  },
  {
    id: 'dtc',
    urls: ['https://danstonchat.com/feeds/', 'https://danstonchat.com/rss'],
    category: 'fun', label: 'DTC', limit: 15,
  },
  {
    id: 'f1',
    urls: [
      'https://dwh.lequipe.fr/api/edito/rss?path=/Formule-1/',
      'AO:https://dwh.lequipe.fr/api/edito/rss?path=/Formule-1/',
      'RSSJ:https://dwh.lequipe.fr/api/edito/rss?path=/Formule-1/',
    ],
    category: 'f1', label: 'leq', limit: 20,
  },
  {
    id: 'biathlon',
    urls: [
      'https://dwh.lequipe.fr/api/edito/rss?path=/Biathlon/',
      'AO:https://dwh.lequipe.fr/api/edito/rss?path=/Biathlon/',
      'RSSJ:https://dwh.lequipe.fr/api/edito/rss?path=/Biathlon/',
    ],
    category: 'biathlon', label: 'leq', limit: 20,
  },
  {
    id: 'foot-leq',
    urls: [
      'https://dwh.lequipe.fr/api/edito/rss?path=/Football/',
      'AO:https://dwh.lequipe.fr/api/edito/rss?path=/Football/',
      'RSSJ:https://dwh.lequipe.fr/api/edito/rss?path=/Football/',
    ],
    category: 'foot', label: 'leq', limit: 25,
  },
  {
    id: 'foot-fm',
    // Footmercato n'a pas de feed par club — on utilise le flux général et on filtre côté serveur
    urls: [
      'https://www.footmercato.net/flux-rss',
      'AO:https://www.footmercato.net/flux-rss',
      'RSSJ:https://www.footmercato.net/flux-rss',
    ],
    category: 'foot', label: 'fm', limit: 15,
    // Filtre : ne garder que les articles mentionnant le Barça
    filter: (item) => {
      const t = (item.title || '').toLowerCase();
      const l = (item.link  || '').toLowerCase();
      return t.includes('barca') || t.includes('barcelon') || l.includes('barca') || l.includes('barcelon');
    },
  },
];

// ── Filtre articles abonnés L'Équipe ──────────────────────────
// Vérification terrain : les articles premium dans le RSS L'Équipe ont une description
// VIDE (uniquement une image CDATA, aucun texte). Les articles gratuits ont toujours
// un extrait texte. C'est le seul marqueur fiable dans ce flux.
function isPremium(item, sourceId) {
  // Pour les sources non-L'Équipe, pas de filtre premium
  if (sourceId && !sourceId.startsWith('f1') && !sourceId.startsWith('biathlon') && !sourceId.startsWith('foot-leq')) {
    return false;
  }
  // Description vide = article réservé aux abonnés
  const snippet = (item.contentSnippet || '').trim();
  const content = (item.contentFull    || '').trim();
  const hasText = snippet.length > 10 || content.replace(/<[^>]+>/g, '').trim().length > 10;
  if (!hasText) return true;

  // Sécurité : patterns explicites au cas où L'Équipe change son format
  const title = (item.title || '').toLowerCase();
  const cats  = (item.categories || []).map((c) => String(c).toLowerCase());
  return (
    title.includes('abonnés') || title.includes('[abonné') ||
    title.includes('réservé') || title.includes('🔒') ||
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

// ── Correction XML malformé (& non échappés — bug L'Équipe F1) ─
function fixXml(xml) {
  return xml.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
}

// ── Headers pour fetch direct ─────────────────────────────────
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

// ── Proxy 1 : allorigins.win (IP différente de Vercel) ───────
async function fetchViaAllOrigins(rssUrl) {
  const api = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
  const res = await fetch(api, { signal: AbortSignal.timeout(12000) });
  const data = await res.json();
  if (!data.contents || data.contents.length < 100) throw new Error('allorigins: contenu vide');
  // fixXml corrige les & non échappés (bug connu flux L'Équipe F1)
  const feed = await parser.parseString(fixXml(data.contents));
  console.log(`✓ allorigins → ${rssUrl} (${feed.items.length} items)`);
  return feed.items;
}

// ── Proxy 2 : rss2json ────────────────────────────────────────
async function fetchViaRss2Json(rssUrl, limit) {
  const api = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=${limit}`;
  const res = await fetch(api, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(`rss2json: ${data.message || 'error'}`);
  return data.items.map((item) => ({
    title: item.title || '',
    link: item.link || '',
    isoDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    contentSnippet: strip(item.description || ''),
    categories: item.categories || [],
  }));
}

// ── Essaie chaque URL jusqu'à ce qu'une fonctionne ───────────
// Préfixes spéciaux :
//   "AO:"   → proxy allorigins.win
//   "RSSJ:" → proxy rss2json
async function fetchSource(src) {
  let lastError;
  for (const url of src.urls) {
    try {
      let rawItems;
      if (url.startsWith('AO:')) {
        rawItems = await fetchViaAllOrigins(url.slice(3));
      } else if (url.startsWith('RSSJ:')) {
        rawItems = await fetchViaRss2Json(url.slice(5), src.limit);
      } else {
        // Fetch direct avec fixXml pour corriger le XML malformé
        const rawRes = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });
        if (!rawRes.ok) throw new Error(`HTTP ${rawRes.status}`);
        const rawXml = await rawRes.text();
        const feed = await parser.parseString(fixXml(rawXml));
        rawItems = feed.items;
        console.log(`✓ ${src.id} → ${url} (${rawItems.length} items)`);
      }
      return {
        category: src.category,
        items: rawItems
          .filter((item) => !isPremium(item, src.id))
          .filter((item) => !src.filter || src.filter(item))
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
