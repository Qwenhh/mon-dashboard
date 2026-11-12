// api/watchlist.js — Liste des liens à surveiller
// GET  : liste (lue par le dashboard et par la tâche planifiée)
// POST : {action:'add', label, url} | {action:'remove', id}  — protégé par PRICE_TOKEN
const { getSupabase, requireToken, clip, safeUrl } = require('./_auth');

const MAX_ITEMS = 20;

module.exports = async function handler(req, res) {
  let supabase;
  try { supabase = getSupabase(); } catch (e) { return res.status(500).json({ error: e.message }); }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const { data, error } = await supabase.from('watchlist').select('id,label,url').order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ items: data || [] });
  }

  if (req.method === 'POST') {
    if (!requireToken(req, res)) return;
    const { action, label, url, id } = req.body || {};

    if (action === 'add') {
      const cleanUrl = safeUrl(url);
      const cleanLabel = clip(label, 60);
      if (!cleanUrl || !cleanLabel) return res.status(400).json({ error: 'Nom et lien (http/https) requis' });
      const { count, error: cErr } = await supabase.from('watchlist').select('id', { count: 'exact', head: true });
      if (cErr) return res.status(500).json({ error: cErr.message });
      if ((count || 0) >= MAX_ITEMS) return res.status(400).json({ error: `Maximum ${MAX_ITEMS} liens surveillés` });
      const { data, error } = await supabase.from('watchlist').insert({ label: cleanLabel, url: cleanUrl }).select('id,label,url');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, item: data && data[0] });
    }

    if (action === 'remove') {
      const n = Number(id);
      if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: 'id invalide' });
      const { error } = await supabase.from('watchlist').delete().eq('id', n);
      if (error) return res.status(500).json({ error: error.message });
      // Efface aussi l'historique de prix de ce lien
      await supabase.from('price_checks').delete().eq('product', 'w-' + n);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'action inconnue' });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
