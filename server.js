// ============================================================
// MESHIPPING // TERMINAL  —  meshipping-system  v2.0
// Sistema de gestión empresarial: proyectos, cotizaciones, personal,
// finanzas, inventario, agenda, reportes
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

-- ========= MESHIPPING-SYSTEM v2.0 — tablas empresariales =========

CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  number         TEXT,
  name           TEXT NOT NULL,
  client_id      TEXT,
  quote_id       TEXT,
  type           TEXT DEFAULT 'general',   -- papel-ahumado, pintura, gypsum, remodelacion, general
  status         TEXT DEFAULT 'planificacion', -- planificacion, en_curso, pausado, terminado, cobrado, cerrado, cancelado
  location       TEXT,
  start_date     TEXT,
  end_date       TEXT,
  measure_unit   TEXT DEFAULT 'm2',       -- m2 o ft (lineal) según el proyecto
  measure_total  REAL DEFAULT 0,
  contract_value REAL DEFAULT 0,          -- valor contratado con cliente
  viaticos_value REAL DEFAULT 0,          -- valor de viáticos cobrado
  notes          TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

CREATE TABLE IF NOT EXISTS project_phases (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  position    INTEGER DEFAULT 0,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'pendiente',   -- pendiente, en_curso, completado
  planned_start TEXT,
  planned_end   TEXT,
  actual_start  TEXT,
  actual_end    TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_phases_project ON project_phases(project_id);

CREATE TABLE IF NOT EXISTS project_expenses (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  date        TEXT,
  category    TEXT,                       -- materiales, personal, viaticos, combustible, alquiler, otros
  description TEXT,
  amount      REAL DEFAULT 0,
  paid_to     TEXT,                       -- a quién se pagó (proveedor / trabajador)
  receipt     TEXT,                       -- URL o referencia de boleta
  notes       TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON project_expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON project_expenses(date);

CREATE TABLE IF NOT EXISTS project_payments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  date        TEXT,
  type        TEXT,                       -- adelanto, parcial, final, viaticos, extra
  amount      REAL DEFAULT 0,
  method      TEXT,                       -- efectivo, yappy, transferencia, cheque
  reference   TEXT,
  notes       TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_project ON project_payments(project_id);

CREATE TABLE IF NOT EXISTS project_photos (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  phase       TEXT,                       -- antes, durante, despues
  url         TEXT,                       -- data URL o referencia
  caption     TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_photos_project ON project_photos(project_id);

CREATE TABLE IF NOT EXISTS personnel (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  specialty     TEXT,                     -- pintor, instalador-tint, ayudante, chofer, gypsum, general
  phone         TEXT,
  email         TEXT,
  id_number     TEXT,                     -- cédula
  address       TEXT,
  rate_m2       REAL DEFAULT 0,           -- tarifa por m² de pintura/gypsum
  rate_ft       REAL DEFAULT 0,           -- tarifa por ft lineal (papel ahumado)
  rate_day      REAL DEFAULT 0,           -- tarifa por día
  rate_global   REAL DEFAULT 0,           -- tarifa fija por proyecto (si aplica)
  notes         TEXT,
  active        INTEGER DEFAULT 1,
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_personnel_active ON personnel(active);

CREATE TABLE IF NOT EXISTS project_personnel (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  personnel_id  TEXT NOT NULL,
  role          TEXT,                     -- líder, instalador, ayudante, chofer
  rate_type     TEXT,                     -- m2, ft, day, global
  rate_value    REAL DEFAULT 0,           -- tarifa pactada para este proyecto
  qty           REAL DEFAULT 0,           -- cantidad (m², ft, días trabajados)
  total_pay     REAL DEFAULT 0,           -- total a pagar
  paid          REAL DEFAULT 0,           -- ya pagado
  notes         TEXT,
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_pp_project ON project_personnel(project_id);
CREATE INDEX IF NOT EXISTS idx_pp_personnel ON project_personnel(personnel_id);

CREATE TABLE IF NOT EXISTS cash_movements (
  id          TEXT PRIMARY KEY,
  date        TEXT,
  type        TEXT,                       -- ingreso, gasto
  category    TEXT,                       -- cobro-proyecto, gasto-proyecto, administrativo, personal, otro
  project_id  TEXT,                       -- opcional, si está asociado a un proyecto
  description TEXT,
  amount      REAL DEFAULT 0,
  method      TEXT,                       -- efectivo, banco, yappy
  notes       TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_movements(date);
CREATE INDEX IF NOT EXISTS idx_cash_project ON cash_movements(project_id);

CREATE TABLE IF NOT EXISTS inventory_items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,                       -- pintura, herramienta, papel-ahumado, consumible
  unit        TEXT DEFAULT 'und',
  stock       REAL DEFAULT 0,
  min_stock   REAL DEFAULT 0,
  avg_cost    REAL DEFAULT 0,             -- costo promedio por unidad
  location    TEXT,                       -- dónde está guardado
  notes       TEXT,
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_category ON inventory_items(category);

CREATE TABLE IF NOT EXISTS inventory_moves (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  date        TEXT,
  type        TEXT,                       -- entrada, salida
  qty         REAL DEFAULT 0,
  cost        REAL DEFAULT 0,             -- costo unitario
  project_id  TEXT,                       -- si se consumió en un proyecto
  notes       TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_invmov_item ON inventory_moves(item_id);

CREATE TABLE IF NOT EXISTS agenda_events (
  id          TEXT PRIMARY KEY,
  date        TEXT,
  time        TEXT,
  type        TEXT,                       -- visita, instalacion, cobro, reunion, otro
  title       TEXT,
  project_id  TEXT,
  client_id   TEXT,
  location    TEXT,
  notes       TEXT,
  done        INTEGER DEFAULT 0,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_agenda_date ON agenda_events(date);

CREATE TABLE IF NOT EXISTS leads (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  source      TEXT,                       -- whatsapp, referido, instagram, web, otro
  interest    TEXT,                       -- qué le interesa
  status      TEXT DEFAULT 'nuevo',       -- nuevo, contactado, cotizado, ganado, perdido
  value_est   REAL DEFAULT 0,
  next_action TEXT,
  next_date   TEXT,
  notes       TEXT,
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
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
// Partidas exentas de impuesto y/o sin margen (v2.2) — p.ej. viáticos reembolsables
ensureCol('quote_items', 'taxable',      "INTEGER DEFAULT 1");
ensureCol('quote_items', 'apply_margin', "INTEGER DEFAULT 1");
ensureCol('quotes',      'taxable_base', "REAL DEFAULT 0");
ensureCol('quotes',      'exempt_base',  "REAL DEFAULT 0");
// Unificación clientes + prospectos (v2.1)
ensureCol('clients',     'status',      "TEXT DEFAULT 'cliente'");  // cliente, prospecto, ganado, perdido
ensureCol('clients',     'source',      "TEXT");                    // whatsapp, referido, instagram, web, otro
ensureCol('clients',     'interest',    "TEXT");
ensureCol('clients',     'value_est',   "REAL DEFAULT 0");
ensureCol('clients',     'next_action', "TEXT");
ensureCol('clients',     'next_date',   "TEXT");

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

// Recalcula todos los totales de una cotizacion a partir de sus partidas.
// Cada partida puede:
//   - recibir o no el margen de ganancia (apply_margin)
//   - estar gravada o exenta del impuesto (taxable)
// Esto permite cobrar viaticos al costo y sin ITBMS dentro de la misma cotizacion.
function computeTotals(quote, items) {
  const marginPct = num(quote.margin_pct);
  let cost = 0;          // costo total de todas las partidas
  let baseTaxable = 0;   // precio de venta de las partidas gravadas
  let baseExempt = 0;    // precio de venta de las partidas exentas

  for (const it of items) {
    const line = num(it.line_total);
    cost += line;
    // apply_margin indefinido = true (compatibilidad con partidas antiguas)
    const withMargin = (it.apply_margin === undefined || it.apply_margin === null)
      ? true : !!Number(it.apply_margin);
    const sale = withMargin ? line * (1 + marginPct / 100) : line;
    const isTaxable = (it.taxable === undefined || it.taxable === null)
      ? true : !!Number(it.taxable);
    if (isTaxable) baseTaxable += sale; else baseExempt += sale;
  }
  cost = r2(cost);
  baseTaxable = r2(baseTaxable);
  baseExempt = r2(baseExempt);
  const subtotal = r2(baseTaxable + baseExempt);

  let discount = 0;
  if (quote.discount_type === 'percent') discount = r2(subtotal * num(quote.discount_value) / 100);
  else if (quote.discount_type === 'amount') discount = r2(num(quote.discount_value));
  discount = Math.min(discount, subtotal);

  // El descuento se reparte proporcionalmente para no gravar de mas lo exento
  const shareTaxable = subtotal > 0 ? baseTaxable / subtotal : 0;
  const netTaxable = r2(baseTaxable - discount * shareTaxable);
  const taxAmount = r2(netTaxable * num(quote.tax_rate) / 100);
  const total = r2(subtotal - discount + taxAmount);

  return {
    subtotal, discount_amount: discount, tax_amount: taxAmount, total,
    taxable_base: baseTaxable, exempt_base: baseExempt
  };
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
    (id, quote_id, position, category, cost_type, description, unit, is_area, width, height, qcount, deduction, qty, unit_price, coats, paint_yield, line_total, notes, taxable, apply_margin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
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
      line_total: lineTotal, notes: str(it.notes),
      // Por defecto toda partida es gravable y recibe margen
      taxable:      (it.taxable      === 0 || it.taxable      === false) ? 0 : 1,
      apply_margin: (it.apply_margin === 0 || it.apply_margin === false) ? 0 : 1
    };
    ins.run(row.id, quoteId, row.position, row.category, row.cost_type, row.description, row.unit, row.is_area,
      row.width, row.height, row.qcount, row.deduction, row.qty, row.unit_price, row.coats,
      row.paint_yield, row.line_total, row.notes, row.taxable, row.apply_margin);
    stored.push(row);
  });
  const totals = computeTotals(quote, stored);
  db.prepare(`UPDATE quotes SET subtotal=?, discount_amount=?, tax_amount=?, total=?,
      taxable_base=?, exempt_base=?, updated_at=? WHERE id=?`)
    .run(totals.subtotal, totals.discount_amount, totals.tax_amount, totals.total,
         totals.taxable_base, totals.exempt_base, now(), quoteId);
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
  db.prepare(`INSERT INTO clients
    (id,name,phone,email,address,notes,status,source,interest,value_est,next_action,next_date,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, str(b.name).trim(), str(b.phone), str(b.email), str(b.address), str(b.notes),
         str(b.status) || 'cliente', str(b.source), str(b.interest), num(b.value_est),
         str(b.next_action), b.next_date || null, t, t);
  res.json(db.prepare('SELECT * FROM clients WHERE id=?').get(id));
}));

app.put('/api/clients/:id', wrap((req, res) => {
  const b = req.body || {};
  const exists = db.prepare('SELECT id FROM clients WHERE id=?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Cliente no encontrado' });
  db.prepare(`UPDATE clients SET name=?, phone=?, email=?, address=?, notes=?,
    status=?, source=?, interest=?, value_est=?, next_action=?, next_date=?, updated_at=? WHERE id=?`)
    .run(str(b.name).trim(), str(b.phone), str(b.email), str(b.address), str(b.notes),
         str(b.status) || 'cliente', str(b.source), str(b.interest), num(b.value_est),
         str(b.next_action), b.next_date || null, now(), req.params.id);
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

// ============================================================
// PROYECTOS
// ============================================================
function projectNumber(){
  const n = Number(metaGet('next_project_number') || 1);
  metaSet('next_project_number', n + 1);
  const year = new Date().getFullYear();
  return `PRJ-${year}-${String(n).padStart(4, '0')}`;
}
function getProjectFull(id){
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!p) return null;
  p.client = p.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(p.client_id) : null;
  p.phases = db.prepare('SELECT * FROM project_phases WHERE project_id=? ORDER BY position, rowid').all(id);
  p.expenses = db.prepare('SELECT * FROM project_expenses WHERE project_id=? ORDER BY date DESC, rowid DESC').all(id);
  p.payments = db.prepare('SELECT * FROM project_payments WHERE project_id=? ORDER BY date DESC, rowid DESC').all(id);
  p.personnel = db.prepare(`SELECT pp.*, pe.name AS personnel_name, pe.specialty
                            FROM project_personnel pp
                            LEFT JOIN personnel pe ON pe.id = pp.personnel_id
                            WHERE pp.project_id=? ORDER BY pp.rowid`).all(id);
  p.photos = db.prepare('SELECT * FROM project_photos WHERE project_id=? ORDER BY created_at').all(id);
  // Totales
  p.total_expenses = p.expenses.reduce((s,x)=>s+num(x.amount),0);
  p.total_payments = p.payments.reduce((s,x)=>s+num(x.amount),0);
  p.total_personnel_cost = p.personnel.reduce((s,x)=>s+num(x.total_pay),0);
  p.total_personnel_paid = p.personnel.reduce((s,x)=>s+num(x.paid),0);
  p.profit = p.total_payments - p.total_expenses - p.total_personnel_cost;
  p.balance_due = num(p.contract_value) + num(p.viaticos_value) - p.total_payments;
  return p;
}

app.get('/api/projects', wrap((req, res) => {
  const list = db.prepare(`
    SELECT p.*, c.name AS client_name,
      COALESCE((SELECT SUM(amount) FROM project_payments WHERE project_id = p.id), 0)   AS paid_in,
      COALESCE((SELECT SUM(amount) FROM project_expenses WHERE project_id = p.id), 0)   AS spent,
      COALESCE((SELECT SUM(total_pay) FROM project_personnel WHERE project_id = p.id),0) AS crew_cost,
      COALESCE((SELECT SUM(paid) FROM project_personnel WHERE project_id = p.id), 0)    AS crew_paid,
      (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id)                      AS phases_total,
      (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id AND status='completado') AS phases_done
    FROM projects p LEFT JOIN clients c ON c.id = p.client_id
    ORDER BY p.created_at DESC
  `).all();
  // Campos derivados para que el frontend no tenga que recalcular
  list.forEach(p => {
    p.total_value  = r2(num(p.contract_value) + num(p.viaticos_value));
    p.balance_due  = r2(p.total_value - num(p.paid_in));              // lo que falta cobrar
    p.crew_due     = r2(num(p.crew_cost) - num(p.crew_paid));         // lo que falta pagar al personal
    p.profit       = r2(num(p.paid_in) - num(p.spent) - num(p.crew_cost));
    p.pct_collected = p.total_value > 0 ? Math.round(num(p.paid_in) / p.total_value * 100) : 0;
    p.pct_phases    = p.phases_total > 0 ? Math.round(p.phases_done / p.phases_total * 100) : 0;
  });
  res.json(list);
}));

app.get('/api/projects/:id', wrap((req, res) => {
  const p = getProjectFull(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json(p);
}));

app.post('/api/projects', wrap((req, res) => {
  const b = req.body || {};
  const id = uid();
  const type = str(b.type) || 'general';
  tx(() => {
    db.prepare(`INSERT INTO projects
      (id, number, name, client_id, quote_id, type, status, location, start_date, end_date,
       measure_unit, measure_total, contract_value, viaticos_value, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, b.number || projectNumber(), str(b.name).trim() || 'Proyecto sin nombre',
           b.client_id || null, b.quote_id || null, type,
           str(b.status) || 'planificacion', str(b.location), b.start_date || null, b.end_date || null,
           str(b.measure_unit) || 'm2', num(b.measure_total), num(b.contract_value), num(b.viaticos_value),
           str(b.notes), now(), now());
    if (b.seed_phases !== false) seedPhases(id, type);
  });
  res.json(getProjectFull(id));
}));

app.put('/api/projects/:id', wrap((req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'No encontrado' });
  db.prepare(`UPDATE projects SET name=?, client_id=?, type=?, status=?, location=?,
    start_date=?, end_date=?, measure_unit=?, measure_total=?, contract_value=?, viaticos_value=?,
    notes=?, updated_at=? WHERE id=?`)
    .run(str(b.name).trim() || cur.name, b.client_id || null, str(b.type) || cur.type,
         str(b.status) || cur.status, str(b.location), b.start_date || null, b.end_date || null,
         str(b.measure_unit) || cur.measure_unit, num(b.measure_total), num(b.contract_value),
         num(b.viaticos_value), str(b.notes), now(), cur.id);
  res.json(getProjectFull(cur.id));
}));

app.delete('/api/projects/:id', wrap((req, res) => {
  tx(() => {
    ['project_phases','project_expenses','project_payments','project_personnel','project_photos']
      .forEach(t => db.prepare(`DELETE FROM ${t} WHERE project_id=?`).run(req.params.id));
    db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);
  });
  res.json({ ok: true });
}));

// Plantillas de fases por tipo de proyecto
const PHASE_TEMPLATES = {
  'papel-ahumado': [
    'Firma de aceptación y cobro del adelanto',
    'Compra de materiales y película',
    'Alquiler de vehículo y traslado al sitio',
    'Llegada, hospedaje y preparación logística',
    'Inspección en obra y armado de equipos',
    'Limpieza de vidrios e instalación',
    'Limpieza final y entrega',
    'Cobro del saldo y cierre'
  ],
  'pintura': [
    'Firma de aceptación y cobro del adelanto',
    'Compra de pintura y materiales',
    'Preparación de superficies (lijado, resane)',
    'Aplicación de sellador / primer',
    'Primera mano de pintura',
    'Segunda mano y retoques',
    'Limpieza final y entrega',
    'Cobro del saldo y cierre'
  ],
  'gypsum': [
    'Firma de aceptación y cobro del adelanto',
    'Compra de paneles y perfilería',
    'Montaje de estructura metálica',
    'Instalación de paneles',
    'Masillado y acabado de juntas',
    'Lijado y preparación para pintura',
    'Limpieza final y entrega',
    'Cobro del saldo y cierre'
  ],
  'remodelacion': [
    'Firma de aceptación y cobro del adelanto',
    'Compra de materiales',
    'Demolición y preparación',
    'Trabajos de obra gris',
    'Acabados',
    'Limpieza final y entrega',
    'Cobro del saldo y cierre'
  ],
  'general': [
    'Firma de aceptación y cobro del adelanto',
    'Compra de materiales',
    'Ejecución del trabajo',
    'Limpieza final y entrega',
    'Cobro del saldo y cierre'
  ]
};
function seedPhases(projectId, type) {
  const tpl = PHASE_TEMPLATES[type] || PHASE_TEMPLATES.general;
  const ins = db.prepare(`INSERT INTO project_phases
    (id, project_id, position, name, description, status, created_at)
    VALUES (?,?,?,?,?,?,?)`);
  tpl.forEach((name, i) => ins.run(uid(), projectId, i, name, '', 'pendiente', now()));
}

// Crear proyecto a partir de una cotización existente
app.post('/api/projects/from-quote/:quoteId', wrap((req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.quoteId);
  if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });
  const b = req.body || {};
  // detectar unidad y total de medida de las partidas
  const items = db.prepare('SELECT * FROM quote_items WHERE quote_id=?').all(q.id);
  let unit = 'm2', total = 0;
  const ftItems = items.filter(it => it.unit === 'ft');
  if (ftItems.length) {
    unit = 'ft';
    // Las partidas de material e instalación repiten los mismos ft lineales:
    // tomamos el máximo, no la suma, para no duplicar la medida.
    total = Math.max(...ftItems.map(it => num(it.qty)));
  } else {
    total = items.filter(it => it.unit === 'm2').reduce((s,it)=>s+num(it.qty),0);
  }
  // Detectar tipo por las partidas si no viene en el body
  let type = str(b.type);
  if (!type) {
    const txt = items.map(it => str(it.description)).join(' ').toLowerCase();
    if (/ahumado|tint|madico|pel[ií]cula/.test(txt)) type = 'papel-ahumado';
    else if (/gypsum|drywall|panel/.test(txt)) type = 'gypsum';
    else if (/pintura|pintar/.test(txt)) type = 'pintura';
    else type = 'general';
  }
  const id = uid();
  tx(() => {
    db.prepare(`INSERT INTO projects
      (id, number, name, client_id, quote_id, type, status, location, measure_unit, measure_total,
       contract_value, viaticos_value, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, projectNumber(), str(q.title) || 'Proyecto desde '+q.number,
           q.client_id, q.id, type, 'planificacion',
           str(b.location), unit, r2(total), num(q.total),
           num(b.viaticos_value), str(b.notes) || str(q.notes), now(), now());
    seedPhases(id, type);
  });
  res.json(getProjectFull(id));
}));

// Fases
app.post('/api/projects/:id/phases', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  const max = db.prepare('SELECT COALESCE(MAX(position),-1) m FROM project_phases WHERE project_id=?').get(req.params.id).m;
  db.prepare(`INSERT INTO project_phases
    (id, project_id, position, name, description, status, planned_start, planned_end, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, req.params.id, b.position != null ? Number(b.position) : (max+1),
         str(b.name) || 'Fase', str(b.description), str(b.status) || 'pendiente',
         b.planned_start || null, b.planned_end || null, now());
  res.json({ id });
}));
app.put('/api/phases/:id', wrap((req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE project_phases SET name=?, description=?, status=?, planned_start=?, planned_end=?,
    actual_start=?, actual_end=? WHERE id=?`)
    .run(str(b.name), str(b.description), str(b.status) || 'pendiente',
         b.planned_start || null, b.planned_end || null, b.actual_start || null, b.actual_end || null,
         req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/phases/:id', wrap((req, res) => {
  db.prepare('DELETE FROM project_phases WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// --- Espejo en caja: todo movimiento de proyecto se refleja en Finanzas ---
// origin_id guarda el id del gasto/cobro para poder borrar el espejo despues.
function cashMirror({ originId, date, type, category, projectId, description, amount, method }) {
  db.prepare(`INSERT INTO cash_movements
    (id, date, type, category, project_id, description, amount, method, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(uid(), date, type, category, projectId, description, amount, method, 'origin:' + originId, now());
}
function cashMirrorDelete(originId) {
  db.prepare("DELETE FROM cash_movements WHERE notes = ?").run('origin:' + originId);
}

// Gastos
app.post('/api/projects/:id/expenses', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  const date = b.date || now().slice(0,10);
  const cat = str(b.category) || 'otros';
  const desc = str(b.description);
  const amount = num(b.amount);
  tx(() => {
    db.prepare(`INSERT INTO project_expenses
      (id, project_id, date, category, description, amount, paid_to, receipt, notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.params.id, date, cat, desc, amount, str(b.paid_to), str(b.receipt), str(b.notes), now());
    cashMirror({ originId: id, date, type: 'gasto', category: cat, projectId: req.params.id,
                 description: desc || cat, amount, method: str(b.method) || 'efectivo' });
  });
  res.json({ id });
}));
app.delete('/api/expenses/:id', wrap((req, res) => {
  tx(() => {
    db.prepare('DELETE FROM project_expenses WHERE id=?').run(req.params.id);
    cashMirrorDelete(req.params.id);
  });
  res.json({ ok: true });
}));

// Pagos recibidos
app.post('/api/projects/:id/payments', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  const date = b.date || now().slice(0,10);
  const type = str(b.type) || 'parcial';
  const amount = num(b.amount);
  const method = str(b.method) || 'efectivo';
  tx(() => {
    db.prepare(`INSERT INTO project_payments
      (id, project_id, date, type, amount, method, reference, notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, req.params.id, date, type, amount, method, str(b.reference), str(b.notes), now());
    cashMirror({ originId: id, date, type: 'ingreso', category: 'cobro-' + type, projectId: req.params.id,
                 description: 'Cobro ' + type, amount, method });
  });
  res.json({ id });
}));
app.delete('/api/payments/:id', wrap((req, res) => {
  tx(() => {
    db.prepare('DELETE FROM project_payments WHERE id=?').run(req.params.id);
    cashMirrorDelete(req.params.id);
  });
  res.json({ ok: true });
}));

// Personal asignado a proyecto
app.post('/api/projects/:id/personnel', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  const totalPay = num(b.rate_value) * num(b.qty);
  db.prepare(`INSERT INTO project_personnel
    (id, project_id, personnel_id, role, rate_type, rate_value, qty, total_pay, paid, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.params.id, b.personnel_id, str(b.role), str(b.rate_type) || 'day',
         num(b.rate_value), num(b.qty), totalPay, num(b.paid), str(b.notes), now());
  res.json({ id });
}));
app.put('/api/project-personnel/:id', wrap((req, res) => {
  const b = req.body || {};
  const totalPay = num(b.rate_value) * num(b.qty);
  db.prepare(`UPDATE project_personnel SET role=?, rate_type=?, rate_value=?, qty=?, total_pay=?, paid=?, notes=? WHERE id=?`)
    .run(str(b.role), str(b.rate_type) || 'day', num(b.rate_value), num(b.qty), totalPay, num(b.paid), str(b.notes), req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/project-personnel/:id', wrap((req, res) => {
  db.prepare('DELETE FROM project_personnel WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============================================================
// PERSONAL / CONTRATISTAS
// ============================================================
app.get('/api/personnel', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM personnel ORDER BY active DESC, name').all());
}));
app.post('/api/personnel', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  db.prepare(`INSERT INTO personnel
    (id, name, specialty, phone, email, id_number, address, rate_m2, rate_ft, rate_day, rate_global, notes, active, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, str(b.name).trim(), str(b.specialty), str(b.phone), str(b.email), str(b.id_number),
         str(b.address), num(b.rate_m2), num(b.rate_ft), num(b.rate_day), num(b.rate_global),
         str(b.notes), b.active != null ? (b.active?1:0) : 1, now(), now());
  res.json({ id });
}));
app.put('/api/personnel/:id', wrap((req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE personnel SET name=?, specialty=?, phone=?, email=?, id_number=?, address=?,
    rate_m2=?, rate_ft=?, rate_day=?, rate_global=?, notes=?, active=?, updated_at=? WHERE id=?`)
    .run(str(b.name).trim(), str(b.specialty), str(b.phone), str(b.email), str(b.id_number),
         str(b.address), num(b.rate_m2), num(b.rate_ft), num(b.rate_day), num(b.rate_global),
         str(b.notes), b.active ? 1 : 0, now(), req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/personnel/:id', wrap((req, res) => {
  db.prepare('DELETE FROM personnel WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============================================================
// FINANZAS / CAJA
// ============================================================
app.get('/api/cash', wrap((req, res) => {
  const list = db.prepare(`SELECT c.*, p.name AS project_name
    FROM cash_movements c LEFT JOIN projects p ON p.id = c.project_id
    ORDER BY c.date DESC, c.rowid DESC`).all();
  res.json(list);
}));
app.post('/api/cash', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  db.prepare(`INSERT INTO cash_movements
    (id, date, type, category, project_id, description, amount, method, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.date || now().slice(0,10), str(b.type) || 'ingreso', str(b.category),
         b.project_id || null, str(b.description), num(b.amount), str(b.method), str(b.notes), now());
  res.json({ id });
}));
app.delete('/api/cash/:id', wrap((req, res) => {
  db.prepare('DELETE FROM cash_movements WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============================================================
// AGENDA
// ============================================================
app.get('/api/agenda', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM agenda_events ORDER BY date, time').all());
}));
app.post('/api/agenda', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  db.prepare(`INSERT INTO agenda_events
    (id, date, time, type, title, project_id, client_id, location, notes, done, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.date || now().slice(0,10), str(b.time), str(b.type) || 'otro',
         str(b.title), b.project_id || null, b.client_id || null,
         str(b.location), str(b.notes), b.done ? 1 : 0, now());
  res.json({ id });
}));
app.put('/api/agenda/:id', wrap((req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE agenda_events SET date=?, time=?, type=?, title=?, project_id=?, client_id=?,
    location=?, notes=?, done=? WHERE id=?`)
    .run(b.date, str(b.time), str(b.type), str(b.title), b.project_id || null, b.client_id || null,
         str(b.location), str(b.notes), b.done ? 1 : 0, req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/agenda/:id', wrap((req, res) => {
  db.prepare('DELETE FROM agenda_events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============================================================
// INVENTARIO
// ============================================================
app.get('/api/inventory', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM inventory_items ORDER BY name').all());
}));
app.post('/api/inventory', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  db.prepare(`INSERT INTO inventory_items
    (id, name, category, unit, stock, min_stock, avg_cost, location, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, str(b.name).trim(), str(b.category), str(b.unit) || 'und',
         num(b.stock), num(b.min_stock), num(b.avg_cost), str(b.location), str(b.notes), now(), now());
  res.json({ id });
}));
app.put('/api/inventory/:id', wrap((req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE inventory_items SET name=?, category=?, unit=?, stock=?, min_stock=?, avg_cost=?,
    location=?, notes=?, updated_at=? WHERE id=?`)
    .run(str(b.name).trim(), str(b.category), str(b.unit) || 'und', num(b.stock),
         num(b.min_stock), num(b.avg_cost), str(b.location), str(b.notes), now(), req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/inventory/:id', wrap((req, res) => {
  db.prepare('DELETE FROM inventory_items WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ============================================================
// LEADS / CRM
// ============================================================
app.get('/api/leads', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM leads ORDER BY updated_at DESC').all());
}));
app.post('/api/leads', wrap((req, res) => {
  const b = req.body || {}; const id = uid();
  db.prepare(`INSERT INTO leads
    (id, name, phone, email, source, interest, status, value_est, next_action, next_date, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, str(b.name).trim(), str(b.phone), str(b.email), str(b.source), str(b.interest),
         str(b.status) || 'nuevo', num(b.value_est), str(b.next_action), b.next_date || null,
         str(b.notes), now(), now());
  res.json({ id });
}));
app.put('/api/leads/:id', wrap((req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE leads SET name=?, phone=?, email=?, source=?, interest=?, status=?, value_est=?,
    next_action=?, next_date=?, notes=?, updated_at=? WHERE id=?`)
    .run(str(b.name).trim(), str(b.phone), str(b.email), str(b.source), str(b.interest),
         str(b.status), num(b.value_est), str(b.next_action), b.next_date || null,
         str(b.notes), now(), req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/leads/:id', wrap((req, res) => {
  db.prepare('DELETE FROM leads WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- Alertas para el dashboard ----------
app.get('/api/alerts', wrap((req, res) => {
  const today = now().slice(0,10);
  const alerts = [];

  // Proyectos activos con saldo por cobrar
  const porCobrar = db.prepare(`
    SELECT p.id, p.number, p.name,
      (p.contract_value + p.viaticos_value) AS total,
      COALESCE((SELECT SUM(amount) FROM project_payments WHERE project_id = p.id),0) AS paid
    FROM projects p
    WHERE p.status IN ('planificacion','en_curso','pausado','terminado')
  `).all().filter(p => (p.total - p.paid) > 0.5);
  porCobrar.forEach(p => alerts.push({
    kind: 'cobro', level: p.paid === 0 ? 'high' : 'mid',
    icon: '\u{1F4B0}',
    title: p.paid === 0 ? 'Sin cobrar aún' : 'Saldo pendiente de cobro',
    text: p.name,
    amount: r2(p.total - p.paid), projectId: p.id
  }));

  // Personal con pagos pendientes
  const porPagar = db.prepare(`
    SELECT p.id, p.name AS project_name, pe.name AS person,
      pp.total_pay, pp.paid
    FROM project_personnel pp
    JOIN projects p ON p.id = pp.project_id
    LEFT JOIN personnel pe ON pe.id = pp.personnel_id
    WHERE (pp.total_pay - pp.paid) > 0.5
  `).all();
  porPagar.forEach(x => alerts.push({
    kind: 'pago', level: 'mid', icon: '\u{1F477}',
    title: 'Pago pendiente al personal',
    text: `${x.person || 'Trabajador'} en ${x.project_name}`,
    amount: r2(x.total_pay - x.paid), projectId: x.id
  }));

  // Eventos de agenda de hoy o vencidos sin hacer
  const eventos = db.prepare(`SELECT * FROM agenda_events WHERE done = 0 AND date <= ? ORDER BY date`).all(today);
  eventos.forEach(e => alerts.push({
    kind: 'agenda', level: e.date < today ? 'high' : 'mid',
    icon: e.date < today ? '\u{23F0}' : '\u{1F4C5}',
    title: e.date < today ? 'Evento vencido' : 'Hoy en agenda',
    text: `${e.title}${e.time ? ' · ' + e.time : ''}`,
    date: e.date
  }));

  // Cotizaciones enviadas sin respuesta hace mas de 7 dias
  const limite = new Date(Date.now() - 7*864e5).toISOString().slice(0,10);
  const colgadas = db.prepare(`
    SELECT q.id, q.number, q.total, q.issue_date, c.name AS client_name
    FROM quotes q LEFT JOIN clients c ON c.id = q.client_id
    WHERE q.status = 'enviada' AND q.issue_date <= ?
  `).all(limite);
  colgadas.forEach(q => alerts.push({
    kind: 'seguimiento', level: 'mid', icon: '\u{1F4E8}',
    title: 'Cotización sin respuesta',
    text: `${q.number} · ${q.client_name || 'Sin cliente'}`,
    amount: r2(q.total), quoteId: q.id
  }));

  // Inventario bajo minimo
  const bajos = db.prepare('SELECT * FROM inventory_items WHERE min_stock > 0 AND stock <= min_stock').all();
  bajos.forEach(i => alerts.push({
    kind: 'stock', level: 'low', icon: '\u{1F4E6}',
    title: 'Stock bajo',
    text: `${i.name} — quedan ${i.stock} ${i.unit || ''}`
  }));

  // Prospectos con accion pendiente para hoy o vencida
  const leads = db.prepare(`SELECT * FROM clients WHERE status IN ('prospecto') AND next_date IS NOT NULL AND next_date <= ?`).all(today);
  leads.forEach(l => alerts.push({
    kind: 'prospecto', level: 'mid', icon: '\u{1F3AF}',
    title: 'Dar seguimiento',
    text: `${l.name}${l.next_action ? ' — ' + l.next_action : ''}`
  }));

  const order = { high: 0, mid: 1, low: 2 };
  alerts.sort((a,b) => order[a.level] - order[b.level]);
  res.json(alerts);
}));

// ---------- Resumen / dashboard ----------
app.get('/api/summary', wrap((req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(total),0) monto FROM quotes GROUP BY status').all();
  const totals = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(total),0) monto FROM quotes').get();
  const clients = db.prepare('SELECT COUNT(*) n FROM clients').get();
  const projects = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(contract_value+viaticos_value),0) monto FROM projects').get();
  const activeProjects = db.prepare("SELECT COUNT(*) n FROM projects WHERE status IN ('planificacion','en_curso','pausado')").get();
  const personnel = db.prepare('SELECT COUNT(*) n FROM personnel WHERE active=1').get();
  res.json({ byStatus, totals, clients: clients.n, projects, activeProjects: activeProjects.n, personnel: personnel.n });
}));

// ============================================================
// FRONTEND
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`pinta-cotiza escuchando en http://localhost:${PORT}`));
