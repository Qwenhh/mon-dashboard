// api/read.js — Gestion des articles lus (Supabase)
// GET  /api/read          → liste des IDs lus
// POST /api/read          → marquer/démarquer un article

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Variables SUPABASE_URL et SUPABASE_SERVICE_KEY manquantes');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async function handler(req, res) {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // ── GET : récupérer tous les IDs lus ──
  if (req.method === 'GET') {
    const allIds = [];
    const PAGE = 1000;
    let page = 0;

    while (page < 20) { // sécurité : max 20 000 IDs
      const { data, error } = await supabase
        .from('read_articles')
        .select('article_id')
        .range(page * PAGE, (page + 1) * PAGE - 1);

      if (error) return res.status(500).json({ error: error.message });
      if (!data || data.length === 0) break;

      allIds.push(...data.map((row) => row.article_id));
      if (data.length < PAGE) break;
      page++;
    }

    return res.status(200).json({ read: allIds });
  }

  // ── POST : marquer ou démarquer un article ───────────────────
  if (req.method === 'POST') {
    const { articleId, action, visible } = req.body || {};

    // ── Nettoyage : supprime les IDs lus dont l'article n'est plus dans aucun flux ──
    // `visible` = IDs de tous les articles actuellement affichés par le dashboard.
    // Sécurités : marge de 3 jours (un autre appareil peut avoir un flux plus ancien),
    // liste de taille plausible, et expiration dure à 45 jours quoi qu'il arrive.
    if (action === 'prune') {
      const ids = Array.isArray(visible) ? visible.filter((v) => typeof v === 'string' && /^[a-z0-9]+$/.test(v)) : [];
      const DAY = 24 * 3600 * 1000;
      const hard = await supabase.from('read_articles').delete()
        .lt('marked_at', new Date(Date.now() - 45 * DAY).toISOString());
      if (hard.error) return res.status(500).json({ error: hard.error.message });

      if (ids.length < 20 || ids.length > 800) {
        return res.status(200).json({ ok: true, pruned: false, reason: 'liste visible non plausible' });
      }
      const { error } = await supabase.from('read_articles').delete()
        .lt('marked_at', new Date(Date.now() - 3 * DAY).toISOString())
        .not('article_id', 'in', `(${ids.join(',')})`);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, pruned: true });
    }

    if (!articleId) {
      return res.status(400).json({ error: 'articleId manquant' });
    }

    if (action === 'unmark') {
      const { error } = await supabase
        .from('read_articles')
        .delete()
        .eq('article_id', articleId);

      if (error) return res.status(500).json({ error: error.message });
    } else {
      // action === 'mark' (par défaut)
      const { error } = await supabase
        .from('read_articles')
        .upsert(
          { article_id: articleId, marked_at: new Date().toISOString() },
          { onConflict: 'article_id' }
        );

      if (error) return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
