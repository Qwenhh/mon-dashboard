// api/_auth.js — helpers partagés (le préfixe "_" empêche Vercel d'en faire une route)
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Variables SUPABASE_URL et SUPABASE_SERVICE_KEY manquantes');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// 'ok' | 'unconfigured' | 'invalid' — ne révèle jamais la valeur attendue
function checkToken(req) {
  const want = String(process.env.PRICE_TOKEN || '').trim();
  if (want.length < 16) return 'unconfigured';
  const a = Buffer.from(String(req.headers['x-api-key'] || '').trim());
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

// Répond directement et renvoie false si l'appelant n'est pas autorisé
function requireToken(req, res) {
  const auth = checkToken(req);
  if (auth === 'unconfigured') {
    res.status(503).json({ error: 'PRICE_TOKEN non configuré côté serveur (variable Vercel absente, trop courte ou site pas redéployé)' });
    return false;
  }
  if (auth === 'invalid') {
    res.status(401).json({ error: 'Non autorisé : la clé x-api-key ne correspond pas à PRICE_TOKEN' });
    return false;
  }
  return true;
}

const clip = (s, n) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href.slice(0, 500) : null; }
  catch { return null; }
}

module.exports = { getSupabase, checkToken, requireToken, clip, safeUrl };
