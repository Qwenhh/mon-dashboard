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

  // ── GET : récupérer tous les IDs marqués comme lus (pagination) ──
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
      if (data.length < PAGE) break; // dernière page
      page++;
    }

    return res.status(200).json({ read: allIds });
  }

  // ── POST : marquer ou démarquer un article ───────────────────
  if (req.method === 'POST') {
    const { articleId, action } = req.body || {};

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
      const { data, error } = await supabase
        .from('read_articles')
        .upsert({ article_id: articleId }, { onConflict: 'article_id' })
        .select();

      if (error) return res.status(500).json({ error: error.message });
      // Si data est vide, RLS a bloqué l'insert silencieusement
      if (!data || data.length === 0) {
        return res.status(500).json({ error: 'Insert bloqué — vérifier RLS Supabase' });
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
