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
      'AO:https://www.lequipe.fr/rss/actu-hebdo_Formule-1.xml',
      'RSSJ:https://www.lequipe.fr/rss/actu-hebdo_Formule-1.xml',
      'AO:https://www.l
