/* ══ THEME ══ */
const LS_THEME = 'dashboard_theme';
function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = t === 'light' ? '🌙' : '☀️';
}
function toggleTheme() {
  const next = document.body.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem(LS_THEME, next);
  applyTheme(next);
}
applyTheme(localStorage.getItem(LS_THEME) || 'dark');

/* ══ STATE ══ */
let articles   = { fun:[], f1:[], biathlon:[], foot:[], fm:[] };
let readIds    = new Set();
let unreadOnly = false;

/* ══ TEMPS RELATIF + DATE ══ */
function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1)  return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m/60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h/24)}j`;
}
function pubDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/* ══ READ STATUS (localStorage + Supabase via /api/read) ══ */
const LS_KEY       = 'dashboard_readIds';
const LS_QUEUE_KEY = 'dashboard_syncQueue';
let supabaseOk = true;

function renderSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const pending = syncQueueLoad().length;
  if (!supabaseOk)
    el.innerHTML = ' · <span style="color:#e04a6d;font-size:.68rem" title="Supabase indisponible">⚠️ Hors ligne</span>';
  else if (pending)
    el.innerHTML = ` · <span style="color:#f0c040;font-size:.68rem" title="${pending} sync(s) en attente">⏳ ${pending} en attente</span>`;
  else
    el.innerHTML = '';
}

function lsLoad() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return new Set(); }
}
function lsSave() {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...readIds])); } catch {}
}
function syncQueueLoad() {
  try { return JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || '[]'); } catch { return []; }
}
function syncQueueSave(q) {
  try { localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(q)); } catch {}
}

async function postRead(id, action) {
  const r = await fetch('/api/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleId: id, action }),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

async function syncRead(id, action) {
  try {
    await postRead(id, action);
    // Succès — retire de la file si présent
    syncQueueSave(syncQueueLoad().filter(x => !(x.id === id && x.action === action)));
  } catch(e) {
    console.warn('syncRead échoué, mis en file:', e.message);
    // Ajoute à la file de retry si pas déjà présent
    const q = syncQueueLoad();
    if (!q.some(x => x.id === id && x.action === action))
      q.push({ id, action, ts: Date.now() });
    syncQueueSave(q);
  }
  renderSyncStatus();
}

async function flushSyncQueue() {
  const q = syncQueueLoad();
  if (!q.length) return;
  const WEEK = 7 * 24 * 3600 * 1000;
  const remaining = [];
  for (const item of q) {
    if (Date.now() - item.ts > WEEK) continue; // expire après 7 jours
    try { await postRead(item.id, item.action); }
    catch { remaining.push(item); }
  }
  syncQueueSave(remaining);
}

async function fetchReadStatus() {
  readIds = lsLoad();
  await flushSyncQueue();
  try {
    const d = await fetch('/api/read', { signal: AbortSignal.timeout(8000) }).then(r => r.json());
    const fromServer = new Set(d.read || []);
    for (const { id, action } of syncQueueLoad()) {
      if (action === 'mark')   fromServer.add(id);
      if (action === 'unmark') fromServer.delete(id);
    }
    readIds = fromServer;
    lsSave();
    supabaseOk = true;
  } catch(e) {
    supabaseOk = false;
    console.warn('Supabase indisponible:', e);
  }
  renderSyncStatus();
}

function openInBackground(e, link) {
  // Sur mobile (touch), laisser le comportement natif du <a>
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  // Ctrl/Meta/Shift+clic ou clic molette → comportement natif du navigateur
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  window.open(link, '_blank', 'noopener,noreferrer');
  window.focus(); // remet le focus sur le dashboard
}

function toggleRead(cat, id, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  const wasRead = readIds.has(id);
  if (wasRead) readIds.delete(id); else readIds.add(id);
  lsSave();
  const action = wasRead ? 'unmark' : 'mark';
  // Écrit dans la queue IMMÉDIATEMENT avant d'attendre Supabase
  // → si la page est rechargée avant la réponse, la queue recontient l'opération
  const q = syncQueueLoad();
  if (!q.some(x => x.id === id && x.action === action))
    q.push({ id, action, ts: Date.now() });
  syncQueueSave(q);
  syncRead(id, action); // async — supprimera de la queue si succès
  renderAll();
  if (modalState.id === id) syncModalReadBtn();
}

function markAllToggle(cats) {
  const all = cats.flatMap(c => articles[c] || []);
  const allRead = all.length > 0 && all.every(a => readIds.has(a.id));
  all.forEach(a => {
    if (allRead) { readIds.delete(a.id); syncRead(a.id, 'unmark'); }
    else if (!readIds.has(a.id)) { readIds.add(a.id); syncRead(a.id, 'mark'); }
  });
  lsSave();
  renderAll();
}

/* ══ ARTICLES ══ */
async function loadArticles() {
  try {
    const data = await fetch('/api/articles').then(r=>r.json());
    articles = data;
  } catch(e) {
    ['fun','f1','biathlon','foot'].forEach(cat => {
      const el = document.getElementById('list-'+cat);
      if (el) el.innerHTML = `<div class="error-msg">Impossible de charger les articles.<br><small>${esc(e.message)}</small></div>`;
    });
    return;
  }
}

/* ══ RENDER ARTICLES ══ */
function tagHtml(a) {
  const map = { vdm:['tag-vdm','VDM'], dtc:['tag-dtc','DTC'], 'foot-fm':['tag-fm','Foot Mercato'] };
  const [cls, lbl] = map[a.source] || ['tag-leq',"L'Équipe"];
  return `<span class="article-source-tag ${cls}">${lbl}</span>`;
}

function toggleUnreadFilter() {
  unreadOnly = !unreadOnly;
  document.querySelectorAll('.btn-unread-filter').forEach(btn => {
    btn.classList.toggle('active', unreadOnly);
    btn.textContent = unreadOnly ? '✓ Non lus seulement' : 'Non lus seulement';
  });
  renderAll();
}

let refreshing = false;
let lastRefresh = Date.now();
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById('btn-refresh');
  if (btn) { btn.disabled = true; btn.textContent = '↻…'; }
  try {
    const data = await fetch('/api/articles?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    articles = data;
  } catch(e) { console.warn('Refresh articles échoué:', e); }
  await Promise.allSettled([fetchReadStatus(), loadPrices(), ...TEAMS.map(t => loadTeam(t))]);
  renderAll();
  updateClock();
  lastRefresh = Date.now();
  refreshing = false;
  if (btn) { btn.disabled = false; btn.textContent = '↻ Rafraîchir'; }
}

/* Rafraîchissement auto : toutes les 5 min, seulement si l'onglet est visible */
const AUTO_REFRESH_MS = 5 * 60 * 1000;
setInterval(() => { if (!document.hidden) refreshAll(); }, AUTO_REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastRefresh > AUTO_REFRESH_MS) refreshAll();
});

/* ══ SÉCURITÉ : échappement HTML + URLs ══ */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function safeUrl(u) {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '#'; }
  catch { return '#'; }
}

function renderList(containerId, cats, readerMode = false) {
  const c = document.getElementById(containerId);
  if (!c) return;
  let items = cats.flatMap(cat => articles[cat] || []);
  if (unreadOnly) items = items.filter(a => !readIds.has(a.id));
  if (!items.length) {
    c.innerHTML = `<div class="loading-msg">${unreadOnly ? 'Tout est lu 🎉' : 'Aucun article disponible.'}</div>`;
    return;
  }

  c.innerHTML = items.map(a => {
    const read = readIds.has(a.id);
    const text = esc(a.title || a.content || '');
    const isLink = !readerMode && (a.label === 'leq' || a.label === 'fm');
    const mode = readerMode ? 'reader' : isLink ? 'link' : 'modal';
    const meta = `<div class="article-source-row">${tagHtml(a)}<span class="article-time">${relTime(a.date)}</span><span class="article-time" style="margin-left:auto;opacity:.6">${pubDate(a.date)}</span></div>
        <div class="article-text">${text}</div>`;
    const main = isLink
      ? `<a class="article-main" href="${esc(safeUrl(a.link))}" target="_blank" rel="noopener noreferrer">${meta}</a>`
      : `<div class="article-main">${meta}</div>`;
    return `<div class="article-card ${read?'read':''}" data-id="${esc(a.id)}" data-mode="${mode}">
      ${main}
      <button class="read-action" data-action="toggle-read" title="Marquer comme lu">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>`;
  }).join('');
}

// Délégation d'événements : un seul écouteur pour toutes les cartes
document.addEventListener('click', e => {
  const card = e.target.closest('.article-card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('[data-action="toggle-read"]')) { toggleRead(null, id, e); return; }
  const mode = card.dataset.mode;
  if (mode === 'link') {
    const a = e.target.closest('a.article-main');
    if (a) openInBackground(e, a.href);
  } else if (mode === 'reader') openReaderModal(id);
  else openModal(id);
});

function unreadCount(cats) {
  return cats.flatMap(c => articles[c]||[]).filter(a => !readIds.has(a.id)).length;
}

function renderBadges() {
  const g = { fun:['fun'], f1:['f1'], biathlon:['biathlon'], foot:['foot'], fm:['fm'], fmr:['fm'] };
  Object.entries(g).forEach(([k,cats]) => {
    const n = unreadCount(cats);
    const badge = document.getElementById('tbadge-'+k);
    const count = document.getElementById('home-count-'+k);
    if (badge) badge.textContent = n;
    if (count) count.textContent = n;
  });
}

function renderHomePreviews() {
  const g = { fun:['fun'], f1:['f1'], biathlon:['biathlon'], foot:['foot'] };
  Object.entries(g).forEach(([k,cats]) => {
    const el = document.getElementById('home-preview-'+k);
    if (!el) return;
    const items = cats.flatMap(c => articles[c]||[]).filter(a=>!readIds.has(a.id)).slice(0,3);
    el.innerHTML = items.map(a=>`<div class="home-preview-item">${esc((a.title||a.content||'').slice(0,65))}…</div>`).join('');
  });
}

function renderMarkAllBtns() {
  const g = { fun:['fun'], f1:['f1'], biathlon:['biathlon'], foot:['foot'], fm:['fm'], fmr:['fm'] };
  Object.entries(g).forEach(([k, cats]) => {
    const btn = document.getElementById('btn-markall-' + k);
    if (!btn) return;
    const all = cats.flatMap(c => articles[c] || []);
    const allRead = all.length > 0 && all.every(a => readIds.has(a.id));
    btn.textContent = allRead ? 'Tout démarquer' : 'Tout marquer comme lu';
  });
}

function renderAll() {
  renderList('list-fun',      ['fun']);
  renderList('list-f1',       ['f1']);
  renderList('list-biathlon', ['biathlon']);
  renderList('list-foot',     ['foot']);
  renderList('list-fm',       ['fm']);
  renderList('list-fmr',      ['fm'], true);
  renderBadges();
  renderHomePreviews();
  renderMarkAllBtns();
}

/* ══ MODAL ══ */
const modalState = { id: null };
const articleMap = {};

function openModal(id) {
  const a = Object.values(articles).flat().find(x => x.id === id);
  if (!a) return;
  // L'Équipe et Footmercato → ouvrir dans un nouvel onglet (contenu payant)
  if (a.label === 'leq' || a.label === 'fm') {
    if (a.link) window.open(a.link, '_blank', 'noopener,noreferrer');
    return;
  }
  modalState.id = id;

  const map = { vdm:['tag-vdm','VDM'], dtc:['tag-dtc','DTC'], 'foot-fm':['tag-fm','Foot Mercato'] };
  const [cls, lbl] = map[a.source] || ['tag-leq',"L'Équipe"];

  document.getElementById('modal-tag').className = 'article-source-tag '+cls;
  document.getElementById('modal-tag').textContent = lbl;
  document.getElementById('modal-time').textContent = relTime(a.date);
  document.getElementById('modal-open-link').href = a.link || '#';

  // Afficher titre + contenu si différents
  let bodyText = a.title || '';
  if (a.content && a.content !== a.title && a.content.length > 10) {
    bodyText += '\n\n' + a.content;
  }
  document.getElementById('modal-body').textContent = bodyText;

  syncModalReadBtn();
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function openReaderModal(id) {
  const a = Object.values(articles).flat().find(x => x.id === id);
  if (!a) return;
  modalState.id = id;

  document.getElementById('modal-tag').className = 'article-source-tag tag-fm';
  document.getElementById('modal-tag').textContent = 'Foot Mercato';
  document.getElementById('modal-time').textContent = relTime(a.date);
  document.getElementById('modal-open-link').href = a.link || '#';
  document.getElementById('modal-body').innerHTML = '<div class="loading-msg">Chargement de l\'article…</div>';

  syncModalReadBtn();
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const data = await fetch('/api/article?url=' + encodeURIComponent(a.link)).then(r => r.json());
    if (data.error) throw new Error(data.error);

    const link = esc(safeUrl(a.link));
    let html = '';
    if (data.title) html += `<p style="font-size:1.05rem;font-weight:700;margin-bottom:12px">${esc(data.title)}</p>`;
    if (data.lead)  html += `<p style="font-style:italic;color:var(--muted);margin-bottom:16px;border-left:3px solid var(--accent-fm);padding-left:12px">${esc(data.lead)}</p>`;
    if (data.body) {
      html += data.body.split('\n\n').filter(Boolean).map(p =>
        p.startsWith('**') && p.endsWith('**')
          ? `<h3 style="font-size:.92rem;font-weight:700;margin:14px 0 6px">${esc(p.slice(2,-2))}</h3>`
          : `<p style="margin-bottom:12px">${esc(p)}</p>`
      ).join('');
    }
    if (!html) html = `<div class="error-msg">Contenu non disponible — <a href="${link}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-fm)">ouvrir sur Footmercato →</a></div>`;
    document.getElementById('modal-body').innerHTML = html;
  } catch(e) {
    document.getElementById('modal-body').innerHTML = `<div class="error-msg">Impossible de charger l'article : ${esc(e.message)}<br><br><a href="${esc(safeUrl(a.link))}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-fm)">Ouvrir sur Footmercato →</a></div>`;
  }
}

function syncModalReadBtn() {
  const btn = document.getElementById('modal-read-btn');
  const read = readIds.has(modalState.id);
  btn.textContent = read ? '✓ Lu' : '✓ Marquer comme lu';
  btn.classList.toggle('done', read);
}

function modalToggleRead() {
  const a = Object.values(articles).flat().find(x => x.id === modalState.id);
  if (!a) return;
  toggleRead(a.category, modalState.id);
  syncModalReadBtn();
}

function closeModal(e)      { if (e.target === document.getElementById('modal-overlay')) closeModalDirect(); }
function closeModalDirect() { document.getElementById('modal-overlay').classList.remove('open'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key==='Escape') closeModalDirect(); });

/* ══ TABS ══ */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('page-'+btn.dataset.tab).classList.add('active');
  });
});
document.querySelectorAll('.home-card').forEach(card => {
  card.addEventListener('click', () => document.querySelector(`.tab[data-tab="${card.dataset.goto}"]`).click());
});

/* ══ MÉTÉO — Open-Meteo ══ */
const WMO = {
  0:['☀️','Ciel dégagé'],1:['🌤️','Peu nuageux'],2:['⛅','Partiellement nuageux'],3:['☁️','Couvert'],
  45:['🌫️','Brouillard'],48:['🌫️','Brouillard givrant'],
  51:['🌦️','Bruine légère'],53:['🌦️','Bruine'],55:['🌦️','Bruine dense'],
  61:['🌧️','Pluie légère'],63:['🌧️','Pluie'],65:['🌧️','Pluie forte'],
  71:['🌨️','Neige légère'],73:['🌨️','Neige'],75:['🌨️','Neige forte'],77:['🌨️','Grains de neige'],
  80:['🌧️','Averses légères'],81:['🌧️','Averses'],82:['⛈️','Averses violentes'],
  95:['⛈️','Orage'],96:['⛈️','Orage avec grêle'],99:['⛈️','Orage violent']
};
async function loadWeather() {
  try {
    const d = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.6292&longitude=3.0573&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=Europe%2FParis')).json();
    const c=d.current, daily=d.daily, [icon,desc]=WMO[c.weather_code]||['🌡️',''];
    document.getElementById('widget-meteo').innerHTML = `
      <div class="widget-label">🌍 Lille</div><div class="widget-icon">${icon}</div>
      <div class="widget-main">${Math.round(c.temperature_2m)}°C</div>
      <div class="widget-sub">${desc} · ${Math.round(daily.temperature_2m_min[0])}–${Math.round(daily.temperature_2m_max[0])}°C</div>
      <div class="widget-sub" style="margin-top:2px">💨 ${Math.round(c.wind_speed_10m)} km/h · 🌧 ${daily.precipitation_probability_max[0]}%</div>`;
  } catch { document.getElementById('widget-meteo').innerHTML = `<div class="widget-label">🌍 Lille</div><div class="widget-sub" style="margin-top:8px">Indisponible</div><a class="widget-link" href="https://www.google.com/search?q=meteo+Lille" target="_blank">Voir sur Google →</a>`; }
}

/* ══ BITCOIN — CoinGecko ══ */
async function loadBitcoin() {
  try {
    const d = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true')).json();
    const price=d.bitcoin.usd, change=d.bitcoin.usd_24h_change, up=change>=0;
    document.getElementById('widget-btc').innerHTML = `
      <div class="widget-label">₿ Bitcoin</div><div class="widget-icon">🟠</div>
      <div class="widget-main">$${price.toLocaleString('fr-FR')}</div>
      <div class="widget-change ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(change).toFixed(2)}% aujourd'hui</div>`;
  } catch { document.getElementById('widget-btc').innerHTML = `<div class="widget-label">₿ Bitcoin</div><a class="widget-link" style="margin-top:12px" href="https://www.coingecko.com/fr/pièces/bitcoin" target="_blank">Voir sur CoinGecko →</a>`; }
}

/* ══ FINANCE — via /api/finance (proxy Yahoo) ══ */
async function loadFinance(ticker, isin, elementId, label, currency) {
  const el = document.getElementById(elementId);
  try {
    const d = await (await fetch(`/api/finance?ticker=${encodeURIComponent(ticker)}`)).json();
    if (d.error) throw new Error(d.error);
    const up = d.change >= 0;
    el.innerHTML = `
      <div class="widget-label">${label}</div>
      <div class="widget-main">${d.price.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}</div>
      ${d.change!==null?`<div class="widget-change ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(d.change).toFixed(2)}%</div>`:''}
      <div class="widget-sub" style="font-size:.62rem;margin-top:4px">${isin}</div>`;
  } catch {
    el.innerHTML = `
      <div class="widget-label">${label}</div>
      <a class="widget-link" style="margin-top:12px" href="https://finance.yahoo.com/quote/${ticker}" target="_blank">Voir le cours →</a>
      <div class="widget-sub" style="font-size:.62rem;margin-top:4px">${isin}</div>`;
  }
}

/* ══ F1 — Jolpica/Ergast ══ */
function toParisTime(d,t) {
  if (!t) return null;
  const dt=new Date(d+'T'+t);
  return { date:dt.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/Paris'}), time:dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}) };
}
async function loadF1GP() {
  const el=document.getElementById('widget-gp');
  try {
    const d=await (await fetch('https://api.jolpi.ca/ergast/f1/current.json',{signal:AbortSignal.timeout(6000)})).json();
    const races=d.MRData.RaceTable.Races, today=new Date().toISOString().split('T')[0];
    const race=races.find(r=>r.date>=today)||races[races.length-1];
    if (!race) { el.innerHTML='<div class="gp-empty">Aucun GP à venir.</div>'; return; }
    const now=new Date();
    const sessions=[
      {key:'FirstPractice',label:'EL 1'},{key:'SecondPractice',label:'EL 2'},
      {key:'SprintQualifying',label:'Qualif. Sprint'},{key:'Sprint',label:'Sprint'},
      {key:'ThirdPractice',label:'EL 3'},{key:'Qualifying',label:'Qualifications'},
    ].filter(s=>race[s.key]);
    const mkSession=(name,date,time,isRace=false)=>{
      const t=toParisTime(date,time);
      const nextUp=new Date(date+'T'+(time||'12:00:00'))>now;
      return `<div class="gp-session ${nextUp?'next-up':''}">
        <div class="gp-session-name">${name}</div>
        <div class="gp-session-date">${t?t.date:'—'}</div>
        <div class="gp-session-time">${t?t.time:'—'}</div>
      </div>`;
    };
    const sessHtml=sessions.map(s=>mkSession(s.label,race[s.key].date,race[s.key].time)).join('');
    el.innerHTML=`<div class="gp-header"><div class="gp-title">🏎️ ${race.raceName}</div><div class="gp-round">Manche ${race.round} · ${race.Circuit?.circuitName||''}</div></div>
      <div class="gp-sessions">${sessHtml}${mkSession('🏁 Course',race.date,race.time,true)}</div>`;
  } catch { el.innerHTML=`<div class="gp-empty">Indisponible. <a href="https://www.lequipe.fr/Formule-1/" target="_blank" style="color:var(--accent-f1)">Voir sur L'Équipe →</a></div>`; }
}

/* ══ ÉQUIPES — football-data.org via /api/football ══ */
const TEAMS=[
  {teamKey:'monaco', displayName:'AS Monaco',        id:'team-monaco'},
  {teamKey:'barce',  displayName:'FC Barcelone',     id:'team-barce'},
  {teamKey:'reims',  displayName:'Stade de Reims',   id:'team-reims'},
  {teamKey:'france', displayName:'Équipe de France', id:'team-france'},
];
function frDate(iso){ if(!iso)return''; const dt=new Date(iso); return dt.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/Paris'})+' · '+dt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Paris'}); }
function teamMatchHtml(m, kind){
  const venue = m.isHome ? '🏠 ' : '✈️ ';
  const comp = m.competition ? `<span class="comp-text">${esc(m.competition)}</span>` : '';
  let info;
  if (kind === 'live') {
    info = `<span class="result-badge" style="background:rgba(224,74,109,.2);color:#e04a6d">🔴 EN DIRECT${m.clock?' '+esc(m.clock):''}</span><span class="score-text">${m.myScore ?? 0} – ${m.oppScore ?? 0}</span>`;
  } else if (kind === 'last') {
    const res = m.myScore > m.oppScore ? 'V' : m.myScore < m.oppScore ? 'D' : 'N';
    info = `<span class="result-badge result-${res}">${res}</span><span class="score-text">${m.myScore} – ${m.oppScore}${m.shootout?' (tab)':''}</span><span class="comp-text">${frDate(m.utcDate)}</span>`;
  } else {
    info = `<span class="comp-text">${frDate(m.utcDate)}</span>`;
  }
  return `<div class="team-match"><div class="team-match-teams">${venue}vs ${esc(m.opponent)}</div><div class="team-match-info">${info}</div><div class="team-match-info" style="margin-top:2px">${comp}</div></div>`;
}
async function loadTeam({teamKey,displayName,id}){
  const el=document.getElementById(id);
  try{
    const r=await fetch(`/api/football?team=${teamKey}`,{signal:AbortSignal.timeout(12000)});
    const data=await r.json();
    if(data.error) throw new Error(data.error);
    const asList = v => Array.isArray(v) ? v : (v ? [v] : []);
    const last = asList(data.last), next = asList(data.next);
    let html=`<div class="team-header"><span style="font-size:1.3rem">${teamKey==='france'?'🇫🇷':'⚽'}</span><span class="team-name">${esc(displayName)}</span></div>`;
    if(data.live) html+=`<div class="team-section"><div class="team-section-label">En ce moment</div>${teamMatchHtml(data.live,'live')}</div>`;
    if(last.length) html+=`<div class="team-section"><div class="team-section-label">Derniers matchs</div>${last.map(m=>teamMatchHtml(m,'last')).join('')}</div>`;
    if(next.length) html+=`<div class="team-section"><div class="team-section-label">Prochains matchs</div>${next.map(m=>teamMatchHtml(m,'next')).join('')}</div>`;
    if(!data.live&&!last.length&&!next.length) html+=`<div class="widget-sub">Aucun match trouvé</div>`;
    el.innerHTML=html;
    el.dataset.loaded='1';
  }catch(e){
    // Rafraîchissement auto : on garde l'affichage précédent plutôt que de l'effacer
    if(el.dataset.loaded) { console.warn('Refresh équipe échoué:', displayName, e.message); return; }
    el.innerHTML=`<div class="team-header"><span style="font-size:1.3rem">⚽</span><span class="team-name">${esc(displayName)}</span></div><div class="widget-sub">Données indisponibles — ${esc(e.message)}</div>`;
  }
}

/* ══ VEILLE PRIX — /api/prices (alimenté par la tâche planifiée) ══ */
const eur = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 }) + ' €';
function sparkSvg(series) {
  if (!series || series.length < 2) return '';
  const w = 84, h = 28, min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const pts = series.map((v, i) => (i / (series.length - 1) * w).toFixed(1) + ',' + (h - 3 - (v - min) / span * (h - 6)).toFixed(1)).join(' ');
  const down = series[series.length - 1] < series[0];
  return `<svg class="price-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${down ? '#27ae60' : 'var(--muted)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function priceSourceHtml(s) {
  const l = s.latest;
  let badge = '';
  if (l.in_stock === false) badge = '<span class="price-badge out">Rupture</span>';
  else if (l.in_stock === true) badge = '<span class="price-badge in">Dispo</span>';
  let delta = '';
  if (l.price !== null && s.prev !== null && s.prev !== l.price) {
    const d = l.price - s.prev;
    delta = ` · <span class="price-delta ${d < 0 ? 'down' : 'up'}">${d < 0 ? '▼' : '▲'} ${eur(Math.abs(d))}</span>`;
  }
  const min = s.min !== null && s.min !== l.price ? ` · plus bas 30j : ${eur(s.min)}` : '';
  const link = l.url ? `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">voir ↗</a>` : '';
  const merchant = l.merchant ? esc(l.merchant) + ' · ' : '';
  return `<div class="price-row">
    <div class="price-label">${esc(s.label)}${badge}</div>
    ${sparkSvg(s.series)}
    <div class="price-value">${eur(l.price)}</div>
    <div class="price-meta">${merchant}${relTime(l.checked_at)}${delta}${min} ${link}</div>
  </div>`;
}
async function loadPrices() {
  const box = document.getElementById('widget-prices');
  const badge = document.getElementById('tbadge-prices');
  if (!box) return;
  try {
    const data = await fetch('/api/prices', { signal: AbortSignal.timeout(10000) }).then(r => r.json());
    if (data.error) throw new Error(data.error);
    const products = (data.products || []).filter(p => p.sources.length);
    if (!products.length) {
      box.innerHTML = '<div class="loading-msg">Aucun relevé pour l’instant — la tâche de veille n’a encore rien enregistré.</div>';
      if (badge) badge.hidden = true;
      return;
    }
    box.innerHTML = products.map(p => {
      const alert = p.sources.some(s => s.latest.alert);
      return `<div class="price-card${alert ? ' alert' : ''}"><div class="price-title">${alert ? '🔔' : '🏷️'} ${esc(p.label)}</div>${p.sources.map(priceSourceHtml).join('')}</div>`;
    }).join('');
    if (badge) badge.hidden = !products.some(p => p.sources.some(s => s.latest.alert));
  } catch (e) {
    console.warn('Veille prix indisponible:', e.message);
    if (!box.querySelector('.price-card')) box.innerHTML = `<div class="error-msg">Veille prix indisponible : ${esc(e.message)}</div>`;
  }
}

/* ══ INIT ══ */
function updateClock(){ document.getElementById('last-update').textContent=new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}); renderAll(); }
updateClock(); setInterval(updateClock,60000);

/* Nettoyage des IDs lus obsolètes : 1x/jour max, seulement si TOUS les flux ont répondu */
async function pruneReadIds() {
  const LS_PRUNE = 'dashboard_lastPrune';
  try {
    if (Date.now() - Number(localStorage.getItem(LS_PRUNE) || 0) < 24 * 3600 * 1000) return;
    const cats = ['fun','f1','biathlon','foot','fm'];
    if (cats.some(c => !(articles[c] || []).length)) return; // un flux vide/en panne → on ne touche à rien
    const visible = cats.flatMap(c => articles[c].map(a => a.id));
    const r = await fetch('/api/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prune', visible }), signal: AbortSignal.timeout(10000),
    });
    if (r.ok) localStorage.setItem(LS_PRUNE, String(Date.now()));
  } catch (e) { console.warn('Nettoyage lus échoué:', e.message); }
}

Promise.allSettled([fetchReadStatus(), loadArticles()]).then(() => { renderAll(); pruneReadIds(); });

Promise.allSettled([
  loadWeather(),
  loadBitcoin(),
  loadFinance('WPEA.PA',       'IE0002XZSHO1', 'widget-msci', '📈 MSCI World PEA', '€'),
  loadFinance('ALCPB.PA',      'FR0011053636', 'widget-capb', '📊 Capital B',  '€'),
  loadF1GP(),
  loadPrices(),
  ...TEAMS.map(t=>loadTeam(t)),
]);

/* ══ PWA : service worker ══ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW non enregistré:', e.message));
  });
}
