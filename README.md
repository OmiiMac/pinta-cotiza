# MESHIPPING // TERMINAL — pinta-cotiza

Sistema de cotizaciones para **pintura, gypsum y remodelaciones**.
Node 24 + `node:sqlite` (SQLite integrado, sin dependencias nativas) + Express.

## Qué incluye

- **Cotizaciones** con numeración automática (`COT-2026-0001`), estados (borrador / enviada / aprobada / rechazada), descuento e impuesto (ITBMS).
- **Partidas con calculadora de área (m²)**: ancho × alto × nº de paredes, menos descuentos (puertas/ventanas).
- **Estimación de materiales**: galones de pintura según m², rendimiento (m²/galón) y nº de manos.
- **Clientes** (CRUD).
- **Catálogo de precios** reutilizable para armar cotizaciones rápido.
- **Vista imprimible / PDF** con la marca.
- **Ajustes** de empresa, moneda, impuesto, términos y logo.

## Correr en local

```bash
npm install
npm start
# http://localhost:3000
```

Requiere **Node 24+** (usa `node:sqlite`). La base de datos se crea sola en `./data/pinta.db`.

## Deploy en Railway

1. Sube el repo a GitHub y conéctalo en Railway.
2. Railway detecta `railway.toml` (nixpacks, `npm start`).
3. **Importante:** monta un **volumen** y define `DB_PATH` (ej. `/data/pinta.db`) para que las cotizaciones no se borren en cada deploy.

## Logo

El header usa un wordmark neón por defecto. Para usar el logo real:
1. Coloca el PNG en `public/` (ej. `public/logo.png`).
2. En **Ajustes → Logo** escribe `/logo.png`.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto (Railway lo asigna solo) |
| `DB_PATH` | Ruta del archivo SQLite |
