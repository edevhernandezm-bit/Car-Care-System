#!/usr/bin/env node
// Prueba de carga del diagnóstico (gateway → motor Prolog).
// Uso: LOAD_TEST_USER / LOAD_TEST_PASS por entorno. Cuerpo en BODY_FILE.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'scripts', 'resultados');

const API_URL = (process.env.API_URL || 'http://127.0.0.1:5000').replace(/\/$/, '');
const ENDPOINT = process.env.PROLOG_ENDPOINT || '/api/prolog/api/diagnostico';
const CONNECTIONS = Number(process.env.CONNECTIONS || 30);
const DURATION = Number(process.env.DURATION || 10);
const LABEL = process.env.LABEL || '1-replica';
const USER = process.env.LOAD_TEST_USER || '';
const PASS = process.env.LOAD_TEST_PASS || '';
const BODY_FILE = process.env.BODY_FILE || join(ROOT, 'scripts', 'caso-diagnostico.json');
const REMOTE_OK = process.argv.includes('--permitir-remoto');

const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

let hostname;
try { hostname = new URL(API_URL).hostname; } catch { die('API_URL inválida'); }
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) && !REMOTE_OK) {
  die(`se niega a correr contra ${hostname}. Use --permitir-remoto si es intencional.`);
}
if (!USER || !PASS) die('defina LOAD_TEST_USER y LOAD_TEST_PASS en el entorno.');

let bodyObj;
try { bodyObj = JSON.parse(readFileSync(BODY_FILE, 'utf8')); }
catch (e) { die(`no pude leer/parsear ${BODY_FILE}: ${e.message}`); }
const BODY = JSON.stringify(bodyObj);

async function login() {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) die(`login falló: HTTP ${res.status}`);
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  if (!cookies.length) die('el login no devolvió cookie de sesión');
  return cookies.map((c) => c.split(';')[0].trim()).join('; ');
}

const cookie = await login();

// Petición de prueba: debe ser 200 y status "success" antes de cargar.
const prueba = await fetch(`${API_URL}${ENDPOINT}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: BODY,
});
const textoPrueba = await prueba.text();
let jsonPrueba = null;
try { jsonPrueba = JSON.parse(textoPrueba); } catch { /* no es JSON */ }
if (prueba.status !== 200 || jsonPrueba?.status !== 'success') {
  die(`petición de prueba inválida: HTTP ${prueba.status}, respuesta: ${textoPrueba.slice(0, 300)}`);
}
console.log('Petición de prueba OK (200, status success). Iniciando carga...');

const r = await new Promise((resolve, reject) => {
  autocannon({
    url: API_URL,
    connections: CONNECTIONS,
    duration: DURATION,
    requests: [{
      method: 'POST',
      path: ENDPOINT,
      headers: { 'content-type': 'application/json', cookie },
      body: BODY,
    }],
  }, (err, res) => (err ? reject(err) : resolve(res)));
});

// statusCodeStats puede traer números o { count }.
const valor = (v) => (typeof v === 'number' ? v : (v && v.count) || 0);
const porCodigo = Object.fromEntries(
  Object.entries(r.statusCodeStats || {}).map(([k, v]) => [k, valor(v)])
);
if (!Object.keys(porCodigo).length) {
  console.warn('aviso: statusCodeStats vacío. Claves del resultado:', Object.keys(r).join(', '));
}
const clase = (d) => Object.entries(porCodigo)
  .filter(([k]) => k.startsWith(d)).reduce((a, [, v]) => a + v, 0);

const total = r.requests.total || 0;
const c2xx = clase('2');
const c4xx = clase('4');
const c5xx = clase('5');
const c401 = porCodigo['401'] || 0;
const c429 = porCodigo['429'] || 0;
const pct2xx = total ? Math.round((c2xx / total) * 10000) / 100 : 0;

const salida = {
  timestamp: new Date().toISOString(),
  label: LABEL,
  api_url: API_URL,
  endpoint: ENDPOINT,
  connections: CONNECTIONS,
  duration_s: DURATION,
  requests: { total, por_segundo: r.requests.average },
  latency_ms: { p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99 },
  errors: r.errors,
  timeouts: r.timeouts,
  respuestas: { '2xx': c2xx, '4xx': c4xx, '401': c401, '429': c429, '5xx': c5xx, por_codigo: porCodigo },
  porcentaje_2xx: pct2xx,
};

mkdirSync(OUT_DIR, { recursive: true });
const archivo = `loadtest-${LABEL}-${salida.timestamp.replace(/[:.]/g, '-')}.json`;
writeFileSync(join(OUT_DIR, archivo), JSON.stringify(salida, null, 2));
console.log(JSON.stringify(salida, null, 2));

const fallos = [];
if (r.errors > 0) fallos.push(`${r.errors} errores`);
if (r.timeouts > 0) fallos.push(`${r.timeouts} timeouts`);
if (c5xx > 0) fallos.push(`${c5xx} respuestas 5xx`);
if (c401 > 0) fallos.push(`${c401} respuestas 401`);
if (c429 > 0) fallos.push(`${c429} respuestas 429 (arranque la API con DESACTIVAR_LIMITES=1 en local)`);
if (pct2xx < 99) fallos.push(`solo ${pct2xx}% de respuestas 2xx (mínimo 99%)`);
if (fallos.length) { console.error('PRUEBA FALLIDA: ' + fallos.join('; ')); process.exit(1); }
console.log('PRUEBA OK');