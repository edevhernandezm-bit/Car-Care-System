import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  openSync,
  createWriteStream,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const PL_FILE = path.join(ROOT, 'Prolog', 'motor_inferencia.pl');
const SWIPL = process.env.SWIPL || 'C:\\Program Files\\swipl\\bin\\swipl.exe';

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

  // Ruta viva para esperar a la API. No se usa /api/items porque ya no existe:
  // el endpoint de tipo de cambio además ejercita la cache nueva.
  await sondeo(`${API_URL}/api/config/tipo-cambio`, { timeout: 90000 });
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

test('00 | API stats/certeza: una base vacia no inventa un promedio de 0', async () => {
  // Va primero a proposito: el `before` hace dropDatabase(), asi que esta es la
  // unica ventana en la que la coleccion esta garantizadamente vacia. Con
  // `|| 0` el endpoint devolvia certeza_promedio_global: 0 aqui, y la vista lo
  // pintaba como "certeza media 0%, nivel Bajo" al lado de un contador de
  // consultas real: una medicion que el sistema nunca hizo. Lo que no se midio
  // es null, y el cliente lo muestra como "No disponible".
  const stats = await (await fetch(`${API_URL}/api/stats/certeza`)).json();

  assert.equal(stats.total_consultas, 0, 'la base arranca vacia');
  assert.equal(stats.total_fallas_inferidas, 0);
  assert.deepEqual(stats.por_falla, []);
  assert.equal(stats.certeza_promedio_global, null, 'sin fallas no hay promedio, no un 0');
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

test('02 | API diagnósticos: persiste y el historial lo devuelve con su tasa congelada', async () => {
  const payload = {
    vehiculo: { marca: 'toyota', modelo: 'hilux', anio: 2019 },
    sintomas: ['ruido_motor'],
    fallas: [{ falla: 'aceite_motor_bajo', certeza: 0.61, nombre: 'Aceite de motor bajo', urgencia: 'media' }],
  };
  const res = await fetch(`${API_URL}/api/diagnosticos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 201);
  const creado = await res.json();
  assert.ok(creado._id);
  assert.ok(creado.creado_en);

  // La tasa se congela por diagnóstico: el documento guardado debe traer la que
  // se usó al emitirlo, nunca la vigente en el momento de leer el historial.
  assert.equal(typeof creado.tipo_cambio.usd_mxn, 'number');
  assert.ok(creado.tipo_cambio.usd_mxn > 0, 'la tasa congelada debe ser positiva');
  assert.ok(creado.tipo_cambio.fuente, 'la tasa congelada debe traer su fuente');

  const historial = await (await fetch(`${API_URL}/api/diagnosticos`)).json();
  const guardado = historial.find((d) => d._id === creado._id);
  assert.ok(guardado, 'el diagnóstico guardado debe aparecer en el historial');
  assert.equal(guardado.tipo_cambio.usd_mxn, creado.tipo_cambio.usd_mxn, 'la tasa del historial debe ser la congelada');
});

test('03 | API diagnósticos: validación (400 ante datos inválidos, sin filtrar el error)', async () => {
  // `certeza: 99` viola el schema de Mongoose (Path "fallas.0.certeza" fuera de rango),
  // lo que debe terminar en un 400 del middleware central, no en un 500.
  const res = await fetch(`${API_URL}/api/diagnosticos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo: { marca: 'gen', modelo: 'gen', anio: 0 },
      sintomas: ['ruido_motor'],
      fallas: [{ falla: 'aceite_motor_bajo', certeza: 99 }],
    }),
  });
  assert.equal(res.status, 400, 'una certeza fuera de rango debe rechazarse con 400');

  const cuerpo = await res.json();
  assert.ok(cuerpo.error, 'la respuesta de error debe traer un mensaje');
  assert.doesNotMatch(
    JSON.stringify(cuerpo),
    /Path "fallas|ValidationError|at Object\.|node_modules/,
    'un 4xx no debe filtrar detalles internos del stack ni del schema'
  );
});

test('03b | API diagnósticos: la certeza acepta 0 (lo emite el motor al redondear) y rechaza lo que se sale', async () => {
  // El motor redondea la certeza a dos decimales (motor_inferencia.pl:932), asi
  // que una regla por debajo de 0.005 sale como 0.0 en el JSON. Con el intervalo
  // en (0, 1] ese diagnostico legitimo llegaba al backend y se rechazaba con
  // 400, perdiendose entero. El 0 se acepta; lo que sigue fuera de rango, no.
  const post = (certeza) =>
    fetch(`${API_URL}/api/diagnosticos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehiculo: { marca: 'gen', modelo: 'gen', anio: 0 },
        sintomas: ['ruido_motor'],
        fallas: [{ falla: 'aceite_motor_bajo', certeza }],
      }),
    });

  // Los tres valores del intervalo cerrado [0, 1] se guardan. Los extremos
  // cuentan: 0 es lo que emite el motor al redondear, y 1 es una certeza
  // legitima que el limite superior todavia tiene que dejar pasar.
  for (const certeza of [0, 0.005, 1]) {
    const res = await post(certeza);
    assert.equal(res.status, 201, `certeza ${certeza} esta en [0, 1] y debe guardarse`);
    const doc = await res.json();
    assert.equal(doc.fallas[0].certeza, certeza, 'la certeza debe persistirse tal cual, sin convertirse en null');
  }

  // Lo que se sale del intervalo, no. El 99 es el caso que motiva el limite
  // superior: sin el, envenenaria los promedios de /api/stats/certeza.
  for (const certeza of [-0.1, 1.1, 99]) {
    const res = await post(certeza);
    assert.equal(res.status, 400, `certeza ${certeza} debe rechazarse con 400`);

    const cuerpo = await res.json();
    assert.ok(cuerpo.error, `certeza ${certeza} debe devolver un mensaje de error`);
    assert.doesNotMatch(
      JSON.stringify(cuerpo),
      /Path "fallas|ValidationError|at Object\.|node_modules/,
      'el rechazo tampoco debe filtrar detalles internos'
    );
  }

  // Una certeza ausente no se rellena: se rechaza, para que quede en el log en
  // vez de guardarse como 0 y pasar por una medicion real.
  const sinCerteza = await fetch(`${API_URL}/api/diagnosticos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo: { marca: 'gen', modelo: 'gen', anio: 0 },
      sintomas: ['ruido_motor'],
      fallas: [{ falla: 'aceite_motor_bajo' }],
    }),
  });
  assert.equal(sinCerteza.status, 400, 'una certeza ausente debe rechazarse, no rellenarse con 0');
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

  // Con fallas guardadas el promedio global si es un numero real en su rango.
  // El contrato tiene las dos caras: null cuando no hay nada que promediar (test
  // 00), numero en [0, 1] cuando si. Lo que no puede salir es un 0 de relleno
  // haciendose pasar por una certeza medida.
  assert.equal(
    typeof stats.certeza_promedio_global,
    'number',
    'con fallas guardadas el promedio global debe ser un numero'
  );
  assert.ok(
    stats.certeza_promedio_global >= 0 && stats.certeza_promedio_global <= 1,
    `el promedio global debe estar en [0, 1], vino ${stats.certeza_promedio_global}`
  );

  // total_consultas cuenta diagnósticos, no entradas de falla. Lo que lo
  // distingue es una consulta que no infirió nada, y no es un caso sintético:
  // el cliente guarda el diagnóstico aunque el motor no devuelva fallas
  // (guardarDiagnostico con fallas: []).
  const antes = stats;
  await fetch(`${API_URL}/api/diagnosticos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo: { marca: 'gen', modelo: 'gen', anio: 0 },
      sintomas: ['ruido_motor'],
      fallas: [],
    }),
  });

  const despues = await (await fetch(`${API_URL}/api/stats/certeza`)).json();
  assert.equal(
    despues.total_consultas,
    antes.total_consultas + 1,
    'una consulta que no infirió ninguna falla también es una consulta'
  );
  assert.equal(
    despues.total_fallas_inferidas,
    antes.total_fallas_inferidas,
    'una consulta sin fallas no debe sumar fallas inferidas'
  );

  // El promedio global se redondea a dos decimales igual que el promedio por
  // falla. Se comprueba sobre el texto porque multiplicar por 100 y comparar
  // contra un entero sale falso por la representacion binaria del punto flotante
  // (0.61 * 100 da 60.99999999999999).
  const rendered = String(despues.certeza_promedio_global);
  const decimales = rendered.includes('.') ? rendered.split('.')[1].length : 0;
  assert.ok(
    decimales <= 2,
    `certeza_promedio_global debe venir a dos decimales, vino ${rendered}`
  );
});

test('06 | Motor Prolog: casos oráculo vía HTTP', async () => {
  const casos = [
    {
      payload: { marca: 'gen', modelo: 'gen', anio: 0, transmision: 'desconocida', sintomas: ['chirrido_al_frenar', 'pedal_freno_esponjoso'] },
      esperado: [['sistema_frenos_con_aire', 0.87]],
    },
    {
      payload: { marca: 'gen', modelo: 'gen', anio: 0, transmision: 'desconocida', sintomas: ['chirrido_al_frenar'] },
      esperado: [['pastillas_freno', 0.72]],
    },
    {
      payload: { marca: 'honda', modelo: 'civic', anio: 2015, transmision: 'desconocida', sintomas: ['marchas_resbalan', 'pedal_embrague_suelto'] },
      esperado: [['embrague_desgastado', 0.88]],
    },
    {
      payload: { marca: 'toyota', modelo: 'corolla', anio: 2022, transmision: 'desconocida', sintomas: ['marchas_resbalan', 'pedal_embrague_suelto'] },
      esperado: [],
    },
  ];

  for (const c of casos) {
    const resp = await prologDiagnostico(c.payload);
    assert.equal(resp.status, 'success');
    assert.deepEqual(resp.vehiculo, { marca: c.payload.marca, modelo: c.payload.modelo, anio: c.payload.anio, transmision: c.payload.transmision });
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
  assert.equal(data.sintomas.length, 38, 'deben servir los 38 síntomas del motor');

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
  assert.equal(data.fallas.length, 54, 'deben servir las 54 fallas del motor');

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

test('09 | API: allowlist de CORS restringe los orígenes', async () => {
  // El navegador ya no habla con Prolog: todo pasa por el gateway same-origin de
  // Express, así que el allowlist vive en la API, no en el motor. La app se sirve
  // en 5173, que es el origen por defecto permitido.
  const permitido = await fetch(`${API_URL}/api/config/tipo-cambio`, {
    headers: { Origin: WEB_URL },
  });
  assert.equal(permitido.status, 200);
  assert.equal(
    permitido.headers.get('access-control-allow-origin'),
    WEB_URL,
    'el origen de la app debe reflejarse en Access-Control-Allow-Origin'
  );

  const ajeno = await fetch(`${API_URL}/api/config/tipo-cambio`, {
    headers: { Origin: 'http://sitio-ajeno.example' },
  });
  assert.equal(
    ajeno.headers.get('access-control-allow-origin'),
    null,
    'un origen fuera de la allowlist no debe recibir permiso de CORS'
  );
});

test('09b | Gateway Prolog: el motor sigue respondiendo su propio preflight', async () => {
  // Aunque el navegador ya no lo consume directo, el motor conserva su handler
  // OPTIONS: se verifica para que el gateway no dependa de un Prolog degradado.
  const res = await fetch(`http://localhost:${PUERTO_PROLOG}/api/diagnostico`, {
    method: 'OPTIONS',
    headers: {
      Origin: WEB_URL,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(res.status, 200, 'OPTIONS /api/diagnostico debe responder 200');
  assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  assert.match(res.headers.get('access-control-allow-headers') || '', /Content-Type/i);
});

test('09c | Gateway Prolog: el navegador llega al motor por el proxy de Vite → Express', async () => {
  // Este es el camino que usa la app real: nada de localhost:8000 en el cliente.
  const sintomas = await (await fetch(`${WEB_URL}/api/prolog/api/sintomas`)).json();
  assert.equal(sintomas.status, 'success');
  assert.ok(Array.isArray(sintomas.sintomas));
  assert.equal(sintomas.sintomas.length, 38, 'el gateway debe servir el catálogo completo');

  const diag = await (
    await fetch(`${WEB_URL}/api/prolog/api/diagnostico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marca: 'gen', modelo: 'gen', anio: 0, transmision: 'desconocida', sintomas: ['chirrido_al_frenar'] }),
    })
  ).json();
  assert.equal(diag.status, 'success');
  assert.ok(Array.isArray(diag.fallas));
  assert.ok(diag.fallas.length >= 1, 'el gateway debe reenviar el cuerpo al motor y devolver su respuesta');
});

test('09d | Gateway Prolog: 502 cuando el motor no responde, sin filtrar el error interno', async () => {
  // PROLOG_BASE se lee al arrancar el proceso, asi que para probar la rama de
  // error hay que levantar una segunda instancia apuntando a un puerto muerto.
  const puertoMuerto = PUERTO_API + 7;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoMuerto),
      MONGO_URI: TEST_DB,
      PROLOG_BASE: 'http://127.0.0.1:9',
      PROLOG_TIMEOUT_MS: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-sin-motor.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-sin-motor.err'), 'w') }));

  try {
    await sondeo(`http://localhost:${puertoMuerto}/api/config/tipo-cambio`, { timeout: 30000 });

    const res = await fetch(`http://localhost:${puertoMuerto}/api/prolog/api/sintomas`);
    assert.equal(res.status, 502, 'sin motor detras, el gateway debe responder 502');

    const cuerpo = await res.json();
    assert.equal(cuerpo.error, 'Error interno del servidor', 'el 502 no debe filtrar el error real de fetch');
    assert.doesNotMatch(
      JSON.stringify(cuerpo),
      /ECONNREFUSED|127\.0\.0\.1:9|fetch failed|at /,
      'no debe filtrarse el destino ni el detalle del error de red'
    );
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
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
  // MotorBanner entra en el mismo escaneo por una razón concreta: la última vez que
  // el cliente dejó de hablar directo con el motor, este archivo se quedó con el
  // puerto de Prolog hardcodeado y con un comando `swipl` que el repo ya no usa.
  // Al no estar en la lista, el aviso de "motor no disponible" siguió mostrando
  // instrucciones de la arquitectura que se había reemplazado. Revisar solo App.jsx
  // y api.js dejaba el hueco donde se escondió.
  const bannerJsx = await (
    await fetch(`${WEB_URL}/src/components/MotorBanner.jsx`)
  ).text();
  const fuenteFrontend = `${appJsx}\n${apiJs}\n${bannerJsx}`;

  assert.match(fuenteFrontend, /Análisis de Fallas/);
  assert.match(fuenteFrontend, /api\/sintomas/);
  assert.match(fuenteFrontend, /api\/fallas/);
  assert.match(fuenteFrontend, /api\/diagnostico/);
  assert.doesNotMatch(fuenteFrontend, /baseConocimiento|inferir_fallas/);

  // Ningún archivo del cliente puede apuntar al motor por su puerto: el único camino
  // es el gateway same-origin de Express.
  assert.doesNotMatch(
    fuenteFrontend,
    /localhost:8000/,
    'el cliente no debe conocer el puerto del motor; todo pasa por el gateway'
  );
});

test('12 | La certeza del frontend usa los mismos cortes que el motor', async () => {
  // El motor calcula certeza con MYCIN y define sus cortes en etiqueta_certeza/2,
  // pero no los exporta al JSON: la vista los replica para poder etiquetar el
  // resultado. Esta prueba ata las dos copias, porque si alguien mueve un corte
  // en el motor, la etiqueta de la web dejaria de describir el dato real.
  const fuenteProlog = readFileSync(PL_FILE, 'utf8');
  const corteAlta = fuenteProlog.match(/etiqueta_certeza\(\s*C,\s*'ALTA'\s*\)\s*:-\s*C\s*>=\s*([\d.]+)/);
  const corteMedia = fuenteProlog.match(/etiqueta_certeza\(\s*C,\s*'MEDIA'\s*\)\s*:-\s*C\s*>=\s*([\d.]+)/);
  assert.ok(corteAlta, 'Prolog debe declarar un corte de certeza ALTA');
  assert.ok(corteMedia, 'Prolog debe declarar un corte de certeza MEDIA');

  // Se lee del disco y no por HTTP: Vite sirve el modulo ya transformado y su
  // minificador escribe "0.85" como ".85", lo que haria fallar la comparacion
  // sin que el valor sea distinto.
  const fuenteDiagnostico = readFileSync(
    path.join(FRONTEND_DIR, 'src', 'lib', 'diagnostico.js'),
    'utf8'
  );
  // Se comparan como numero, no como texto: Prolog escribe 0.60 y el frontend
  // 0.6, que son el mismo valor con otra notacion.
  const valorEnFrontend = (nombre) => {
    const m = fuenteDiagnostico.match(new RegExp(`${nombre}\\s*=\\s*([\\d.]+)`));
    assert.ok(m, `El frontend debe declarar ${nombre}`);
    return Number(m[1]);
  };
  const espera = (nombre, corte) => {
    assert.equal(
      valorEnFrontend(nombre),
      Number(corte),
      `El frontend debe usar el mismo corte que Prolog (${corte})`
    );
  };
  espera('CORTE_CERTEZA_ALTA', corteAlta[1]);
  espera('CORTE_CERTEZA_MEDIA', corteMedia[1]);
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