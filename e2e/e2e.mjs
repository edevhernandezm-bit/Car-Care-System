import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, openSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const PL_FILE = path.join(ROOT, 'Prolog', 'motor_inferencia.pl');
const SWIPL = 'C:\\Program Files\\swipl\\bin\\swipl.exe';

const PUERTO_PROLOG = 8000;
const PUERTO_API = 5010;
const PUERTO_WEB = 5173;
const TEST_DB = 'mongodb://localhost:27017/car_care_e2e';
const API_URL = `http://localhost:${PUERTO_API}`;
const WEB_URL = `http://localhost:${PUERTO_WEB}`;
const PROLOG_URL = `http://localhost:${PUERTO_PROLOG}/api/diagnostico`;

const directorioLogs = mkdtempSync(path.join(tmpdir(), 'car-care-e2e-'));

function logPath(nombre) {
  return path.join(directorioLogs, nombre);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sondeo(url, { timeout = 90000, intervalo = 500, metodo = 'GET', cuerpo, headers } = {}) {
  const comienzo = Date.now();
  let ultimoError;
  while (Date.now() - comienzo < timeout) {
    try {
      const res = await fetch(url, { method: metodo, headers, body: cuerpo });
      if ([200, 201, 400].includes(res.status)) return res;
      ultimoError = new Error(`Status ${res.status}`);
    } catch (e) {
      ultimoError = e;
    }
    await sleep(intervalo);
  }
  throw new Error(`Timeout esperando ${url}: ${ultimoError && ultimoError.message}`);
}

function matarArbol(pid) {
  try {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
}

async function prologDiagnostico(payload) {
  const res = await fetch(PROLOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.ok(res.ok, `Prolog responde HTTP ${res.status}`);
  return res.json();
}

let prologProc;
let apiProc;
let webProc;
let mongoose;

before(async () => {
  assert.ok(existsSync(SWIPL), `SWI-Prolog no está en ${SWIPL}`);
  assert.ok(existsSync(PL_FILE), `motor_inferencia.pl no está en ${PL_FILE}`);

  function canalLogs(nombre, sufijo) {
    return createWriteStream(null, { fd: openSync(logPath(`${nombre}.${sufijo}.log`), 'w') });
  }

  prologProc = spawn(SWIPL, ['-q', '-f', PL_FILE, '-g', `server(${PUERTO_PROLOG}), sleep(3600)`, '-t', 'halt'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  prologProc.stdout.pipe(canalLogs('prolog', 'out'));
  prologProc.stderr.pipe(canalLogs('prolog', 'err'));

  apiProc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(PUERTO_API), MONGO_URI: TEST_DB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProc.stdout.pipe(canalLogs('api', 'out'));
  apiProc.stderr.pipe(canalLogs('api', 'err'));

  webProc = spawn(
    process.execPath,
    [path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js')],
    {
      cwd: FRONTEND_DIR,
      env: { ...process.env, PORT: String(PUERTO_API), BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  webProc.stdout.pipe(canalLogs('web', 'out'));
  webProc.stderr.pipe(canalLogs('web', 'err'));

  await sondeo(`${API_URL}/api/items`, { timeout: 90000 });
  await sondeo(PROLOG_URL, {
    timeout: 90000,
    metodo: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cuerpo: JSON.stringify({ marca: 'gen', modelo: 'gen', anio: 0, sintomas: [] }),
  });
  await sondeo(`http://localhost:${PUERTO_PROLOG}/api/sintomas`, { timeout: 90000 });
  await sondeo(`http://localhost:${PUERTO_PROLOG}/api/fallas`, { timeout: 90000 });
  await sondeo(`http://localhost:${PUERTO_PROLOG}/api/diagnostico`, {
    timeout: 90000,
    metodo: 'OPTIONS',
    headers: {
      Origin: WEB_URL,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  await sondeo(`${WEB_URL}/`, { timeout: 90000 });

  const require = createRequire(import.meta.url);
  mongoose = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  await mongoose.connect(TEST_DB);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

after(async () => {
  for (const p of [webProc, apiProc, prologProc]) {
    if (p && p.pid) matarArbol(p.pid);
  }
  if (mongoose) {
    try {
      await mongoose.disconnect();
    } catch {}
  }
  rmSync(directorioLogs, { recursive: true, force: true });
});

test('01 | MongoDB: la BD de prueba responde y acepta escrituras', async () => {
  const require = createRequire(import.meta.url);
  const m = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  await m.connect(TEST_DB);
  const probe = new m.Schema({ etiqueta: String, valor: Number });
  const Modelo = m.model('ProbeE2E', probe);
  await Modelo.deleteMany({});
  const creado = await Modelo.create({ etiqueta: 'ping', valor: 1 });
  assert.ok(creado._id, 'El documento guardado debe tener _id');
  const encontrado = await Modelo.findOne({ etiqueta: 'ping' });
  assert.equal(encontrado.valor, 1);
  await Modelo.deleteMany({});
  await m.disconnect();
});

test('02 | API items: GET/POST persisten en Mongo', async () => {
  const listaInicial = await (await fetch(`${API_URL}/api/items`)).json();
  assert.ok(Array.isArray(listaInicial));

  const res = await fetch(`${API_URL}/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'item-probe-e2e' }),
  });
  assert.equal(res.status, 201);
  const creado = await res.json();
  assert.ok(creado._id);
  assert.equal(creado.nombre, 'item-probe-e2e');
  assert.ok(creado.creado_en);

  const listaFinal = await (await fetch(`${API_URL}/api/items`)).json();
  assert.ok(listaFinal.some((i) => i.nombre === 'item-probe-e2e'), 'El item debe aparecer en la lista');
});

test('03 | API items: validación (400 sin nombre)', async () => {
  const res = await fetch(`${API_URL}/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('04 | API diagnósticos: se guarda y se lista el historial', async () => {
  const payload = {
    vehiculo: { marca: 'honda', modelo: 'civic', anio: 2015 },
    sintomas: ['chirrido_al_frenar', 'pedal_freno_esponjoso'],
    fallas: [{ falla: 'sistema_frenos_con_aire', certeza: 0.87 }],
  };
  const res = await fetch(`${API_URL}/api/diagnosticos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 201);
  const creado = await res.json();
  assert.equal(creado.vehiculo.marca, 'honda');
  assert.equal(creado.fallas[0].falla, 'sistema_frenos_con_aire');
  assert.equal(creado.fallas[0].certeza, 0.87);

  const historial = await (await fetch(`${API_URL}/api/diagnosticos`)).json();
  assert.ok(historial.some((d) => d.vehiculo.marca === 'honda' && d.fallas?.some((f) => f.falla === 'sistema_frenos_con_aire')));
});

test('05 | API stats/certeza: refleja las fallas guardadas', async () => {
  await fetch(`${API_URL}/api/diagnosticos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo: { marca: 'gen', modelo: 'gen', anio: 0 },
      sintomas: ['chirrido_al_frenar'],
      fallas: [
        { falla: 'pastillas_freno', certeza: 0.72 },
        { falla: 'frenos_sobrecalentados', certeza: 0.5 },
      ],
    }),
  });

  const stats = await (await fetch(`${API_URL}/api/stats/certeza`)).json();
  const pastillas = stats.por_falla.find((f) => f.falla === 'pastillas_freno');
  const frenos = stats.por_falla.find((f) => f.falla === 'frenos_sobrecalentados');
  assert.ok(pastillas, 'por_falla debe incluir pastillas_freno');
  assert.ok(frenos, 'por_falla debe incluir frenos_sobrecalentados');
  assert.ok(pastillas.veces >= 1);
  assert.equal(pastillas.certeza_promedio, 0.72);
  assert.ok(stats.total_fallas_inferidas >= 1);
});

test('06 | Motor Prolog: casos oráculo vía HTTP', async () => {
  const casos = [
    {
      payload: { marca: 'gen', modelo: 'gen', anio: 0, sintomas: ['chirrido_al_frenar', 'pedal_freno_esponjoso'] },
      esperado: [['sistema_frenos_con_aire', 0.87]],
    },
    {
      payload: { marca: 'gen', modelo: 'gen', anio: 0, sintomas: ['chirrido_al_frenar'] },
      esperado: [['pastillas_freno', 0.72]],
    },
    {
      payload: { marca: 'honda', modelo: 'civic', anio: 2015, sintomas: ['marchas_resbalan', 'pedal_embrague_suelto'] },
      esperado: [['embrague_desgastado', 0.88]],
    },
    {
      payload: { marca: 'toyota', modelo: 'corolla', anio: 2022, sintomas: ['marchas_resbalan', 'pedal_embrague_suelto'] },
      esperado: [],
    },
  ];

  for (const c of casos) {
    const resp = await prologDiagnostico(c.payload);
    assert.equal(resp.status, 'success');
    assert.deepEqual(resp.vehiculo, { marca: c.payload.marca, modelo: c.payload.modelo, anio: c.payload.anio });
    const pares = resp.fallas.map((f) => [f.id, f.certeza]);
    assert.deepEqual(pares, c.esperado, `Prolog: caso ${JSON.stringify(c.payload)}`);
  }
});

test('07 | Prolog: GET /api/sintomas expone el catálogo (única fuente de verdad)', async () => {
  const res = await fetch(`http://localhost:${PUERTO_PROLOG}/api/sintomas`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'success');
  assert.ok(Array.isArray(data.sintomas));
  assert.equal(data.sintomas.length, 27, 'deben servir los 27 síntomas del motor');

  const freno = data.sintomas.find((s) => s.id === 'chirrido_al_frenar');
  assert.ok(freno, 'chirrido_al_frenar debe estar en el catálogo');
  assert.equal(freno.nombre, 'Chirrido al frenar');
  assert.equal(freno.categoria, 'Frenos');

  const incompletos = data.sintomas.filter((s) => !s.nombre || !s.categoria);
  assert.equal(incompletos.length, 0, 'todos los síntomas deben tener nombre y categoría');
});

test('08 | Prolog: GET /api/fallas expone el catálogo (única fuente de verdad)', async () => {
  const res = await fetch(`http://localhost:${PUERTO_PROLOG}/api/fallas`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'success');
  assert.ok(Array.isArray(data.fallas));
  assert.equal(data.fallas.length, 20, 'deben servir las 20 fallas del motor');

  const freno = data.fallas.find((f) => f.id === 'sistema_frenos_con_aire');
  assert.ok(freno, 'sistema_frenos_con_aire debe estar en el catálogo');
  assert.equal(freno.nombre, 'Sistema de frenos con aire');
  assert.equal(freno.urgencia, 'alta');
  assert.equal(freno.costo_min, 300);
  assert.equal(freno.costo_max, 1200);
  assert.ok(freno.reparaciones.length >= 3, 'debe listar pasos de reparación con nombre');

  const incompletas = data.fallas.filter(
    (f) => !f.nombre || !f.urgencia || typeof f.costo_min !== 'number' || !Array.isArray(f.reparaciones)
  );
  assert.equal(incompletas.length, 0, 'todas las fallas deben traer sus metadatos');
});

test('09 | Prolog: preflight CORS (OPTIONS) habilita fetch del navegador', async () => {
  const res = await fetch(`http://localhost:${PUERTO_PROLOG}/api/diagnostico`, {
    method: 'OPTIONS',
    headers: {
      Origin: WEB_URL,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(res.status, 200, 'OPTIONS /api/diagnostico debe responder 200');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(res.headers.get('access-control-allow-headers') || '', /Content-Type/i);

  const get = await fetch(`http://localhost:${PUERTO_PROLOG}/api/sintomas`, {
    method: 'OPTIONS',
    headers: { Origin: WEB_URL, 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(get.status, 200, 'OPTIONS /api/sintomas debe responder 200');
  assert.equal(get.headers.get('access-control-allow-origin'), '*');
  assert.match(get.headers.get('access-control-allow-methods') || '', /GET/);
});

test('10 | React/Vite: index y sistema experto (asíncrono vía Prolog)', async () => {
  const index = await (await fetch(`${WEB_URL}/`)).text();
  assert.match(index, /<div id="root"><\/div>/);
  assert.match(index, /\/src\/main\.jsx/);

  const mainJsx = await (await fetch(`${WEB_URL}/src/main.jsx`)).text();
  assert.match(mainJsx, /styles\.css/);
  assert.match(mainJsx, /App\.jsx/);

  // Los endpoints del motor viven en lib/api.js y la vista en App.jsx: se revisa
  // la fuente del frontend completo para que la prueba siga siendo válida aunque
  // el código cambie de archivo.
  const appJsx = await (await fetch(`${WEB_URL}/src/App.jsx`)).text();
  const apiJs = await (await fetch(`${WEB_URL}/src/lib/api.js`)).text();
  const fuenteFrontend = `${appJsx}\n${apiJs}`;

  assert.match(fuenteFrontend, /Análisis de Fallas/);
  assert.match(fuenteFrontend, /api\/sintomas/);
  assert.match(fuenteFrontend, /api\/fallas/);
  assert.match(fuenteFrontend, /api\/diagnostico/);
  assert.doesNotMatch(fuenteFrontend, /baseConocimiento|inferir_fallas/);
});

test('11 | Flujo integrado: React(proxy) → backend → Mongo → stats', async () => {
  const vehiculo = { marca: 'honda', modelo: 'civic', anio: 2015 };
  const sintomas = ['chirrido_al_frenar', 'pedal_freno_esponjoso'];

  const motor = await prologDiagnostico({ marca: vehiculo.marca, modelo: vehiculo.modelo, anio: vehiculo.anio, sintomas });
  assert.ok(motor.fallas.length >= 1, 'El motor real debe detectar fallas');
  const infere = motor.fallas[0];

  const resProxy = await fetch(`${WEB_URL}/api/diagnosticos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo,
      sintomas,
      fallas: motor.fallas.map((f) => ({ falla: f.id, certeza: f.certeza })),
    }),
  });
  assert.equal(resProxy.status, 201, 'El proxy de Vite debe reenviar a la API');

  const stats = await (await fetch(`${WEB_URL}/api/stats/certeza`)).json();
  assert.ok(stats.por_falla.some((f) => f.falla === infere.id), `stats deben incluir ${infere.id}`);

  const historial = await (await fetch(`${WEB_URL}/api/diagnosticos`)).json();
  assert.ok(historial.some((d) => d.vehiculo.marca === 'honda' && d.fallas?.some((f) => f.falla === infere.id)));
});