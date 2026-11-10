// ============================================================
// MESHIPPING // TERMINAL  —  pinta-cotiza
// Sistema de cotizaciones para pintura, gypsum y remodelaciones
// Node 24 + node:sqlite (sin dependencias nativas) + Express
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.use(express.json({ limit: '5mb' }));

// ============================================================
// BASE DE DATOS (SQLite — archivo autonomo)
// ============================================================
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'pinta.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// node:sqlite no trae el helper .transaction(); envolvemos a mano.
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS catalog (
  id          TEXT PRIMARY KEY,
  category    TEXT,
  cost_type   TEXT DEFAULT 'materiales',
  name        TEXT NOT NULL,
  unit        TEXT DEFAULT 'm2',
  unit_price  REAL DEFAULT 0,
  paint_yield REAL,
  coats       INTEGER DEFAULT 2,
  notes       TEXT,
  image       TEXT,
  active       INTEGER DEFAULT 1,
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS quotes (
  id              TEXT PRIMARY KEY,
  number          TEXT,
  client_id       TEXT,
  title           TEXT,
  status          TEXT DEFAULT 'borrador',
  issue_date      TEXT,
  valid_until     TEXT,
  tax_rate        REAL DEFAULT 0,
  margin_pct      REAL DEFAULT 0,
  discount_type   TEXT DEFAULT 'none',
  discount_value  REAL DEFAULT 0,
  notes           TEXT,
  terms           TEXT,
  subtotal        REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  tax_amount      REAL DEFAULT 0,
  total           REAL DEFAULT 0,
  created_at      TEXT,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS quote_items (
  id          TEXT PRIMARY KEY,
  quote_id    TEXT NOT NULL,
  position    INTEGER DEFAULT 0,
  category    TEXT,
  cost_type   TEXT DEFAULT 'otro',
  description TEXT,
  unit        TEXT DEFAULT 'm2',
  is_area     INTEGER DEFAULT 0,
  width       REAL DEFAULT 0,
  height      REAL DEFAULT 0,
  qcount      REAL DEFAULT 1,
  deduction   REAL DEFAULT 0,
  qty         REAL DEFAULT 0,
  unit_price  REAL DEFAULT 0,
  coats       INTEGER DEFAULT 2,
  paint_yield REAL,
  line_total  REAL DEFAULT 0,
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_quote ON quote_items(quote_id);

CREATE TABLE IF NOT EXISTS plans (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  client_id  TEXT,
  quote_id   TEXT,
  scale      REAL DEFAULT 50,
  area_total REAL DEFAULT 0,
  data       TEXT,
  notes      TEXT,
  created_at TEXT,
  updated_at TEXT
);
`);

// ---------- Migraciones suaves (agrega columnas nuevas a DBs ya creadas) ----------
function ensureCol(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
ensureCol('quote_items', 'cost_type', "TEXT DEFAULT 'otro'");
ensureCol('catalog',     'cost_type', "TEXT DEFAULT 'materiales'");
ensureCol('catalog',     'image',     "TEXT");
ensureCol('quotes',      'margin_pct', "REAL DEFAULT 0");

// ---------- Valores por defecto (primera corrida) ----------
const DEFAULT_META = {
  company_name:    'MESHIPPING // TERMINAL',
  company_tagline: 'Pintura · Gypsum · Remodelaciones',
  company_phone:   '',
  company_email:   '',
  company_address: '',
  company_logo:    '',            // data URL o ruta; se integra cuando llegue el logo
  currency:        'USD',
  currency_symbol: '$',
  tax_name:        'ITBMS',
  tax_rate:        '7',
  quote_prefix:    'COT',
  next_number:     '1',
  validity_days:   '15',
  default_terms:   'Precios en USD. Validez de la oferta segun fecha indicada. 50% de adelanto para iniciar, 50% contra entrega. No incluye trabajos no especificados en esta cotizacion.',
  default_coats:   '2',
  default_yield:   '35',          // rendimiento m2 por galon (referencia)
  default_margin:  '35',          // ganancia % por defecto (competitivo Panama)
  // --- Motor de calculo inteligente (defaults) ---
  precio_galon:    '25',          // costo por galon de pintura
  desperdicio:     '12',          // % de desperdicio de material
  umbral_vano:     '1.5',         // m2: vanos <= no descuentan material
  tarifa_base_m2:  '12',          // mano de obra por m2 (rodillo)
  tarifa_recorte_ml:'4.5',        // mano de obra por metro lineal de recorte/perfilado
  reja_cost_m2:    '35',          // costo de reja metalica por m2 de ventana
  // --- Niveles Basico/Estandar/Premium ---
  niveles_on:         '1',        // mostrar niveles en la cotizacion impresa
  nivel_basico_factor:'0.88',     // precio = total x factor
  nivel_premium_factor:'1.25',
  nivel_basico_desc:  'Materiales estandar, preparacion minima, 1 mano segun superficie.',
  nivel_estandar_desc:'Pintura de alta durabilidad, preparacion completa, 2 manos y garantia.',
  nivel_premium_desc: 'Materiales premium/ecologicos, reparaciones integrales, limpieza profunda post-obra y garantia extendida.'
};
function metaGet(key) {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return r ? r.value : undefined;
}
function metaSet(key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value ?? ''));
}
for (const [k, v] of Object.entries(DEFAULT_META)) {
  if (metaGet(k) === undefined) metaSet(k, v);
}

// ============================================================
// HELPERS
// ============================================================
const uid  = () => crypto.randomUUID();
const now  = () => new Date().toISOString();
const num  = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2   = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const str  = (v) => (v == null ? '' : String(v));

function nextQuoteNumber() {
  const prefix = metaGet('quote_prefix') || 'COT';
  const n = parseInt(metaGet('next_number') || '1', 10) || 1;
  metaSet('next_number', n + 1);
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

// Calcula cantidad y total de una partida
function computeItem(it) {
  let qty = num(it.qty);
  if (it.is_area) {
    const area = num(it.width) * num(it.height) * num(it.qcount || 1);
    qty = Math.max(0, area - num(it.deduction));
  }
  qty = r2(qty);
  const lineTotal = r2(qty * num(it.unit_price));
  return { qty, lineTotal };
}

// Recalcula todos los totales de una cotizacion a partir de sus partidas
function computeTotals(quote, items) {
  // La suma de las partidas es el COSTO; se le aplica la ganancia (margin_pct)
  // para obtener el precio de venta (subtotal).
  let cost = 0;
  for (const it of items) cost += num(it.line_total);
  cost = r2(cost);
  const marginAmount = r2(cost * num(quote.margin_pct) / 100);
  const subtotal = r2(cost + marginAmount); // precio de venta antes de descuento

  let discount = 0;
  if (quote.discount_type === 'percent') discount = r2(subtotal * num(quote.discount_value) / 100);
  else if (quote.discount_type === 'amount') discount = r2(num(quote.discount_value));
  discount = Math.min(discount, subtotal);

  const taxable = r2(subtotal - discount);
  const taxAmount = r2(taxable * num(quote.tax_rate) / 100);
  const total = r2(taxable + taxAmount);
  return { subtotal, discount_amount: discount, tax_amount: taxAmount, total };
}

function getQuoteFull(id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(id);
  if (!q) return null;
  q.items = db.prepare('SELECT * FROM quote_items WHERE quote_id=? ORDER BY position, rowid').all(id);
  q.client = q.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(q.client_id) : null;
  return q;
}

// Inserta/reemplaza las partidas y guarda los totales de la cotizacion
function saveQuoteItems(quoteId, rawItems, quote) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(quoteId);
  const ins = db.prepare(`INSERT INTO quote_items
    (id, quote_id, position, category, cost_type, description, unit, is_area, width, height, qcount, deduction, qty, unit_price, coats, paint_yield, line_total, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const stored = [];
  items.forEach((it, i) => {
    const isArea = it.is_area ? 1 : 0;
    const { qty, lineTotal } = computeItem({ ...it, is_area: isArea });
    const row = {
      id: it.id || uid(), position: i,
      category: str(it.category), cost_type: str(it.cost_type) || 'otro',
      description: str(it.description),
      unit: str(it.unit) || 'm2', is_area: isArea,
      width: num(it.width), height: num(it.height), qcount: num(it.qcount, 1),
      deduction: num(it.deduction), qty, unit_price: num(it.unit_price),
      coats: num(it.coats, 2), paint_yield: it.paint_yield == null ? null : num(it.paint_yield),
      line_total: lineTotal, notes: str(it.notes)
    };
    ins.run(row.id, quoteId, row.position, row.category, row.cost_type, row.description, row.unit, row.is_area,
      row.width, row.height, row.qcount, row.deduction, row.qty, row.unit_price, row.coats,
      row.paint_yield, row.line_total, row.notes);
    stored.push(row);
  });
  const totals = computeTotals(quote, stored);
  db.prepare(`UPDATE quotes SET subtotal=?, discount_amount=?, tax_amount=?, total=?, updated_at=? WHERE id=?`)
    .run(totals.subtotal, totals.discount_amount, totals.tax_amount, totals.total, now(), quoteId);
  return totals;
}

// Pequeno wrapper para rutas async/sync con manejo de errores
const wrap = (fn) => (req, res) => {
  try { fn(req, res); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message || 'Error interno' }); }
};

// ============================================================
// API
// ============================================================
app.get('/api/health', (req, res) => res.json({ ok: true, ts: now() }));

// ---------- Ajustes ----------
app.get('/api/settings', wrap((req, res) => {
  const rows = db.prepare('SELECT key, value FROM meta').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
}));

app.put('/api/settings', wrap((req, res) => {
  const body = req.body || {};
  tx(() => { for (const [k, v] of Object.entries(body)) metaSet(k, v); });
  const rows = db.prepare('SELECT key, value FROM meta').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
}));

// ---------- Clientes ----------
app.get('/api/clients', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY name COLLATE NOCASE').all());
}));

app.post('/api/clients', wrap((req, res) => {
  const b = req.body || {};
  if (!str(b.name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const id = uid(), t = now();
  db.prepare('INSERT INTO clients (id,name,phone,email,address,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, str(b.name).trim(), str(b.phone), str(b.email), str(b.address), str(b.notes), t, t);
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(id));
}));

app.put('/api/clients/:id', wrap((req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT id FROM clients WHERE id=?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Cliente no encontrado' });
  db.prepare('UPDATE clients SET name=?, phone=?, email=?, address=?, notes=?, updated_at=? WHERE id=?')
    .run(str(b.name).trim(), str(b.phone), str(b.email), str(b.address), str(b.notes), now(), req.params.id);
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id));
}));

app.delete('/api/clients/:id', wrap((req, res) => {
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Catalogo de precios ----------
app.get('/api/catalog', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM catalog ORDER BY category, name COLLATE NOCASE').all());
}));

app.post('/api/catalog', wrap((req, res) => {
  const b = req.body || {};
  if (!str(b.name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const id = uid(), t = now();
  db.prepare(`INSERT INTO catalog (id,category,cost_type,name,unit,unit_price,paint_yield,coats,notes,image,active,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, str(b.category), str(b.cost_type) || 'materiales', str(b.name).trim(), str(b.unit) || 'm2', num(b.unit_price),
         b.paint_yield == null || b.paint_yield === '' ? null : num(b.paint_yield),
         num(b.coats, 2), str(b.notes), str(b.image), b.active === 0 ? 0 : 1, t, t);
  res.json(db.prepare('SELECT * FROM catalog WHERE id=?').get(id));
}));

app.put('/api/catalog/:id', wrap((req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT id FROM catalog WHERE id=?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Item no encontrado' });
  db.prepare(`UPDATE catalog SET category=?, cost_type=?, name=?, unit=?, unit_price=?, paint_yield=?, coats=?, notes=?, image=?, active=?, updated_at=? WHERE id=?`)
    .run(str(b.category), str(b.cost_type) || 'materiales', str(b.name).trim(), str(b.unit) || 'm2', num(b.unit_price),
         b.paint_yield == null || b.paint_yield === '' ? null : num(b.paint_yield),
         num(b.coats, 2), str(b.notes), str(b.image), b.active === 0 ? 0 : 1, now(), req.params.id);
  res.json(db.prepare('SELECT * FROM catalog WHERE id=?').get(req.params.id));
}));

app.delete('/api/catalog/:id', wrap((req, res) => {
  db.prepare('DELETE FROM catalog WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Cotizaciones ----------
app.get('/api/quotes', wrap((req, res) => {
  const rows = db.prepare(`
    SELECT q.*, c.name AS client_name
    FROM quotes q LEFT JOIN clients c ON c.id = q.client_id
    ORDER BY q.created_at DESC`).all();
  res.json(rows);
}));

app.get('/api/quotes/:id', wrap((req, res) => {
  const q = getQuoteFull(req.params.id);
  if (!q) return res.status(404).json({ error: 'Cotizacion no encontrada' });
  res.json(q);
}));

app.post('/api/quotes', wrap((req, res) => {
  const b = req.body || {};
  const id = uid(), t = now();
  const validityDays = parseInt(metaGet('validity_days') || '15', 10) || 15;
  const issue = str(b.issue_date) || t.slice(0, 10);
  const validUntil = str(b.valid_until) || new Date(Date.now() + validityDays * 864e5).toISOString().slice(0, 10);
  const quote = {
    id, number: str(b.number) || nextQuoteNumber(),
    client_id: b.client_id || null, title: str(b.title),
    status: str(b.status) || 'borrador', issue_date: issue, valid_until: validUntil,
    tax_rate: b.tax_rate == null ? num(metaGet('tax_rate'), 0) : num(b.tax_rate),
    margin_pct: num(b.margin_pct),
    discount_type: str(b.discount_type) || 'none', discount_value: num(b.discount_value),
    notes: str(b.notes), terms: b.terms == null ? (metaGet('default_terms') || '') : str(b.terms)
  };
  tx(() => {
    db.prepare(`INSERT INTO quotes
      (id,number,client_id,title,status,issue_date,valid_until,tax_rate,margin_pct,discount_type,discount_value,notes,terms,subtotal,discount_amount,tax_amount,total,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,0,?,?)`)
      .run(quote.id, quote.number, quote.client_id, quote.title, quote.status, quote.issue_date,
           quote.valid_until, quote.tax_rate, quote.margin_pct, quote.discount_type, quote.discount_value,
           quote.notes, quote.terms, t, t);
    saveQuoteItems(id, b.items, quote);
  });
  res.json(getQuoteFull(id));
}));

app.put('/api/quotes/:id', wrap((req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Cotizacion no encontrada' });
  const quote = {
    id: cur.id,
    client_id: b.client_id === undefined ? cur.client_id : (b.client_id || null),
    title: b.title === undefined ? cur.title : str(b.title),
    status: b.status === undefined ? cur.status : str(b.status),
    issue_date: b.issue_date === undefined ? cur.issue_date : str(b.issue_date),
    valid_until: b.valid_until === undefined ? cur.valid_until : str(b.valid_until),
    tax_rate: b.tax_rate === undefined ? cur.tax_rate : num(b.tax_rate),
    margin_pct: b.margin_pct === undefined ? cur.margin_pct : num(b.margin_pct),
    discount_type: b.discount_type === undefined ? cur.discount_type : str(b.discount_type),
    discount_value: b.discount_value === undefined ? cur.discount_value : num(b.discount_value),
    notes: b.notes === undefined ? cur.notes : str(b.notes),
    terms: b.terms === undefined ? cur.terms : str(b.terms)
  };
  tx(() => {
    db.prepare(`UPDATE quotes SET client_id=?, title=?, status=?, issue_date=?, valid_until=?,
      tax_rate=?, margin_pct=?, discount_type=?, discount_value=?, notes=?, terms=?, updated_at=? WHERE id=?`)
      .run(quote.client_id, quote.title, quote.status, quote.issue_date, quote.valid_until,
           quote.tax_rate, quote.margin_pct, quote.discount_type, quote.discount_value, quote.notes, quote.terms,
           now(), cur.id);
    if (b.items !== undefined) saveQuoteItems(cur.id, b.items, quote);
    else { // recalcular con partidas existentes (por si cambio impuesto/descuento)
      const existing = db.prepare('SELECT * FROM quote_items WHERE quote_id=?').all(cur.id);
      const totals = computeTotals(quote, existing);
      db.prepare('UPDATE quotes SET subtotal=?, discount_amount=?, tax_amount=?, total=? WHERE id=?')
        .run(totals.subtotal, totals.discount_amount, totals.tax_amount, totals.total, cur.id);
    }
  });
  res.json(getQuoteFull(cur.id));
}));

app.patch('/api/quotes/:id/status', wrap((req, res) => {
  const status = str((req.body || {}).status);
  const ok = ['borrador', 'enviada', 'aprobada', 'rechazada'];
  if (!ok.includes(status)) return res.status(400).json({ error: 'Estado invalido' });
  const exists = db.prepare('SELECT id FROM quotes WHERE id=?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Cotizacion no encontrada' });
  db.prepare('UPDATE quotes SET status=?, updated_at=? WHERE id=?').run(status, now(), req.params.id);
  res.json(getQuoteFull(req.params.id));
}));

app.post('/api/quotes/:id/duplicate', wrap((req, res) => {
  const src = getQuoteFull(req.params.id);
  if (!src) return res.status(404).json({ error: 'Cotizacion no encontrada' });
  const id = uid(), t = now();
  const quote = {
    id, client_id: src.client_id, title: src.title ? src.title + ' (copia)' : '',
    status: 'borrador', issue_date: t.slice(0, 10), valid_until: src.valid_until,
    tax_rate: src.tax_rate, margin_pct: src.margin_pct, discount_type: src.discount_type, discount_value: src.discount_value,
    notes: src.notes, terms: src.terms
  };
  tx(() => {
    const number = nextQuoteNumber();
    db.prepare(`INSERT INTO quotes
      (id,number,client_id,title,status,issue_date,valid_until,tax_rate,margin_pct,discount_type,discount_value,notes,terms,subtotal,discount_amount,tax_amount,total,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,0,?,?)`)
      .run(id, number, quote.client_id, quote.title, quote.status, quote.issue_date, quote.valid_until,
           quote.tax_rate, quote.margin_pct, quote.discount_type, quote.discount_value, quote.notes, quote.terms, t, t);
    saveQuoteItems(id, src.items, quote);
  });
  res.json(getQuoteFull(id));
}));

app.delete('/api/quotes/:id', wrap((req, res) => {
  tx(() => {
    db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(req.params.id);
    db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id);
  });
  res.json({ ok: true });
}));

// ---------- Planos / croquis ----------
app.get('/api/plans', wrap((req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.scale, p.area_total, p.client_id, p.quote_id, p.created_at, p.updated_at,
           c.name AS client_name
    FROM plans p LEFT JOIN clients c ON c.id = p.client_id
    ORDER BY p.updated_at DESC`).all();
  res.json(rows);
}));

app.get('/api/plans/:id', wrap((req, res) => {
  const p = db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Plano no encontrado' });
  try { p.data = JSON.parse(p.data || '{}'); } catch { p.data = {}; }
  res.json(p);
}));

app.post('/api/plans', wrap((req, res) => {
  const b = req.body || {};
  const id = uid(), t = now();
  db.prepare(`INSERT INTO plans (id,name,client_id,quote_id,scale,area_total,data,notes,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, str(b.name) || 'Plano', b.client_id || null, b.quote_id || null,
         num(b.scale, 50), num(b.area_total), JSON.stringify(b.data || {}), str(b.notes), t, t);
  const p = db.prepare('SELECT * FROM plans WHERE id=?').get(id);
  try { p.data = JSON.parse(p.data || '{}'); } catch { p.data = {}; }
  res.json(p);
}));

app.put('/api/plans/:id', wrap((req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT id FROM plans WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Plano no encontrado' });
  db.prepare(`UPDATE plans SET name=?, client_id=?, quote_id=?, scale=?, area_total=?, data=?, notes=?, updated_at=? WHERE id=?`)
    .run(str(b.name) || 'Plano', b.client_id || null, b.quote_id || null, num(b.scale, 50),
         num(b.area_total), JSON.stringify(b.data || {}), str(b.notes), now(), req.params.id);
  const p = db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id);
  try { p.data = JSON.parse(p.data || '{}'); } catch { p.data = {}; }
  res.json(p);
}));

app.delete('/api/plans/:id', wrap((req, res) => {
  db.prepare('DELETE FROM plans WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Resumen / dashboard ----------
app.get('/api/summary', wrap((req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(total),0) monto FROM quotes GROUP BY status').all();
  const totals = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) monto FROM quotes').get();
  const clients = db.prepare('SELECT COUNT(*) n FROM clients').get();
  res.json({ byStatus, totals, clients: clients.n });
}));

// ============================================================
// FRONTEND
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`pinta-cotiza escuchando en http://localhost:${PORT}`));
