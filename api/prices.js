// api/prices.js — Veille prix
// POST (protégé par PRICE_TOKEN) : la tâche planifiée enregistre ses relevés
// GET : renvoie, par produit et par source, le dernier prix + historique 30 jours
//
// Table Supabase attendue : price_checks (voir README du SQL dans la conversation)
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const DAY = 24 * 3600 * 1000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Variables SUPABASE_URL et SUPABASE_SERVICE_KEY manquantes');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const clip = (s, n) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href.slice(0, 500) : null; }
  catch { return null; }
}
// Renvoie 'ok' | 'unconfigured' | 'invalid' (sans jamais révéler la valeur attendue)
function checkToken(req) {
  const want = String(process.env.PRICE_TOKEN || '').trim();
  if (want.length < 16) return 'unconfigured'; // variable absente (ou pas encore redéployée) / trop courte
  const a = Buffer.from(String(req.headers['x-api-key'] || '').trim());
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

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
    alert: r.alert === true,
  };
}

module.exports = async function handler(req, res) {
  let supabase;
  try { supabase = getSupabase(); } catch (e) { return res.status(500).json({ error: e.message }); }

  // ── POST : enregistrer un ou plusieurs relevés ─────────────
  if (req.method === 'POST') {
    const auth = checkToken(req);
    if (auth === 'unconfigured') return res.status(503).json({ error: 'PRICE_TOKEN non configuré côté serveur (variable Vercel absente, trop courte ou site pas redéployé)' });
    if (auth === 'invalid') return res.status(401).json({ error: 'Non autorisé : la clé x-api-key ne correspond pas à PRICE_TOKEN' });
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

    const products = {};
    for (const r of all) {
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
          latest: { price: last.price === null ? null : Number(last.price), in_stock: last.in_stock, merchant: last.merchant, url: last.url, alert: last.alert, checked_at: last.checked_at },
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
