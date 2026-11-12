// api/prices.js — Veille prix
// POST (protégé par PRICE_TOKEN) : la tâche planifiée enregistre ses relevés
// GET : renvoie, par produit et par source, le dernier prix + historique 30 jours
//
// Table Supabase attendue : price_checks (voir README du SQL dans la conversation)
const { getSupabase, requireToken, clip, safeUrl } = require('./_auth');

const DAY = 24 * 3600 * 1000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  if (!SLUG.test(r.product || '') || !SLUG.test(r.source || '')) return null;
  let price = null;
  if (r.price !== null && r.price !== undefined && r.price !== '') {
    price = Number(r.price);
    if (!Number.isFinite(price) || price < 0 || price > 100000) return null;
  }
  return {
    product: r.product,
    product_label: clip(r.product_label, 80),
    source: r.source,
    source_label: clip(r.source_label, 60),
    price,
    in_stock: typeof r.in_stock === 'boolean' ? r.in_stock : null,
    merchant: clip(r.merchant, 60),
    url: safeUrl(r.url),
    promos: clip(Array.isArray(r.promos) ? r.promos.filter((x) => typeof x === 'string').join(' · ') : r.promos, 400),
    alert: r.alert === true,
  };
}

module.exports = async function handler(req, res) {
  let supabase;
  try { supabase = getSupabase(); } catch (e) { return res.status(500).json({ error: e.message }); }

  // ── POST : enregistrer un ou plusieurs relevés ─────────────
  if (req.method === 'POST') {
    if (!requireToken(req, res)) return;
    const body = req.body || {};
    const raw = Array.isArray(body.records) ? body.records.slice(0, 20) : [body];
    const rows = raw.map(cleanRecord);
    if (!rows.length || rows.some((r) => !r)) return res.status(400).json({ error: 'Relevé invalide (product/source en a-z0-9-, price numérique)' });

    const { error } = await supabase.from('price_checks').insert(rows);
    if (error) return res.status(500).json({ error: error.message });

    // Rétention : 90 jours
    await supabase.from('price_checks').delete().lt('checked_at', new Date(Date.now() - 90 * DAY).toISOString());
    return res.status(200).json({ ok: true, saved: rows.length });
  }

  // ── GET : synthèse pour le dashboard ───────────────────────
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const all = [];
    for (let page = 0; page < 10; page++) {
      const { data, error } = await supabase.from('price_checks').select('*')
        .gte('checked_at', since).order('checked_at', { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) return res.status(500).json({ error: error.message });
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    // Liens supprimés de la watchlist → on ne montre plus leur historique
    let watchIds = null;
    const wl = await supabase.from('watchlist').select('id');
    if (!wl.error) watchIds = new Set((wl.data || []).map((w) => 'w-' + w.id));

    const products = {};
    for (const r of all) {
      if (watchIds && r.product.startsWith('w-') && !watchIds.has(r.product)) continue;
      const p = (products[r.product] ||= { id: r.product, label: r.product, sources: {} });
      if (r.product_label) p.label = r.product_label;
      const s = (p.sources[r.source] ||= { id: r.source, label: r.source, rows: [] });
      if (r.source_label) s.label = r.source_label;
      s.rows.push(r);
    }

    const out = Object.values(products).map((p) => ({
      id: p.id, label: p.label,
      sources: Object.values(p.sources).map((s) => {
        const last = s.rows[s.rows.length - 1];
        const prices = s.rows.map((r) => r.price).filter((x) => x !== null).map(Number);
        // Série quotidienne : dernier prix connu de chaque jour
        const perDay = new Map();
        for (const r of s.rows) if (r.price !== null) perDay.set(String(r.checked_at).slice(0, 10), Number(r.price));
        // Prix distinct précédent (pour afficher la variation)
        let prev = null;
        for (let i = s.rows.length - 2; i >= 0; i--) {
          const v = s.rows[i].price;
          if (v !== null && v !== last.price) { prev = Number(v); break; }
        }
        return {
          id: s.id, label: s.label,
          latest: { price: last.price === null ? null : Number(last.price), in_stock: last.in_stock, merchant: last.merchant, url: last.url, promos: last.promos, alert: last.alert, checked_at: last.checked_at },
          min: prices.length ? Math.min(...prices) : null,
          prev,
          series: [...perDay.values()].slice(-30),
        };
      }),
    }));
    return res.status(200).json({ products: out });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
};
