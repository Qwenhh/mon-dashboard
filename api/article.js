// api/article.js — Extrait le contenu d'un article Footmercato
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\s+/g, ' ').trim();
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '));
}

function extractArticle(html) {
  // Supprimer scripts, styles, commentaires, blocs pub
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div[^>]*class="[^"]*adWrapper[^"]*"[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*taboola[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*id="disqus_thread"[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*class="[^"]*sideArticles[^"]*"[\s\S]*?<\/div>/gi, '');

  // Titre
  const titleMatch = clean.match(/<h1[^>]*class="[^"]*heroHeader__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  // Chapeau
  const leadMatch = clean.match(/<(?:h2|p)[^>]*class="[^"]*articleLead[^"]*"[^>]*>([\s\S]*?)<\/(?:h2|p)>/i);
  const lead = leadMatch ? stripTags(leadMatch[1]) : '';

  // Contenu principal : trouver le div.main
  const mainStart = clean.search(/<div[^>]*class="(?:[^"]*\s)?main(?:\s[^"]*)?"/i);
  let body = '';

  if (mainStart !== -1) {
    // Prendre un slice suffisant après le début de .main
    const slice = clean.slice(mainStart, mainStart + 60000);

    const parts = [];
    const tagRe = /<(p|h3)(?:\s[^>]*)?>([^]*?)<\/\1>/gi;
    let m;
    while ((m = tagRe.exec(slice)) !== null) {
      const text = stripTags(m[2]);
      if (!text || text.length < 10) continue;
      if (/la suite après cette publicité/i.test(text)) continue;
      if (/abonnez-vous/i.test(text) && text.length < 60) continue;
      if (/publicité/i.test(text) && text.length < 40) continue;
      // Marqueurs de fin d'article — tout ce qui suit est recommandations/pub
      if (/en savoir plus/i.test(text) && text.length < 50) break;
      if (/articles recommandés/i.test(text) && text.length < 50) break;
      if (/sur le même sujet/i.test(text) && text.length < 50) break;

      parts.push(m[1].toLowerCase() === 'h3' ? `**${text}**` : text);
    }
    body = parts.join('\n\n');
  }

  return { title, lead, body };
}

module.exports = async function handler(req, res) {
  const { url } = req.query;

  if (!url || !url.startsWith('https://www.footmercato.net/')) {
    return res.status(400).json({ error: 'URL invalide — seules les URLs footmercato.net sont acceptées' });
  }

  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    const article = extractArticle(html);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(article);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
