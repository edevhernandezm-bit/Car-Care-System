import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request as peticionHttp, createServer as crearServidorHttp } from 'node:http';
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
// El motor exige esta cabecera en todas sus rutas menos el preflight. El valor
// es distinto del de cualquier despliegue a proposito: si el backend no leyera
// MOTOR_TOKEN no mandaria la cabecera y las pruebas fallarian con 401 en vez
// de pasar.
const MOTOR_TOKEN_E2E = 'e2e0e2e0e2e0e2e0';
const CH_MOTOR = { 'X-Motor-Token': MOTOR_TOKEN_E2E };

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
    headers: { 'Content-Type': 'application/json', ...CH_MOTOR },
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

  // La base se vacia ANTES de levantar los servicios, no despues. La API hace
  // bootstrap de las fallas de Mongo hacia Prolog al arrancar: si la base todavia
  // guardara datos del run anterior, esas fallas se afirmarian en el motor recien
  // estrenado y contaminarian desde el primer test los catalogos y los
  // diagnosticos (los conteos de 38/54 salian en 39/55 con una falla fantasma).
  // Vaciar antes tambien es lo unico que deja el estado inicial igual al de una
  // base nueva, porque despues el harness ya no puede tocar la base sin
  // reiniciar el motor.
  const require = createRequire(import.meta.url);
const mongoose = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  await mongoose.connect(TEST_DB);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  prologProc = spawn(SWIPL, ['-q', '-f', PL_FILE, '-g', `server(${PUERTO_PROLOG}), sleep(3600)`, '-t', 'halt'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOTOR_TOKEN: MOTOR_TOKEN_E2E },
  });
  prologProc.stdout.pipe(canalLogs('prolog', 'out'));
  prologProc.stderr.pipe(canalLogs('prolog', 'err'));

  apiProc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(PUERTO_API),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      TICKETS_ENABLED: '1',
      MAIL_PROVIDER: 'fake',
      PUBLIC_APP_URL: WEB_URL,
    },
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
    headers: { 'Content-Type': 'application/json', ...CH_MOTOR },
    cuerpo: JSON.stringify({ marca: 'gen', modelo: 'gen', anio: 0, sintomas: [] }),
  });
  await sondeo(`http://localhost:${PUERTO_PROLOG}/api/sintomas`, { timeout: 90000, headers: CH_MOTOR });
  await sondeo(`http://localhost:${PUERTO_PROLOG}/api/fallas`, { timeout: 90000, headers: CH_MOTOR });
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

// ---------------------------------------------------------------------------
// Sesion para los endpoints de datos
// Desde 1.7 /api/diagnosticos y /api/stats/certeza exigen sesion. En vez de
// repetir el login en cada prueba, se crea una cuenta propia y se inicia sesion
// una sola vez; la cookie se inyecta en las peticiones que la necesitan.
// ---------------------------------------------------------------------------
const CUENTA_API = { username: 'api_e2e', password: 'clave-api-e2e' };
let cookieApiE2E = null;

async function cookieDeApiE2E() {
  if (!cookieApiE2E) {
    await usuarioEnMongo({ ...CUENTA_API, role: 'estudiante_mecanica', nombre: 'API E2E' });
    const ingreso = await api('/api/auth/login', { method: 'POST', body: CUENTA_API });
    assert.equal(ingreso.status, 200, 'la cuenta de datos debe poder iniciar sesión');
    cookieApiE2E = ingreso.cookie;
  }
  return cookieApiE2E;
}

async function fetchApi(ruta, opciones = {}) {
  return fetch(`${API_URL}${ruta}`, {
    ...opciones,
    headers: { ...(opciones.headers || {}), Cookie: await cookieDeApiE2E() },
  });
}

async function fetchWebApi(ruta, opciones = {}) {
  return fetch(`${WEB_URL}${ruta}`, {
    ...opciones,
    headers: { ...(opciones.headers || {}), Cookie: await cookieDeApiE2E() },
  });
}

test('00 | API stats/certeza: una base vacia no inventa un promedio de 0', async () => {
  // Va primero a proposito: el `before` hace dropDatabase(), asi que esta es la
  // unica ventana en la que la coleccion esta garantizadamente vacia. Con
  // `|| 0` el endpoint devolvia certeza_promedio_global: 0 aqui, y la vista lo
  // pintaba como "certeza media 0%, nivel Bajo" al lado de un contador de
  // consultas real: una medicion que el sistema nunca hizo. Lo que no se midio
  // es null, y el cliente lo muestra como "Sin dato".
  const stats = await (await fetchApi('/api/stats/certeza')).json();

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
  const res = await fetchApi('/api/diagnosticos', {
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

  const historial = await (await fetchApi('/api/diagnosticos')).json();
  const guardado = historial.find((d) => d._id === creado._id);
  assert.ok(guardado, 'el diagnóstico guardado debe aparecer en el historial');
  assert.equal(guardado.tipo_cambio.usd_mxn, creado.tipo_cambio.usd_mxn, 'la tasa del historial debe ser la congelada');
});

test('03 | API diagnósticos: validación (400 ante datos inválidos, sin filtrar el error)', async () => {
  // `certeza: 99` viola el schema de Mongoose (Path "fallas.0.certeza" fuera de rango),
  // lo que debe terminar en un 400 del middleware central, no en un 500.
  const res = await fetchApi('/api/diagnosticos', {
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
    fetchApi('/api/diagnosticos', {
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
  const sinCerteza = await fetchApi('/api/diagnosticos', {
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
  const res = await fetchApi('/api/diagnosticos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 201);
  const creado = await res.json();
  assert.equal(creado.vehiculo.marca, 'honda');
  assert.equal(creado.fallas[0].falla, 'sistema_frenos_con_aire');
  assert.equal(creado.fallas[0].certeza, 0.87);

  const historial = await (await fetchApi('/api/diagnosticos')).json();
  assert.ok(historial.some((d) => d.vehiculo.marca === 'honda' && d.fallas?.some((f) => f.falla === 'sistema_frenos_con_aire')));
});

test('05 | API stats/certeza: refleja las fallas guardadas', async () => {
  await fetchApi('/api/diagnosticos', {
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

  const stats = await (await fetchApi('/api/stats/certeza')).json();
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
  await fetchApi('/api/diagnosticos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo: { marca: 'gen', modelo: 'gen', anio: 0 },
      sintomas: ['ruido_motor'],
      fallas: [],
    }),
  });

  const despues = await (await fetchApi('/api/stats/certeza')).json();
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
  const res = await fetch(`http://localhost:${PUERTO_PROLOG}/api/sintomas`, { headers: CH_MOTOR });
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
  const res = await fetch(`http://localhost:${PUERTO_PROLOG}/api/fallas`, { headers: CH_MOTOR });
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
  // El preflight es tambien la excepcion del token: el navegador no puede
  // mandar cabeceras propias en un OPTIONS, y este handler solo responde CORS.
  // Se verifica para que el gateway no dependa de un Prolog degradado.
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

// El gateway solo publica la inferencia y las lecturas del catálogo, y exige
// sesión. Las pruebas de esta zona crean su propia cuenta para no depender de
// los usuarios que arma la fase 6.
const CUENTA_GATEWAY = { username: 'gateway_e2e', password: 'clave-gateway-e2e' };

async function sesionGateway() {
  await usuarioEnMongo({
    ...CUENTA_GATEWAY,
    role: 'administrador_mecanico',
    nombre: 'Gateway E2E',
  });
  const ingreso = await api('/api/auth/login', {
    method: 'POST',
    body: { username: CUENTA_GATEWAY.username, password: CUENTA_GATEWAY.password },
  });
  assert.equal(ingreso.status, 200, 'la cuenta del gateway debe poder iniciar sesión');
  return ingreso.cookie;
}

// Peticiones al gateway con la cookie de sesión a mano: fetch de Node no la
// conserva entre llamadas. `gatewayProxy` sale por el proxy de Vite, que es el
// camino real del navegador; `gateway` va directo a la API, donde vive la
// comprobación de la lista blanca.
function peticionGateway(base, ruta, { method = 'GET', body, cookie } = {}) {
  return fetch(`${base}${ruta}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const gateway = (ruta, opciones) => peticionGateway(API_URL, ruta, opciones);
const gatewayProxy = (ruta, opciones) => peticionGateway(WEB_URL, ruta, opciones);

// Petición HTTP con la ruta literal, sin la normalización de ".." que hace
// `fetch`: es lo que puede mandar un cliente que no sea un navegador.
function peticionCruda(puerto, ruta, cookie) {
  return new Promise((resolve, reject) => {
    const req = peticionHttp(
      {
        host: 'localhost',
        port: puerto,
        path: ruta,
        method: 'GET',
        headers: cookie ? { Cookie: cookie } : {},
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const DIAGNOSTICO_GATEWAY = {
  marca: 'gen',
  modelo: 'gen',
  anio: 0,
  transmision: 'desconocida',
  sintomas: ['chirrido_al_frenar'],
};

test('09c | Gateway Prolog: el navegador llega al motor por el proxy de Vite → Express', async () => {
  // Este es el camino que usa la app real: nada de localhost:8000 en el cliente.
  const cookie = await sesionGateway();

  const sintomas = await (await gatewayProxy('/api/prolog/api/sintomas', { cookie })).json();
  assert.equal(sintomas.status, 'success');
  assert.ok(Array.isArray(sintomas.sintomas));
  assert.equal(sintomas.sintomas.length, 38, 'el gateway debe servir el catálogo completo');

  const diag = await (
    await gatewayProxy('/api/prolog/api/diagnostico', {
      method: 'POST',
      cookie,
      body: DIAGNOSTICO_GATEWAY,
    })
  ).json();
  assert.equal(diag.status, 'success');
  assert.ok(Array.isArray(diag.fallas));
  assert.ok(diag.fallas.length >= 1, 'el gateway debe reenviar el cuerpo al motor y devolver su respuesta');
});

test('09d | Gateway Prolog: 502 cuando el motor no responde, sin filtrar el error interno', async () => {
  // PROLOG_BASE se lee al arrancar el proceso, asi que para probar la rama de
  // error hay que levantar una segunda instancia apuntando a un puerto muerto.
  // Se reserva y se suelta un puerto efimero: asi el fallo es un ECONNREFUSED
  // real, con codigo de red en el log, sin depender de que un numero fijo libre.
  const sonda = crearServidorHttp();
  await new Promise((r) => sonda.listen(0, '127.0.0.1', r));
  const puertoCerrado = sonda.address().port;
  await new Promise((r) => sonda.close(r));

  const puertoMuerto = PUERTO_API + 7;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoMuerto),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      PROLOG_BASE: `http://127.0.0.1:${puertoCerrado}`,
      PROLOG_TIMEOUT_MS: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-sin-motor.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-sin-motor.err'), 'w') }));

  try {
    await sondeo(`http://localhost:${puertoMuerto}/api/config/tipo-cambio`, { timeout: 30000 });

    // La sesión se guarda en Mongo, así que la cookie de la API principal vale
    // también en esta segunda instancia.
    const cookie = await sesionGateway();
    const res = await fetch(`http://localhost:${puertoMuerto}/api/prolog/api/sintomas`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 502, 'sin motor detras, el gateway debe responder 502');

    const cuerpo = await res.json();
    assert.equal(
      cuerpo.error,
      'Motor de inferencia no disponible',
      'el 502 (cayeron todas las replicas) debe distinguirse del 500'
    );
    assert.doesNotMatch(
      JSON.stringify(cuerpo),
      new RegExp(`ECONNREFUSED|127\\.0\\.0\\.1:${puertoCerrado}|fetch failed|at `),
      'no debe filtrarse el destino ni el detalle del error de red'
    );

    // El log del manejador central si distingue: etiqueta el estado y anota la
    // causa de red (codigo incluido), y nunca el token del motor.
    await sleep(150);
    const registro = readFileSync(logPath('api-sin-motor.err'), 'utf8');
    assert.match(
      registro,
      /\[error 502\][^\n]*ECONNREFUSED/,
      'el log registra el estado 502 y el codigo de red de la causa'
    );
    assert.doesNotMatch(registro, new RegExp(MOTOR_TOKEN_E2E), 'el log no debe filtrar el token del motor');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

test('09e | Gateway Prolog: sin sesión no se llega al motor', async () => {
  const catalogo = await gateway('/api/prolog/api/sintomas');
  assert.equal(catalogo.status, 401, 'leer el catálogo sin sesión debe ser 401');

  const diag = await gateway('/api/prolog/api/diagnostico', {
    method: 'POST',
    body: DIAGNOSTICO_GATEWAY,
  });
  assert.equal(diag.status, 401, 'inferir sin sesión debe ser 401');
  assert.equal((await diag.json()).error, 'No autenticado');
});

test('09f | Gateway Prolog: ni el administrador modifica el catálogo por el gateway', async () => {
  const cookie = await sesionGateway();

  // La ruta se puede leer, no borrar: el catálogo se modifica por /api/fallas.
  const borrado = await gateway('/api/prolog/api/fallas?prologId=lo_que_sea', {
    method: 'DELETE',
    cookie,
  });
  assert.equal(borrado.status, 405, 'borrar por el gateway debe estar prohibido');
  assert.match(
    borrado.headers.get('allow') || '',
    /GET/,
    'el 405 debe anunciar los métodos permitidos'
  );

  // El bootstrap no está publicado en absoluto.
  const bootstrap = await gateway('/api/prolog/api/fallas/bootstrap', {
    method: 'POST',
    cookie,
    body: { fallas: [] },
  });
  assert.equal(bootstrap.status, 404, 'el bootstrap no debe ser alcanzable');

  // Y el catálogo conserva sus 54 fallas: ninguna de esas peticiones llegó.
  const fallas = await (await gateway('/api/prolog/api/fallas', { cookie })).json();
  assert.equal(fallas.fallas.length, 54, 'el catálogo no debe quedar tocado');
});

test('09g | Gateway Prolog: las rutas con trucos no coinciden con la lista', async () => {
  const cookie = await sesionGateway();

  // fetch normaliza ".." antes de enviarlo, así que la subida de directorio se
  // prueba con una petición cruda: es lo que puede mandar un cliente que no sea
  // un navegador (curl --path-as-is, o un socket a mano).
  const traversal = await peticionCruda(PUERTO_API, '/api/prolog/api/../api/sintomas', cookie);
  assert.equal(traversal, 404, 'el recorrido de directorios debe quedar fuera');

  for (const ruta of [
    '/api/prolog/api/%73intomas',
    '/api/prolog/api/sintomas/',
    '/api/prolog//api/sintomas',
  ]) {
    const res = await gateway(ruta, { cookie });
    assert.equal(res.status, 404, `${ruta} debe responder 404`);
  }
});

test('09h | Motor Prolog: sin token no se lee ni se modifica nada', async () => {
  // El motor solo comprueba el token, pero es la capa que no se puede rodear:
  // sin este 401, quien alcance su puerto vacia el catalogo aunque el gateway
  // de la API publique solo las lecturas.
  const lectura = await fetch(`http://localhost:${PUERTO_PROLOG}/api/fallas`);
  assert.equal(lectura.status, 401, 'leer el catálogo sin token debe ser 401');
  assert.equal((await lectura.json()).error, 'No autorizado');

  const borrado = await fetch(
    `http://localhost:${PUERTO_PROLOG}/api/fallas?prologId=sistema_frenos_con_aire`,
    { method: 'DELETE' }
  );
  assert.equal(borrado.status, 401, 'borrar sin token debe ser 401');

  const falso = await fetch(`http://localhost:${PUERTO_PROLOG}/api/sintomas`, {
    headers: { 'X-Motor-Token': '0000000000000000' },
  });
  assert.equal(falso.status, 401, 'un token distinto debe ser 401');

  // Y el catálogo sigue ahí: ninguna de esas peticiones llegó a ejecutarse.
  const conToken = await (
    await fetch(`http://localhost:${PUERTO_PROLOG}/api/fallas`, { headers: CH_MOTOR })
  ).json();
  assert.ok(
    conToken.fallas.some((f) => f.id === 'sistema_frenos_con_aire'),
    'el catálogo debe quedar intacto'
  );

  // La sonda de salud la pide el orquestador sin credenciales: tiene que
  // responder sin token y sin tocar la base de conocimiento.
  const salud = await fetch(`http://localhost:${PUERTO_PROLOG}/health`);
  assert.equal(salud.status, 200, '/health del motor debe ser publico');
  assert.equal((await salud.json()).status, 'ok');
});

test('09m | Motor Prolog: sin MOTOR_TOKEN arranca abierto y lo avisa', async () => {
  // El despliegue por etapas puede levantar el motor nuevo antes de que exista
  // la variable; sin token el motor no exige nada, y lo deja dicho por stderr.
  // Es el unico estado en el que esto pasa, y el motivo de que el aviso exista:
  // si falta la variable en produccion, la proteccion esta apagada.
  const puerto = PUERTO_PROLOG + 11;
  const proc = spawn(SWIPL, ['-q', '-f', PL_FILE, '-g', `server(${puerto}), sleep(3600)`, '-t', 'halt'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOTOR_TOKEN: '' },
  });
  let errores = '';
  proc.stderr.on('data', (d) => {
    errores += d.toString();
  });

  try {
    await sondeo(`http://localhost:${puerto}/health`, { timeout: 60000 });
    const res = await fetch(`http://localhost:${puerto}/api/sintomas`);
    assert.equal(res.status, 200, 'sin token configurado el motor no debe exigir token');
    assert.ok(Array.isArray((await res.json()).sintomas), 'y debe seguir sirviendo el catalogo');
    assert.match(errores, /MOTOR_TOKEN no esta definido/, 'el arranque debe avisar de que esta abierto');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

test('09k | API: las rutas de datos exigen sesion, las publicas siguen abiertas', async () => {
  // 1.7 movio el historial y las estadisticas detras de requireAuth: sin sesion
  // no hay que inspeccionar la base ni gastar la agregacion de stats.
  for (const [ruta, opciones] of [
    ['/api/diagnosticos', {}],
    ['/api/diagnosticos', { method: 'POST', body: {} }],
    ['/api/stats/certeza', {}],
  ]) {
    const res = await api(ruta, opciones);
    assert.equal(res.status, 401, `${ruta} sin sesion debe responder 401`);
  }

  // Lo que el navegador necesita antes de entrar (y el orquestador) sigue abierto.
  for (const ruta of ['/health', '/api/config/tipo-cambio']) {
    const res = await api(ruta);
    assert.ok(res.status < 400, `${ruta} debe seguir siendo publica, vino ${res.status}`);
  }

  // Una ruta inexistente responde JSON, no el HTML por defecto de Express.
  const inexistente = await api('/api/no-existe');
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.body?.error, 'Ruta no encontrada');

  // helmet deja sus cabeceras en cualquier respuesta, tambien en las publicas.
  const res = await fetch(`${API_URL}/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('09j | API: /health responde sin sesion y refleja la base', async () => {
  // Es la sonda del ALB: publica (llega antes que la sesion) y barata.
  const res = await fetch(`${API_URL}/health`);
  assert.equal(res.status, 200, '/health debe ser publico');
  const cuerpo = await res.json();
  assert.equal(cuerpo.status, 'ok');
  assert.equal(cuerpo.db, 'conectado', 'la sonda debe ver la base conectada');
});

test('09i | API: la cabecera X-Origin-Verify se exige solo si esta configurada', async () => {
  // CloudFront es el unico camino legitimo hacia el ALB porque inyecta esta
  // cabecera; configurarla cierra el acceso directo al DNS del balanceador. Se
  // prueba en una segunda instancia porque la variable se lee al arrancar (la
  // API principal de la suite la tiene sin definir, y asi el resto de las
  // pruebas comprueba que el filtro es inerte en local).
  const puerto = PUERTO_API + 8;
  const secreto = 'secreto-de-origen-e2e';
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puerto),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      ORIGIN_VERIFY: secreto,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-origen.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-origen.err'), 'w') }));

  try {
    // La sonda de arranque tambien pasa por el filtro: hay que presentarla.
    await sondeo(`http://localhost:${puerto}/api/config/tipo-cambio`, {
      timeout: 30000,
      headers: { 'X-Origin-Verify': secreto },
    });

    const sinCabecera = await fetch(`http://localhost:${puerto}/api/config/tipo-cambio`);
    assert.equal(sinCabecera.status, 403, 'sin la cabecera de CloudFront debe rechazarse');

    const conCabecera = await fetch(`http://localhost:${puerto}/api/config/tipo-cambio`, {
      headers: { 'X-Origin-Verify': secreto },
    });
    assert.equal(conCabecera.status, 200, 'con la cabecera de CloudFront debe pasar');

    const ajena = await fetch(`http://localhost:${puerto}/api/config/tipo-cambio`, {
      headers: { 'X-Origin-Verify': 'otro-valor' },
    });
    assert.equal(ajena.status, 403, 'un valor distinto debe rechazarse');

    // Misma longitud que el secreto pero distinto contenido: ejercita el camino en
    // que timingSafeEqual si compara (longitudes iguales) y no el rechazo por tamano.
    const mismaLongitud = await fetch(`http://localhost:${puerto}/api/config/tipo-cambio`, {
      headers: { 'X-Origin-Verify': 'x'.repeat(secreto.length) },
    });
    assert.equal(mismaLongitud.status, 403, 'un valor de igual longitud tambien debe rechazarse');

    // El health check del ALB llega al destino sin pasar por CloudFront. Si el
    // filtro lo alcanzara, el balanceador sacaria la tarea de servicio.
    const salud = await fetch(`http://localhost:${puerto}/health`);
    assert.equal(salud.status, 200, '/health debe quedar fuera del filtro');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

test('09l | API: el limitador corta con 429, el general y el del login', async () => {
  // Se prueba en instancias propias con un cupo diminuto: agotar el de la API
  // principal, que comparte IP con toda la suite, haria fallar al resto por un
  // motivo ajeno a lo que cada prueba mide.
  const arrancarApi = async (puerto, extra) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        PORT: String(puerto),
        MONGO_URI: TEST_DB,
        MOTOR_TOKEN: MOTOR_TOKEN_E2E,
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = (sufijo) => createWriteStream(null, { fd: openSync(logPath(`api-limite-${puerto}.${sufijo}`), 'w') });
    proc.stdout.pipe(log('out'));
    proc.stderr.pipe(log('err'));
    // /health vive fuera de /api, asi que sondear el arranque no gasta cupo.
    await sondeo(`http://localhost:${puerto}/health`, { timeout: 30000 });
    return proc;
  };

  // Cupo general: dos peticiones pasan y la tercera se corta.
  let proc = await arrancarApi(PUERTO_API + 9, { RATE_LIMIT_MAX: '2' });
  try {
    const ruta = `http://localhost:${PUERTO_API + 9}/api/config/tipo-cambio`;
    for (let i = 1; i <= 2; i += 1) {
      assert.equal((await fetch(ruta)).status, 200, `la peticion ${i} deberia pasar`);
    }
    const tercera = await fetch(ruta);
    assert.equal(tercera.status, 429, 'pasado el cupo la API debe responder 429');
    assert.ok(tercera.headers.get('ratelimit-limit'), 'la respuesta debe anunciar el cupo');
    assert.equal((await tercera.json()).error, 'Demasiadas peticiones. Intenta mas tarde.');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }

  // Cupo del login: cuenta solo los intentos fallidos y su clave es (IP, usuario).
  // Se comprueba ademas que agotar el cupo de una cuenta no bloquea a otra que
  // entra desde la misma red.
  const cuenta = { username: 'limite_e2e', password: 'clave-limite-e2e' };
  const otra = { username: 'limite_otro_e2e', password: 'clave-limite-otro' };
  await usuarioEnMongo({ ...cuenta, role: 'estudiante_mecanica', nombre: 'Limite E2E' });
  await usuarioEnMongo({ ...otra, role: 'estudiante_mecanica', nombre: 'Limite Otro E2E' });
  proc = await arrancarApi(PUERTO_API + 10, { LOGIN_RATE_LIMIT_MAX: '2' });
  try {
    const ingreso = `http://localhost:${PUERTO_API + 10}/api/auth/login`;
    const intento = (usuario, clave) =>
      fetch(ingreso, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usuario, password: clave }),
      });

    assert.equal(
      (await intento(cuenta.username, cuenta.password)).status,
      200,
      'un ingreso correcto no gasta cupo'
    );
    assert.equal((await intento(cuenta.username, 'mala')).status, 401, 'el primer fallo cuenta');
    assert.equal((await intento(cuenta.username, 'mala')).status, 401, 'el segundo fallo cuenta');
    const cuarto = await intento(cuenta.username, 'mala');
    assert.equal(cuarto.status, 429, 'pasado el cupo de fallos el login se corta');
    assert.equal((await cuarto.json()).error, 'Demasiados intentos fallidos. Intenta mas tarde.');

    assert.equal(
      (await intento(otra.username, 'mala')).status,
      401,
      'agotar el cupo de una cuenta no debe bloquear a otra'
    );
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

test('09n | API: DEBUG_IP registra el origen del login y nunca la contrasena', async () => {
  // Ayuda temporal para calibrar TRUST_PROXY_HOPS: apagada por defecto y solo
  // escribe la IP y X-Forwarded-For. Las aserciones de que ni el usuario ni la
  // contraseña aparecen son las que impiden que el diagnostico sea una fuga.
  const puerto = PUERTO_API + 11;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puerto),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      DEBUG_IP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  proc.stdout.on('data', (d) => {
    salida += d.toString();
  });

  const usuario = 'quien_sea_e2e';
  const contrasena = 'contrasena-que-no-debe-salir';
  try {
    await sondeo(`http://localhost:${puerto}/health`, { timeout: 30000 });
    const res = await fetch(`http://localhost:${puerto}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
      body: JSON.stringify({ username: usuario, password: contrasena }),
    });
    assert.equal(res.status, 401, 'un usuario inexistente no entra');
    await sleep(300); // el pipe entrega la linea un instante despues

    assert.match(salida, /\[debug-ip\] ip=\S+ x-forwarded-for=/, 'debe registrar la IP y la cabecera');
    assert.ok(salida.includes('203.0.113.7'), 'el X-Forwarded-For crudo debe quedar registrado');
    assert.match(
      salida,
      /protocol=\S+ secure=\S+/,
      'debe registrar el protocolo y si la peticion es segura (para calibrar la cookie)'
    );
    assert.ok(!salida.includes(contrasena), 'nunca debe registrar la contrasena');
    assert.ok(!salida.includes(usuario), 'nunca debe registrar el usuario');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

test('09o | API en produccion: la cabecera de CloudFront fija el protocolo y la cookie sale Secure', async () => {
  // El ALB reescribe X-Forwarded-Proto con el protocolo de SU listener (http), asi
  // que sin el filtro de origen Express veria req.secure = false y express-session,
  // con la cookie en secure por NODE_ENV=production, la descartaria: el login
  // responderia 200 pero sin sesion. Con la cabecera secreta de CloudFront el
  // protocolo se fija en https y la cookie se emite. La prueba NO manda
  // x-forwarded-proto: eso es justo lo que reproduce la nube.
  const puerto = PUERTO_API + 12;
  const secreto = 'secreto-de-origen-productivo';
  const cuenta = { username: 'origen_prod_e2e', password: 'clave-origen-prod' };
  await usuarioEnMongo({ ...cuenta, role: 'estudiante_mecanica', nombre: 'Origen Prod E2E' });

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puerto),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      NODE_ENV: 'production',
      SESSION_SECRET: 'secreto-sesion-e2e',
      ORIGIN_VERIFY: secreto,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-origen-prod.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-origen-prod.err'), 'w') }));

  const ingreso = (headers) =>
    fetch(`http://localhost:${puerto}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(cuenta),
    });

  try {
    await sondeo(`http://localhost:${puerto}/api/config/tipo-cambio`, {
      timeout: 30000,
      headers: { 'X-Origin-Verify': secreto },
    });

    const sinCabecera = await ingreso({});
    assert.equal(sinCabecera.status, 403, 'sin la cabecera de CloudFront el login se rechaza');

    const ajena = await ingreso({ 'X-Origin-Verify': 'otro-valor' });
    assert.equal(ajena.status, 403, 'con una cabecera distinta el login se rechaza');

    const conCabecera = await ingreso({ 'X-Origin-Verify': secreto });
    assert.equal(conCabecera.status, 200, 'con la cabecera de CloudFront el login entra');
    const setCookie = conCabecera.headers.get('set-cookie') || '';
    assert.match(setCookie, /connect\.sid=/, 'en produccion el login debe emitir la cookie de sesion');
    assert.match(setCookie, /;\s*Secure\b/i, 'la cookie debe llevar Secure sin x-forwarded-proto de entrada');
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

  const resProxy = await fetchWebApi('/api/diagnosticos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo,
      sintomas,
      fallas: motor.fallas.map((f) => ({ falla: f.id, certeza: f.certeza })),
    }),
  });
  assert.equal(resProxy.status, 201, 'El proxy de Vite debe reenviar a la API');

  const stats = await (await fetchWebApi('/api/stats/certeza')).json();
  assert.ok(stats.por_falla.some((f) => f.falla === infere.id), `stats deben incluir ${infere.id}`);

  const historial = await (await fetchWebApi('/api/diagnosticos')).json();
  assert.ok(historial.some((d) => d.vehiculo.marca === 'honda' && d.fallas?.some((f) => f.falla === infere.id)));
});

// ---------------------------------------------------------------------------
// FASE 6: sesion, roles y CRUD de administracion.
//
// Estas pruebas necesitan una sesion real, y `fetch` de Node no conserva cookies
// entre llamadas: hay que leer el Set-Cookie del ingreso y reenviarlo a mano en
// cada peticion. Por eso viven en `api()` en vez de llamar a fetch directo.
//
// El primer administrador se inserta en Mongo directamente, no por la API: la
// API exige rol de administrador para crear cuentas, asi que a traves de ella no
// habria forma de arrancar. Es exactamente lo que hace el seed del arranque, y el
// `before` borro la base despues, asi que aqui no queda ninguno.
// ---------------------------------------------------------------------------
async function api(ruta, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${API_URL}${ruta}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // Un cuerpo no-JSON (por ejemplo el HTML de error de Express) se entrega en
    // `texto`; las aserciones pueden mirarlo sin que el test se caiga aqui.
  }
  // La sesion deja una sola cookie, asi que basta con el par nombre=valor; los
  // atributos (Path, HttpOnly, SameSite) no viajan en la peticion.
  const setCookie = res.headers.get('set-cookie') || '';
  return {
    status: res.status,
    body: json,
    texto,
    cookie: setCookie ? setCookie.split(';')[0] : null,
  };
}

async function usuarioEnMongo({ username, password, role, nombre }) {
  const require = createRequire(import.meta.url);
  const m = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  const bcrypt = require(path.join(BACKEND_DIR, 'node_modules', 'bcryptjs'));

  await m.connect(TEST_DB);
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const ahora = new Date();
    await m.connection.collection('users').updateOne(
      { username },
      { $set: { username, passwordHash, role, nombre, activo: true, updatedAt: ahora } },
      { upsert: true }
    );
    const doc = await m.connection.collection('users').findOne({ username });
    return doc._id.toString();
  } finally {
    await m.disconnect();
  }
}

async function idDeUsuarioEnMongo(username) {
  const require = createRequire(import.meta.url);
  const m = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  await m.connect(TEST_DB);
  try {
    const doc = await m.connection.collection('users').findOne({ username });
    return doc._id.toString();
  } finally {
    await m.disconnect();
  }
}

// Las pruebas del último administrador necesitan saber cuántos hay, así que
// vacían la colección en vez de contar con lo que dejaron los tests anteriores.
async function limpiarUsuarios() {
  const require = createRequire(import.meta.url);
  const m = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  await m.connect(TEST_DB);
  try {
    await m.connection.collection('users').deleteMany({});
  } finally {
    await m.disconnect();
  }
}

const FALLA_VALIDA = {
  nombre: 'Fuga de refrigerante e2e',
  sintomas: ['aire_acondicionado_no_enfria'],
  vehiculo: { marca: 'honda', modelo: 'civic', anio: 2015, transmision: 'cvt' },
  causas: ['Válvula de expansión con fuga'],
  solucion: 'Sustituir la válvula de expansión y recargar refrigerante.',
  procedimiento: ['Medir presión', 'Localizar la fuga', 'Sustituir y recargar'],
  precioMin: 1200,
  precioMax: 3500,
  urgencia: 'media',
  confianzaDato: 'media',
  certezaBase: 0.7,
};

test('13 | Sesión: sin cookie, las rutas de administración responden 401', async () => {
  const escritura = await api('/api/fallas', { method: 'POST', body: FALLA_VALIDA });
  assert.equal(escritura.status, 401, 'crear una falla sin sesión debe ser 401');

  const lectura = await api('/api/usuarios');
  assert.equal(lectura.status, 401, 'leer usuarios sin sesión debe ser 401');

  const me = await api('/api/auth/me');
  assert.equal(me.status, 401, '/api/auth/me sin sesión debe ser 401');
});

test('14 | Sesión: credenciales incorrectas no dicen qué parte falló', async () => {
  await usuarioEnMongo({
    username: 'admin_e2e',
    password: 'clave-admin-e2e',
    role: 'administrador_mecanico',
    nombre: 'Admin E2E',
  });

  const malo = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin_e2e', password: 'incorrecta' },
  });
  assert.equal(malo.status, 401);
  const inexistente = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'no_existe_e2e', password: 'incorrecta' },
  });
  assert.equal(inexistente.status, 401);
  // Mismo mensaje para usuario inexistente y para contraseña incorrecta: si
  // difirieran, confirmarian si ese usuario existe.
  assert.equal(malo.body.error, inexistente.body.error);

  const bueno = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin_e2e', password: 'clave-admin-e2e' },
  });
  assert.equal(bueno.status, 200);
  assert.equal(bueno.body.role, 'administrador_mecanico');
  assert.ok(bueno.cookie, 'el ingreso debe establecer la cookie de sesión');
  assert.match(bueno.cookie, /^connect\.sid=/, 'la cookie debe ser la de sesión');

  const me = await api('/api/auth/me', { cookie: bueno.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.username, 'admin_e2e');
  assert.equal(me.body.role, 'administrador_mecanico');
  assert.ok(!('passwordHash' in me.body), 'la sesión no debe incluir el hash');

  const salida = await api('/api/auth/logout', { method: 'POST', cookie: bueno.cookie });
  assert.equal(salida.status, 200);
  const meTrasSalir = await api('/api/auth/me', { cookie: bueno.cookie });
  assert.equal(meTrasSalir.status, 401, 'tras cerrar sesión la cookie debe morir');
});

test('15 | Roles: el estudiante lee pero no escribe, aunque el botón no exista en la web', async () => {
  await usuarioEnMongo({
    username: 'estudiante_e2e',
    password: 'clave-estudiante-e2e',
    role: 'estudiante_mecanica',
    nombre: 'Estudiante E2E',
  });
  const ingreso = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'estudiante_e2e', password: 'clave-estudiante-e2e' },
  });
  assert.equal(ingreso.status, 200);
  const cookie = ingreso.cookie;

  const lectura = await api('/api/diagnosticos', { cookie });
  assert.equal(lectura.status, 200, 'el estudiante sí puede usar las funciones base');

  for (const [ruta, opciones] of [
    ['/api/fallas', { method: 'POST', body: FALLA_VALIDA }],
    ['/api/usuarios', { method: 'POST', body: { username: 'x_e2e', password: 'y' } }],
  ]) {
    const r = await api(ruta, { ...opciones, cookie });
    assert.equal(r.status, 403, `${ruta} debe rechazar al estudiante con 403`);
  }
});

test('16 | Fallas: ciclo completo del administrador y el hash nunca sale de la colección de usuarios', async () => {
  await usuarioEnMongo({
    username: 'admin_ciclo',
    password: 'clave-ciclo',
    role: 'administrador_mecanico',
    nombre: 'Admin Ciclo',
  });
  const { cookie } = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin_ciclo', password: 'clave-ciclo' },
  });
  assert.ok(cookie);

  const creada = await api('/api/fallas', {
    method: 'POST',
    cookie,
    body: { ...FALLA_VALIDA, nombre: 'Fuga de refrigerante ciclo' },
  });
  assert.equal(creada.status, 201);
  assert.equal(creada.body.prologId, 'fuga_de_refrigerante_ciclo');
  assert.equal(creada.body.activo, true);

  const duplicada = await api('/api/fallas', {
    method: 'POST',
    cookie,
    body: { ...FALLA_VALIDA, nombre: 'Fuga de refrigerante ciclo' },
  });
  assert.equal(duplicada.status, 409, 'el mismo prologId vivo debe dar 409');

  const invalida = await api('/api/fallas', {
    method: 'POST',
    cookie,
    body: { ...FALLA_VALIDA, nombre: 'Precio invertido', precioMin: 9000, precioMax: 100 },
  });
  assert.equal(invalida.status, 400, 'precio mínimo mayor que el máximo debe rechazarse');
  assert.ok(invalida.body.error);

  const listado = await api('/api/fallas', { cookie });
  assert.equal(listado.status, 200);
  assert.ok(listado.body.some((f) => f._id === creada.body._id));
  assert.ok(
    listado.body.find((f) => f._id === creada.body._id).creadoPor?.username === 'admin_ciclo',
    'la lista debe rellenar quién registró la falla'
  );

  const editada = await api(`/api/fallas/${creada.body._id}`, {
    method: 'PUT',
    cookie,
    body: { ...FALLA_VALIDA, nombre: 'Fuga de refrigerante ciclo', precioMin: 1500, precioMax: 4000 },
  });
  assert.equal(editada.status, 200);
  assert.equal(editada.body.precioMin, 1500);

  const borrada = await api(`/api/fallas/${creada.body._id}`, { method: 'DELETE', cookie });
  assert.equal(borrada.status, 200);

  // Soft delete: el documento sigue existiendo, marcado como no activo. Sin esto
  // el historial de diagnósticos apuntaría a fallas que ya no se pueden leer.
  const conBorradas = await api('/api/fallas?includeDeleted=true', { cookie });
  const fila = conBorradas.body.find((f) => f._id === creada.body._id);
  assert.ok(fila, 'la falla borrada debe seguir en la colección');
  assert.equal(fila.activo, false);
  assert.ok(fila.deletedAt, 'el borrado lógico debe dejar constancia de la fecha');

  const soloVivas = await api('/api/fallas', { cookie });
  assert.ok(!soloVivas.body.some((f) => f._id === creada.body._id), 'no debe listarse entre las vivas');

  const usuarios = await api('/api/usuarios', { cookie });
  assert.doesNotMatch(usuarios.texto, /passwordHash|\$2[aby]\$/, 'el hash no puede aparecer en la lista de usuarios');
});

test('17 | Índice parcial: una falla borrada deja libre su prologId', async () => {
  // Con el indice unico global, este ciclo terminaba en un 500 de clave duplicada:
  // borrar logicamente no liberaba el identificador, y volver a capturar la misma
  // falla (se creo, se elimino por error, se vuelve a capturar) era imposible.
  await usuarioEnMongo({
    username: 'admin_indice',
    password: 'clave-indice',
    role: 'administrador_mecanico',
    nombre: 'Admin Indice',
  });
  const { cookie } = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin_indice', password: 'clave-indice' },
  });

  const nombre = 'Fuga de refrigerante reuso';
  const primera = await api('/api/fallas', {
    method: 'POST',
    cookie,
    body: { ...FALLA_VALIDA, nombre },
  });
  assert.equal(primera.status, 201);

  const borrado = await api(`/api/fallas/${primera.body._id}`, { method: 'DELETE', cookie });
  assert.equal(borrado.status, 200);

  const segunda = await api('/api/fallas', {
    method: 'POST',
    cookie,
    body: { ...FALLA_VALIDA, nombre },
  });
  assert.equal(segunda.status, 201, 'recrear una falla borrada debe funcionar');
  assert.notEqual(segunda.body._id, primera.body._id, 'es un documento nuevo, no el mismo reactivado');
});

test('18 | Motor Prolog: la falla creada aparece y la borrada desaparece', async () => {
  await usuarioEnMongo({
    username: 'admin_motor',
    password: 'clave-motor',
    role: 'administrador_mecanico',
    nombre: 'Admin Motor',
  });
  const { cookie } = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin_motor', password: 'clave-motor' },
  });

  const prologId = 'fuga_de_refrigerante_motor';
  const creada = await api('/api/fallas', {
    method: 'POST',
    cookie,
    body: { ...FALLA_VALIDA, nombre: 'Fuga de refrigerante motor' },
  });
  assert.equal(creada.status, 201);

  // La sincronizacion con el motor es asincrona a proposito (una falla guardada
  // no espera a Prolog), asi que se sondea en vez de exigirlo en la respuesta.
  const enMotor = async (id) => {
    const cuerpo = await (await fetch(`http://localhost:${PUERTO_PROLOG}/api/fallas`, { headers: CH_MOTOR })).json();
    return (cuerpo.fallas || cuerpo).some((f) => f.id === id || f.prologId === id);
  };
  let presente = false;
  for (let i = 0; i < 20 && !presente; i++) {
    presente = await enMotor(prologId);
    if (!presente) await sleep(250);
  }
  assert.ok(presente, 'la falla creada por el administrador debe llegar al motor');

  const borrada = await api(`/api/fallas/${creada.body._id}`, { method: 'DELETE', cookie });
  assert.equal(borrada.status, 200);

  let ausente = false;
  for (let i = 0; i < 20 && !ausente; i++) {
    ausente = !(await enMotor(prologId));
    if (!ausente) await sleep(250);
  }
  assert.ok(ausente, 'la falla borrada debe salir del motor, no seguir ofrecida');
});

test('19 | Revocación: degradar o desactivar a un administrador corta su escritura de inmediato', async () => {
  await usuarioEnMongo({
    username: 'admin_jefe',
    password: 'clave-jefe',
    role: 'administrador_mecanico',
    nombre: 'Jefe',
  });
  await usuarioEnMongo({
    username: 'admin_subrevocado',
    password: 'clave-sub',
    role: 'administrador_mecanico',
    nombre: 'Sub Revocado',
  });

  const jefe = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin_jefe', password: 'clave-jefe' },
    })
  ).cookie;
  const sub = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin_subrevocado', password: 'clave-sub' },
    })
  ).cookie;

  const idSub = await idDeUsuarioEnMongo('admin_subrevocado');
  const degradado = await api(`/api/usuarios/${idSub}`, {
    method: 'PUT',
    cookie: jefe,
    body: { role: 'estudiante_mecanica' },
  });
  assert.equal(degradado.status, 200);

  // La cookie del sub sigue viva y su sesión no cambió, pero la escritura se
  // rechaza: la autorización relee la cuenta en cada petición, no copia el rol
  // dentro de la sesión.
  const escritura = await api('/api/fallas', {
    method: 'POST',
    cookie: sub,
    body: { ...FALLA_VALIDA, nombre: 'No deberia entrar' },
  });
  assert.equal(escritura.status, 403, 'un rol degradado no puede escribir con la cookie vieja');

  await api(`/api/usuarios/${idSub}`, { method: 'PUT', cookie: jefe, body: { role: 'administrador_mecanico' } });
  const desactivado = await api(`/api/usuarios/${idSub}`, { method: 'DELETE', cookie: jefe });
  assert.equal(desactivado.status, 200);

  const escrituraTrasDesactivar = await api('/api/fallas', {
    method: 'POST',
    cookie: sub,
    body: { ...FALLA_VALIDA, nombre: 'Tampoco deberia entrar' },
  });
  assert.equal(escrituraTrasDesactivar.status, 401, 'una cuenta desactivada no puede escribir con la cookie vieja');

  const ingresoDesactivado = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin_subrevocado', password: 'clave-sub' },
  });
  assert.equal(ingresoDesactivado.status, 401, 'una cuenta desactivada tampoco puede volver a entrar');
});

test('20 | Último administrador: ni el jefe puede dejar la instalación sin acceso', async () => {
  // Se aíslan los administradores de esta prueba: si contaran los que dejaron los
  // tests anteriores, "degradar al último" no sería el último y el 400 nunca
  // llegaría.
  await limpiarUsuarios();
  await usuarioEnMongo({
    username: 'admin_unico',
    password: 'clave-unico',
    role: 'administrador_mecanico',
    nombre: 'Unico',
  });
  await usuarioEnMongo({
    username: 'admin_segundo',
    password: 'clave-segundo',
    role: 'administrador_mecanico',
    nombre: 'Segundo',
  });

  const uno = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin_unico', password: 'clave-unico' },
    })
  ).cookie;

  const idUnico = await idDeUsuarioEnMongo('admin_unico');
  const idSegundo = await idDeUsuarioEnMongo('admin_segundo');

  // Con dos administradores, cada uno puede dejar de serlo: siempre queda el otro.
  const primero = await api(`/api/usuarios/${idSegundo}`, {
    method: 'PUT',
    cookie: uno,
    body: { role: 'estudiante_mecanica' },
  });
  assert.equal(primero.status, 200);

  // Y ya no puede dejar el último.
  const ultimo = await api(`/api/usuarios/${idUnico}`, {
    method: 'PUT',
    cookie: uno,
    body: { role: 'estudiante_mecanica' },
  });
  assert.equal(ultimo.status, 400, 'no se puede degradar al último administrador');
  assert.match(ultimo.body.error, /al menos un administrador/i);

  // Lo mismo por la vía de desactivar: es la misma regla, no dos.
  const desactivado = await api(`/api/usuarios/${idUnico}`, { method: 'DELETE', cookie: uno });
  assert.equal(desactivado.status, 400);

  const sigueSiendoAdmin = await api(`/api/usuarios/${idUnico}`, {
    method: 'PUT',
    cookie: uno,
    body: { nombre: 'Unico Renombrado' },
  });
  assert.equal(sigueSiendoAdmin.status, 200);
  assert.equal(sigueSiendoAdmin.body.role, 'administrador_mecanico');
});

test('21 | Dos degradaciones simultáneas no dejan cero administradores', async () => {
  // El conteo y la escritura del test anterior son dos operaciones separadas: sin
  // serializarlas, los dosRequests verían "hay otro administrador" a la vez y
  // ambos pasarían, dejando la instalación sin nadie que pueda entrar.
  await limpiarUsuarios();
  await usuarioEnMongo({
    username: 'admin_a_race',
    password: 'clave-a',
    role: 'administrador_mecanico',
    nombre: 'A',
  });
  await usuarioEnMongo({
    username: 'admin_b_race',
    password: 'clave-b',
    role: 'administrador_mecanico',
    nombre: 'B',
  });

  const a = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin_a_race', password: 'clave-a' },
    })
  ).cookie;
  const b = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin_b_race', password: 'clave-b' },
    })
  ).cookie;

  const [respA, respB] = await Promise.all([
    api(`/api/usuarios/${await idDeUsuarioEnMongo('admin_b_race')}`, {
      method: 'PUT',
      cookie: a,
      body: { role: 'estudiante_mecanica' },
    }),
    api(`/api/usuarios/${await idDeUsuarioEnMongo('admin_a_race')}`, {
      method: 'PUT',
      cookie: b,
      body: { role: 'estudiante_mecanica' },
    }),
  ]);

  const exitosos = [respA, respB].filter((r) => r.status === 200);
  assert.equal(
    exitosos.length,
    1,
    'exactamente una de las dos degradaciones simultáneas debe prosperar'
  );

  // La perdedora no siempre alcanza la guarda del último administrador: si la otra
  // peticion ya degrado su cuenta antes de que requireAdmin releyera el rol,
  // requireAdmin la corta antes con 403. Los dos rechazos son correctos; lo que no
  // puede pasar es que tambien sea un 200, o que el rechazo sea un 5xx.
  const perdedora = [respA, respB].find((r) => r.status !== 200);
  assert.ok(
    perdedora.status === 400 || perdedora.status === 403,
    `la otra debe recibir 400 (ultimo administrador) o 403 (rol ya degradado), no ${perdedora.status}`
  );

  const require = createRequire(import.meta.url);
  const m = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  await m.connect(TEST_DB);
  const vivos = await m.connection.collection('users').countDocuments({
    role: 'administrador_mecanico',
    activo: true,
  });
  await m.disconnect();
  assert.ok(vivos >= 1, 'debe quedar al menos un administrador activo');
});

test('23 | Mi perfil: el estudiante edita nombre y contraseña, no usuario ni rol', async () => {
  await limpiarUsuarios();
  await usuarioEnMongo({
    username: 'est_perfil',
    password: 'clave-vieja',
    role: 'estudiante_mecanica',
    nombre: 'Est Perfil',
  });

  const cookie = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'est_perfil', password: 'clave-vieja' },
    })
  ).cookie;

  const renombrado = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { nombre: 'Estudiantina Renovada' },
  });
  assert.equal(renombrado.status, 200);
  assert.equal(renombrado.body.nombre, 'Estudiantina Renovada');

  // Pedir rol de administrador o un usuario nuevo se ignora: un estudiante no
  // se asciende solo, y la identidad no se toca desde aca.
  const escalada = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { nombre: 'N', role: 'administrador_mecanico', username: 'est_hacker' },
  });
  assert.equal(escalada.status, 200);
  assert.equal(escalada.body.role, 'estudiante_mecanica', 'un estudiante no puede autoascenderse');
  assert.equal(escalada.body.username, 'est_perfil', 'un estudiante no cambia su usuario');

  const conClave = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { password: 'clave-nueva' },
  });
  assert.equal(conClave.status, 200);

  const vieja = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'est_perfil', password: 'clave-vieja' },
  });
  assert.equal(vieja.status, 401, 'la contraseña vieja deja de servir');

  const nueva = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'est_perfil', password: 'clave-nueva' },
  });
  assert.equal(nueva.status, 200, 'la contraseña nueva abre la sesión');
});

test('24 | Mi perfil: el administrador cambia usuario y rol, con unicidad y sin autoascenso', async () => {
  await limpiarUsuarios();
  await usuarioEnMongo({
    username: 'admin_perfil',
    password: 'clave-admin',
    role: 'administrador_mecanico',
    nombre: 'Admin Perfil',
  });
  await usuarioEnMongo({
    username: 'admin_perfil_2',
    password: 'clave-admin2',
    role: 'administrador_mecanico',
    nombre: 'Segundo Admin',
  });

  const cookie = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin_perfil', password: 'clave-admin' },
    })
  ).cookie;

  const renombrado = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { username: 'admin_renombrado', nombre: 'Admin Renombrado' },
  });
  assert.equal(renombrado.status, 200);
  assert.equal(renombrado.body.username, 'admin_renombrado');

  // La sesion guarda el id, no el nombre: la cookie sigue valida tras renovarse.
  const me = await api('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.username, 'admin_renombrado');

  const conflicto = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { username: 'admin_perfil_2' },
  });
  assert.equal(conflicto.status, 409, 'un usuario ya tomado debe rechazarse');

  // Con dos administradores activos, puede degradarse a sí mismo...
  const degradado = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { role: 'estudiante_mecanica' },
  });
  assert.equal(degradado.status, 200);
  assert.equal(degradado.body.role, 'estudiante_mecanica');

  // ...pero una vez estudiante, el reascenso pide la misma rama que le toca al
  // resto: se ignora, no se concede.
  const reascenso = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { role: 'administrador_mecanico' },
  });
  assert.equal(reascenso.status, 200);
  assert.equal(reascenso.body.role, 'estudiante_mecanica', 'un estudiante no se autoasciende');
});

test('25 | Mi perfil: el último administrador no puede degradarse solo', async () => {
  await limpiarUsuarios();
  await usuarioEnMongo({
    username: 'admin_solitario',
    password: 'clave-solo',
    role: 'administrador_mecanico',
    nombre: 'Solitario',
  });

  const cookie = (
    await api('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin_solitario', password: 'clave-solo' },
    })
  ).cookie;

  const degradado = await api('/api/auth/me', {
    method: 'PUT',
    cookie,
    body: { role: 'estudiante_mecanica' },
  });
  assert.equal(degradado.status, 400, 'no se puede degradar al último administrador');
  assert.match(degradado.body.error, /al menos un administrador/i);

  const sigue = await api('/api/auth/me', { cookie });
  assert.equal(sigue.body.role, 'administrador_mecanico');
});

// Este es el test que cierra FASE 7: hasta aqui las fallas del administrador
// llegaban al catalogo (test 18) pero NO intervenian en la inferencia. Se
// comprueba la ruta completa con el sintoma mas discriminating posible: la falla
// se crea por la API de Mongo, entra al motor, y un diagnostico real la
// devuelve con sus causas; luego se borra y deja de ofrecerse.
test('22 | FASE 7: la falla del administrador entra en la inferencia con sus causas y al borrarla sale', async () => {
  await usuarioEnMongo({
    username: 'admin_f7',
    password: 'clave-f7',
    role: 'administrador_mecanico',
    nombre: 'Admin F7',
  });
  const { cookie } = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin_f7', password: 'clave-f7' },
  });

  // Sintoma inventado a proposito: si no existiera en el catalogo estatico, su
  // aparicion en el diagnostico solo puede venir de la falla creada aqui. Son
  // DOS a proposito: la falla se afirma como conjuncion, y con un solo sintoma
  // de los dos no debe inferirse.
  const sintomas = ['ruido_met_al_ralentizar', 'vibracion_volante_arranque'];
  const causas = ['Banda de distribucion estirada', 'Escobillas del alternador tocando el soporte'];

  const creada = await api('/api/fallas', {
    method: 'POST',
    cookie,
    body: {
      ...FALLA_VALIDA,
      nombre: 'Ruido FASE 7',
      sintomas,
      causas,
      // Rango de dos anos: permite comprobar tanto que el año dentro infiere
      // como que uno fuera no.
      vehiculo: { marca: 'mazda', modelo: 'cx5', anio: 2018, anioDesde: 2017, anioHasta: 2019, transmision: 'automatica' },
    },
  });
  assert.equal(creada.status, 201, 'la falla debe crearse');
  // El identificador lo deriva el backend del nombre; no se adivina aqui porque
  // el diagnostico devuelve ese mismo id y una suposicion equivocada haria que el
  // test pasara sin comprobar nada (o fallara sin decir por que).
  const prologId = creada.body.prologId;
  assert.ok(prologId, 'la API debe devolver el prologId generado');

  // Sincronizacion asincrona a proposito: se sondea el diagnostico hasta que la
  // falla este afirmada en el motor. Preguntar por el resultado (y no por
  // /api/fallas) es a proposito tambien:asi se prueba que la falla infiere, no
  // solo que se catalogue.
  const diagnostica = async (vehiculo, sintomas) => {
    const resp = await prologDiagnostico({ ...vehiculo, sintomas });
    assert.equal(resp.status, 'success');
    return resp.fallas;
  };
  const infiere = async (vehiculo, sintomas) => {
    for (let i = 0; i < 20; i++) {
      const fallas = await diagnostica(vehiculo, sintomas);
      const hallada = fallas.find((f) => f.id === prologId);
      if (hallada) return hallada;
      await sleep(250);
    }
    return null;
  };

  const dentro = { marca: 'mazda', modelo: 'cx5', anio: 2018, transmision: 'desconocida' };
  const hallada = await infiere(dentro, sintomas);
  assert.ok(hallada, 'la falla del administrador debe aparecer en el diagnostico con sus dos sintomas');

  // Las causas llegan al resultado del diagnostico: sin esto el usuario de a pie
  // no ve para que sirve la falla que otro tecnico escribio.
  assert.deepEqual(hallada.causas, causas, 'las causas deben viajar al resultado del diagnostico');

  // Con solo UN sintoma de los dos no puede aparecer: la falla se afirma como
  // conjuncion, y una conjuncion con una premisa falsa no se cumple.
  const aMedias = await diagnostica(dentro, [sintomas[0]]);
  assert.ok(
    !aMedias.some((f) => f.id === prologId),
    'con un solo sintoma la falla no debe inferirse'
  );

  // El año FUERA del rango tampoco: acota por vehiculo, no solo por marca/modelo.
  const fueraDeRango = await diagnostica(
    { marca: 'mazda', modelo: 'cx5', anio: 2024, transmision: 'desconocida' },
    sintomas
  );
  assert.ok(
    !fueraDeRango.some((f) => f.id === prologId),
    'fuera del rango de años la falla no debe inferirse'
  );

  // Marca distinta tampoco. El año desconocido (0) si debe inferir: es lo
  // permisivo que se acordo, para no perder fallas por no saber el año.
  const otroModelo = await diagnostica(
    { marca: 'mazda', modelo: 'cx3', anio: 2018, transmision: 'desconocida' },
    sintomas
  );
  assert.ok(!otroModelo.some((f) => f.id === prologId), 'con otro modelo la falla no debe inferirse');

  const sinAnio = await diagnostica({ marca: 'mazda', modelo: 'cx5', anio: 0, transmision: 'desconocida' }, sintomas);
  assert.ok(
    sinAnio.some((f) => f.id === prologId),
    'con año desconocido la falla debe inferirse igualmente'
  );

  // Al borrar, la falla y su sintoma desaparecen del motor. Si el sintoma se
  // quedara, contaminaria los diagnosticos siguientes aunque la falla ya no
  // exista; si el sintoma esttico `sobrecalentamiento` desapareciera al
  // limpiar las dinamicas, la base estatica estaria rota.
  const borrada = await api(`/api/fallas/${creada.body._id}`, { method: 'DELETE', cookie });
  assert.equal(borrada.status, 200);

  let sigue = null;
  for (let i = 0; i < 20 && sigue !== false; i++) {
    const fallas = await diagnostica(dentro, [...sintomas, 'sobrecalentamiento']);
    sigue = fallas.some((f) => f.id === prologId) ? true : false;
    if (sigue === true) await sleep(250);
  }
  assert.equal(sigue, false, 'la falla borrada debe dejar de inferirse');

  const catalogo = await (await fetch(`http://localhost:${PUERTO_PROLOG}/api/sintomas`, { headers: CH_MOTOR })).json();
  const ids = (catalogo.sintomas || catalogo).map((s) => s.id || s.nombre);
  assert.ok(!ids.includes(sintomas[0]), 'el sintoma de la falla borrada no debe quedar en el catalogo');
  assert.ok(ids.includes('sobrecalentamiento'), 'limpiar las dinamicas no debe tocar la base estatica');
});

// ---------------------------------------------------------------------------
// 2.4 Observaciones del diagnostico
// ---------------------------------------------------------------------------

test('26 | API diagnósticos: las observaciones se recortan, se guardan y viajan al historial', async () => {
  const payload = {
    vehiculo: { marca: 'nissan', modelo: 'versa', anio: 2018 },
    sintomas: ['ruido_motor'],
    observaciones: '   Compresión baja en el cilindro 3.   ',
    fallas: [{ falla: 'aceite_motor_bajo', certeza: 0.55 }],
  };
  const res = await fetchApi('/api/diagnosticos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 201);
  const creado = await res.json();
  assert.equal(
    creado.observaciones,
    'Compresión baja en el cilindro 3.',
    'los espacios de los extremos se recortan antes de guardar'
  );

  const historial = await (await fetchApi('/api/diagnosticos')).json();
  const guardado = historial.find((d) => d._id === creado._id);
  assert.ok(guardado, 'el diagnóstico con observaciones debe aparecer en el historial');
  assert.equal(guardado.observaciones, 'Compresión baja en el cilindro 3.');
});

test('27 | API diagnósticos: las observaciones son opcionales, de texto y de máximo 500', async () => {
  const base = {
    vehiculo: { marca: 'nissan', modelo: 'versa', anio: 2018 },
    sintomas: ['ruido_motor'],
    fallas: [{ falla: 'aceite_motor_bajo', certeza: 0.55 }],
  };
  const enviar = (observaciones) =>
    fetchApi('/api/diagnosticos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, observaciones }),
    });

  // Sin observaciones el diagnóstico se guarda igual y queda en ''.
  const sinObs = await enviar(undefined);
  assert.equal(sinObs.status, 201);
  assert.equal((await sinObs.json()).observaciones, '');

  // Un valor que no es texto se rechaza en vez de stringificarse a "[object Object]".
  const noTexto = await enviar({ nota: 'x' });
  assert.equal(noTexto.status, 400, 'las observaciones no textuales deben rechazarse');

  // 500 exactos pasan; 501 se rechaza. El límite es del diagnóstico, no del catálogo.
  assert.equal((await enviar('a'.repeat(500))).status, 201);
  assert.equal((await enviar('a'.repeat(501))).status, 400);
});

// ---------------------------------------------------------------------------
// 2.1 Mutex del catálogo frente a diagnósticos
// ---------------------------------------------------------------------------

test('28 | Motor Prolog: mutex compartido — alta, bootstrap, baja y diagnóstico concurrentes no se traban ni dejan el catálogo roto', async () => {
  const base = `http://localhost:${PUERTO_PROLOG}`;
  const jsonToken = { 'Content-Type': 'application/json', ...CH_MOTOR };

  const crear = (id, sintoma) =>
    fetch(`${base}/api/fallas`, {
      method: 'POST',
      headers: jsonToken,
      body: JSON.stringify({
        nombre: `Falla ${id}`,
        prologId: id,
        sintomas: [sintoma],
        vehiculo: { marca: 'gen', modelo: 'gen', transmision: 'desconocida' },
        certezaBase: 0.75,
      }),
    });
  const diagnosticar = (sintoma) =>
    fetch(`${base}/api/diagnostico`, {
      method: 'POST',
      headers: jsonToken,
      body: JSON.stringify({ marca: 'gen', modelo: 'gen', anio: 0, sintomas: [sintoma] }),
    });
  const bootstrap = () =>
    fetch(`${base}/api/fallas/bootstrap`, {
      method: 'POST',
      headers: jsonToken,
      body: JSON.stringify({
        fallas: [
          {
            nombre: 'Falla mutex_a_e2e',
            prologId: 'mutex_a_e2e',
            sintomas: ['mutex_sintoma_e2e'],
            vehiculo: { marca: 'gen', modelo: 'gen', transmision: 'desconocida' },
          },
        ],
      }),
    });
  const borrar = (id) => fetch(`${base}/api/fallas?prologId=${id}`, { method: 'DELETE', headers: CH_MOTOR });

  const sintomaCompartido = 'mutex_sintoma_e2e';
  await crear('mutex_a_e2e', sintomaCompartido);
  await crear('mutex_b_e2e', sintomaCompartido);

  // El mutex es el mismo para diagnóstico y para toda mutación del catálogo
  // (alta, baja y bootstrap). Si alguno anidara el cerrojo, esta tormenta
  // dejaría el motor colgado y el test no terminaría; si el catálogo se
  // escribiera a mitad de una inferencia, saldría un 5xx. Ambas cosas son lo que
  // el mutex previene.
  //
  // Un DELETE puede perder la carrera contra otro DELETE o contra el bootstrap
  // que limpia las dinámicas, y eso es legítimo: 404 = ya no estaba.
  //
  // Diez rondas: la tormenta completa (60 operaciones concurrentes) repetida.
  // Con el pool HTTP fijo de 5 hilos esto saturaba el servidor (latencia en
  // escalones de 2 s / 4 s que hacia fallar por reinicio de conexion; ver
  // "Dimensionamiento del motor" en el README). Con http_dyn_workers y
  // keep_alive_timeout bajo, diez rondas pasan estables.
  const ACEPTADOS = new Set([200, 201, 404]);
  for (let ronda = 1; ronda <= 10; ronda++) {
    const operaciones = [];
    for (let i = 0; i < 6; i++) {
      operaciones.push(crear('mutex_a_e2e', sintomaCompartido));
      operaciones.push(borrar('mutex_a_e2e'));
      operaciones.push(bootstrap());
      operaciones.push(diagnosticar(sintomaCompartido));
      operaciones.push(crear('mutex_b_e2e', sintomaCompartido));
      operaciones.push(borrar('mutex_b_e2e'));
    }
    const resultados = await Promise.all(operaciones);
    for (const r of resultados) {
      assert.ok(
        ACEPTADOS.has(r.status),
        `ronda ${ronda}: una operación concurrente devolvió ${r.status}`
      );
    }
  }

  // Coherencia tras la tormenta: una falla nueva se crea, infiere y se borra. Si
  // el mutex hubiera quedado tomado o el catálogo a medias, esto fallaría.
  const sintomaFinal = 'mutex_sintoma_final_e2e';
  await crear('mutex_final_e2e', sintomaFinal);
  const conLaFalla = await (await diagnosticar(sintomaFinal)).json();
  assert.equal(conLaFalla.status, 'success');
  assert.ok(
    conLaFalla.fallas.some((f) => f.id === 'mutex_final_e2e'),
    'tras la concurrencia el catálogo debe seguir infiriendo con normalidad'
  );

  await borrar('mutex_final_e2e');
  const sinLaFalla = await (await diagnosticar(sintomaFinal)).json();
  assert.ok(
    !sinLaFalla.fallas.some((f) => f.id === 'mutex_final_e2e'),
    'tras la concurrencia el borrado debe seguir retirando la falla'
  );

  // Limpieza de las fallas del storm (comparten síntoma de usuario).
  await borrar('mutex_a_e2e');
  await borrar('mutex_b_e2e');
});

// ---------------------------------------------------------------------------
// 2.2 Gateway sobre varias réplicas
// ---------------------------------------------------------------------------

test('29 | Gateway multi-réplica: si una réplica cae, la otra atiende y /health cuenta las sanas', async () => {
  const puerto = PUERTO_API + 9;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puerto),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      // Una réplica viva y una muerta: el reparto debe caer sola a la viva.
      PROLOG_BASES: `http://localhost:${PUERTO_PROLOG},http://127.0.0.1:9`,
      PROLOG_TIMEOUT_MS: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-multi.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-multi.err'), 'w') }));

  try {
    await sondeo(`http://localhost:${puerto}/api/config/tipo-cambio`, { timeout: 30000 });
    const cookie = await sesionGateway();
    const base = `http://localhost:${puerto}`;

    // La réplica muerta quedó desactualizada al arrancar (su sonda falló) y se
    // salta: las dos lecturas las atiende la viva, sin caer a la muerta.
    for (let i = 0; i < 2; i++) {
      const res = await peticionGateway(base, '/api/prolog/api/sintomas', { cookie });
      assert.equal(res.status, 200, `la lectura ${i + 1} debe atenderse desde la réplica viva`);
      const cuerpo = await res.json();
      assert.ok(Array.isArray(cuerpo.sintomas), 'la respuesta viene del motor, no del gateway');
    }

    const salud = await (await fetch(`${base}/health`)).json();
    assert.equal(salud.motores.total, 2, '/health publica el total de réplicas');
    assert.equal(salud.motores.sanos, 1, 'la réplica muerta sale del conteo de sanas');
    assert.doesNotMatch(
      JSON.stringify(salud),
      /127\.0\.0\.1:9/,
      'los destinos de las réplicas no se publican'
    );
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

// ---------------------------------------------------------------------------
// 2.3 Catálogo difundido a todas las réplicas
// ---------------------------------------------------------------------------

test('30 | Catálogo multi-réplica: alta y baja se difunden a todas las réplicas del motor', async () => {
  const puertoMotor2 = PUERTO_PROLOG + 1;
  const puertoApi2 = PUERTO_API + 10;

  const motor2 = spawn(
    SWIPL,
    ['-q', '-f', PL_FILE, '-g', `server(${puertoMotor2}), sleep(3600)`, '-t', 'halt'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOTOR_TOKEN: MOTOR_TOKEN_E2E } }
  );
  motor2.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('prolog2.out'), 'w') }));
  motor2.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('prolog2.err'), 'w') }));

  const api2 = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoApi2),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      PROLOG_BASES: `http://localhost:${PUERTO_PROLOG},http://localhost:${puertoMotor2}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api2.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-dos-motores.out'), 'w') }));
  api2.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-dos-motores.err'), 'w') }));

  const infiere = async (puertoMotor, id) => {
    const res = await fetch(`http://localhost:${puertoMotor}/api/diagnostico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CH_MOTOR },
      body: JSON.stringify({ marca: 'gen', modelo: 'gen', anio: 0, sintomas: ['difusion_sintoma_e2e'] }),
    });
    const data = await res.json();
    return (data.fallas || []).some((f) => f.id === id);
  };
  const esperar = async (puertoMotor, id, presente) => {
    for (let i = 0; i < 20; i++) {
      if ((await infiere(puertoMotor, id)) === presente) return true;
      await sleep(250);
    }
    return false;
  };

  try {
    await sondeo(`http://localhost:${puertoMotor2}/api/sintomas`, { timeout: 60000, headers: CH_MOTOR });
    await sondeo(`http://localhost:${puertoApi2}/api/config/tipo-cambio`, { timeout: 60000 });
    const base2 = `http://localhost:${puertoApi2}`;

    // La sesión vive en Mongo: la misma cookie de la API principal vale aquí.
    const cookie = await sesionGateway();

    const creada = await peticionGateway(base2, '/api/fallas', {
      method: 'POST',
      cookie,
      body: {
        nombre: 'Difusion e2e',
        sintomas: ['difusion_sintoma_e2e'],
        vehiculo: { marca: 'gen', modelo: 'gen', transmision: 'desconocida' },
        causas: ['causa de difusion'],
        procedimiento: ['paso de difusion'],
        precioMin: 100,
        precioMax: 200,
        urgencia: 'media',
        confianzaDato: 'media',
      },
    });
    assert.equal(creada.status, 201, 'la API de 2 réplicas debe crear la falla');
    const doc = await creada.json();

    // La difusión es asíncrona (la API responde sin esperar al motor): se sondea
    // cada réplica hasta que la falla aparece en las DOS.
    assert.ok(await esperar(PUERTO_PROLOG, 'difusion_e2e', true), 'la réplica 1 debe recibir la falla');
    assert.ok(await esperar(puertoMotor2, 'difusion_e2e', true), 'la réplica 2 debe recibir la falla');

    const borrada = await peticionGateway(base2, `/api/fallas/${doc._id}`, { method: 'DELETE', cookie });
    assert.equal(borrada.status, 200);

    assert.ok(await esperar(PUERTO_PROLOG, 'difusion_e2e', false), 'la réplica 1 debe retirarla');
    assert.ok(await esperar(puertoMotor2, 'difusion_e2e', false), 'la réplica 2 debe retirarla');
  } finally {
    if (api2.pid) matarArbol(api2.pid);
    if (motor2.pid) matarArbol(motor2.pid);
  }
});

// ---------------------------------------------------------------------------
// 2.5 Interruptor de límites para pruebas de carga
// ---------------------------------------------------------------------------

test('31 | 2.5 | DESACTIVAR_LIMITES apaga los límites solo en local, nunca en producción', async () => {
  const arrancarApi = async (puerto, extra) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        PORT: String(puerto),
        MONGO_URI: TEST_DB,
        MOTOR_TOKEN: MOTOR_TOKEN_E2E,
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath(`api-limites-${puerto}.out`), 'w') }));
    proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath(`api-limites-${puerto}.err`), 'w') }));
    await sondeo(`http://localhost:${puerto}/health`, { timeout: 30000 });
    return proc;
  };

  // En local el interruptor deja pasar más allá del cupo (que aquí es 2).
  let proc = await arrancarApi(PUERTO_API + 13, { RATE_LIMIT_MAX: '2', DESACTIVAR_LIMITES: '1' });
  try {
    const ruta = `http://localhost:${PUERTO_API + 13}/api/config/tipo-cambio`;
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        (await fetch(ruta)).status,
        200,
        `con DESACTIVAR_LIMITES la petición ${i + 1} debe pasar`
      );
    }
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }

  // En producción la variable se ignora: el cupo vuelve a cortar.
  proc = await arrancarApi(PUERTO_API + 14, {
    RATE_LIMIT_MAX: '2',
    DESACTIVAR_LIMITES: '1',
    NODE_ENV: 'production',
    SESSION_SECRET: 'secreto-sesion-limites-e2e',
  });
  try {
    const ruta = `http://localhost:${PUERTO_API + 14}/api/config/tipo-cambio`;
    assert.equal((await fetch(ruta)).status, 200);
    assert.equal((await fetch(ruta)).status, 200);
    assert.equal(
      (await fetch(ruta)).status,
      429,
      'en producción el interruptor no debe apagar el limitador'
    );
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

// ---------------------------------------------------------------------------
// 2.3 Recuperación: una réplica que arrancó tarde se recarga entera al aparecer
// ---------------------------------------------------------------------------

test('32 | Catálogo multi-réplica: una réplica que arranca tarde se recarga entero al aparecer', async () => {
  // La API arranca ANTES que la segunda réplica, así que su bootstrap no la
  // alcanza y queda marcada desactualizada. Es justo el caso de una réplica que
  // se cae, recibe cambios mientras tanto y vuelve: al responder, debe recargar
  // el catálogo COMPLETO (no solo el último cambio difundido).
  const puertoMotor3 = PUERTO_PROLOG + 2;
  const puertoApi3 = PUERTO_API + 15;

  const api3 = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoApi3),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      PROLOG_BASES: `http://localhost:${PUERTO_PROLOG},http://localhost:${puertoMotor3}`,
      PROLOG_REPLICA_COOLDOWN_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api3.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-recarga.out'), 'w') }));
  api3.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-recarga.err'), 'w') }));

  let motor3 = null;
  const infiere = async (puertoMotor, id, sintoma) => {
    const res = await fetch(`http://localhost:${puertoMotor}/api/diagnostico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CH_MOTOR },
      body: JSON.stringify({ marca: 'gen', modelo: 'gen', anio: 0, sintomas: [sintoma] }),
    });
    const data = await res.json();
    return (data.fallas || []).some((f) => f.id === id);
  };
  const esperar = async (puertoMotor, id, sintoma, presente) => {
    for (let i = 0; i < 24; i++) {
      if ((await infiere(puertoMotor, id, sintoma)) === presente) return true;
      await sleep(250);
    }
    return false;
  };

  try {
    await sondeo(`http://localhost:${puertoApi3}/api/config/tipo-cambio`, { timeout: 60000 });
    const base3 = `http://localhost:${puertoApi3}`;
    const cookie = await sesionGateway();

    const crear = (nombre, sintoma) =>
      peticionGateway(base3, '/api/fallas', {
        method: 'POST',
        cookie,
        body: {
          nombre,
          sintomas: [sintoma],
          vehiculo: { marca: 'gen', modelo: 'gen', transmision: 'desconocida' },
          causas: ['causa de recarga'],
          procedimiento: ['paso de recarga'],
          precioMin: 100,
          precioMax: 200,
          urgencia: 'media',
          confianzaDato: 'media',
        },
      });

    // Falla A: se crea con la segunda réplica AÚN caída. La difusión no la alcanza
    // (solo llega a la réplica 1) y deja a la 2 marcada desactualizada.
    const resA = await crear('Recarga A', 'recarga_sintoma_a_e2e');
    assert.equal(resA.status, 201, 'la API debe crear A con una réplica caída');
    const docA = await resA.json();

    // Ahora sí arranca la segunda réplica: motor recién levantado, sin las fallas
    // dinámicas de Mongo.
    motor3 = spawn(
      SWIPL,
      ['-q', '-f', PL_FILE, '-g', `server(${puertoMotor3}), sleep(3600)`, '-t', 'halt'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOTOR_TOKEN: MOTOR_TOKEN_E2E } }
    );
    motor3.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('prolog3.out'), 'w') }));
    motor3.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('prolog3.err'), 'w') }));
    await sondeo(`http://localhost:${puertoMotor3}/api/sintomas`, { timeout: 60000, headers: CH_MOTOR });
    assert.equal(
      await infiere(puertoMotor3, 'recarga_a', 'recarga_sintoma_a_e2e'),
      false,
      'la réplica recién arrancada todavía no conoce la falla A'
    );

    // Falla B: su difusión SÍ alcanza a la segunda réplica y, al responder, ésta
    // dispara la recarga del catálogo completo (A incluida, que nunca se le pudo
    // difundir).
    const resB = await crear('Recarga B', 'recarga_sintoma_b_e2e');
    assert.equal(resB.status, 201, 'la API debe crear B');
    const docB = await resB.json();

    assert.ok(
      await esperar(puertoMotor3, 'recarga_a', 'recarga_sintoma_a_e2e', true),
      'la recarga debe traer la falla A (anterior a la recuperación)'
    );
    assert.ok(
      await esperar(puertoMotor3, 'recarga_b', 'recarga_sintoma_b_e2e', true),
      'la recarga debe traer la falla B (la que disparó la recuperación)'
    );

    // Limpieza: se borran de Mongo y la baja se difunde a las réplicas.
    await peticionGateway(base3, `/api/fallas/${docA._id}`, { method: 'DELETE', cookie });
    await peticionGateway(base3, `/api/fallas/${docB._id}`, { method: 'DELETE', cookie });
  } finally {
    if (api3.pid) matarArbol(api3.pid);
    if (motor3 && motor3.pid) matarArbol(motor3.pid);
  }
});

// ---------------------------------------------------------------------------
// 2.6 Semilla de datos
// ---------------------------------------------------------------------------

test('33 | API diagnostico: origen (usuario por defecto, semilla explicito, otro rechazado)', async () => {
  const base = {
    vehiculo: { marca: 'gen', modelo: 'gen', anio: 0 },
    sintomas: ['chirrido_al_frenar'],
    fallas: [{ falla: 'pastillas_freno', certeza: 0.72 }],
  };
  const crear = (cuerpo) =>
    fetchApi('/api/diagnosticos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

  // Sin origen es un diagnostico de usuario: es lo que manda la app.
  const sinOrigen = await crear(base);
  assert.equal(sinOrigen.status, 201);
  assert.equal((await sinOrigen.json()).origen, 'usuario');

  // 'semilla' se conserva tal cual.
  const conSemilla = await crear({ ...base, origen: 'semilla' });
  assert.equal(conSemilla.status, 201);
  assert.equal((await conSemilla.json()).origen, 'semilla');

  // Un origen desconocido se rechaza sin filtrar el error interno.
  const invalido = await crear({ ...base, origen: 'otro' });
  assert.equal(invalido.status, 400);
  const cuerpo = await invalido.json();
  assert.ok(cuerpo.error, 'el rechazo debe traer un mensaje');
  assert.ok(!/cast|mongoose|stack|validation/i.test(cuerpo.error), 'no debe filtrar el error interno');
});

test('34 | 2.6 | La semilla guarda la certeza del motor y se niega a sembrar en remoto sin --url', async () => {
  const puertoApiSeed = PUERTO_API + 16;
  const seedPath = path.join(ROOT, 'scripts', 'seed-diagnosticos.mjs');

  // Instancia propia de la API: la suite ya gasto peticiones del cupo de la
  // principal, y la semilla hace decenas. Misma base y mismo motor.
  const apiSeed = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(puertoApiSeed), MONGO_URI: TEST_DB, MOTOR_TOKEN: MOTOR_TOKEN_E2E },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiSeed.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-semilla.out'), 'w') }));
  apiSeed.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-semilla.err'), 'w') }));

  try {
    await sondeo(`http://localhost:${puertoApiSeed}/api/config/tipo-cambio`, { timeout: 60000 });
    const baseSeed = `http://localhost:${puertoApiSeed}`;

    // Las pruebas del último administrador vacian la coleccion de usuarios, y la
    // cookie cacheada de la suite sobrevive porque la sesion vive en Mongo. La
    // semilla, en cambio, vuelve a iniciar sesion: la cuenta tiene que existir.
    await usuarioEnMongo({ ...CUENTA_API, role: 'estudiante_mecanica', nombre: 'API E2E' });
    const cookie = await cookieDeApiE2E();

    const correr = (args, extra = {}) =>
      spawnSync(process.execPath, [seedPath, ...args], {
        cwd: ROOT,
        env: { ...process.env, SEED_USER: CUENTA_API.username, SEED_PASS: CUENTA_API.password, ...extra },
        encoding: 'utf8',
        timeout: 120000,
      });

    // Guard: un host remoto sin --url se rechaza antes de tocar la red.
    const negado = correr(['--cantidad', '1'], { SEED_API_URL: 'https://ejemplo-remoto.invalid' });
    assert.notEqual(negado.status, 0, 'sin --url no debe sembrar en un host remoto');
    assert.match(`${negado.stdout}${negado.stderr}`, /flag explicito/);

    // Siembra real contra local.
    const corrida = correr(['--url', baseSeed, '--cantidad', '6']);
    assert.equal(corrida.status, 0, `la semilla debe salir 0. stderr: ${corrida.stderr}`);
    assert.match(corrida.stdout, /Semilla completada/);

    const historial = await (
      await fetch(`${baseSeed}/api/diagnosticos`, { headers: { Cookie: cookie } })
    ).json();
    const semilla = historial.filter((d) => d.origen === 'semilla');
    assert.ok(semilla.length >= 6, `deben quedar los diagnosticos semilla (hay ${semilla.length})`);

    // El lote alterna bandas para cubrir alta/media/baja.
    const banda = (c) => (c >= 0.85 ? 'ALTA' : c >= 0.6 ? 'MEDIA' : 'BAJA');
    const bandas = new Set(semilla.map((d) => banda(Math.max(...d.fallas.map((f) => f.certeza)))));
    assert.deepEqual([...bandas].sort(), ['ALTA', 'BAJA', 'MEDIA'], 'debe cubrir las tres bandas');

    // La certeza guardada es la del MOTOR: se reconsulta con los mismos datos y
    // tiene que coincidir falla por falla. Esto es lo que separa "sembrar" de
    // "inventar": la semilla no fabrica certezas.
    for (const d of semilla) {
      const v = d.vehiculo;
      const res = await fetch(`${baseSeed}/api/prolog/api/diagnostico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          marca: v.marca,
          modelo: v.modelo,
          anio: v.anio,
          transmision: v.transmision,
          sintomas: d.sintomas,
        }),
      });
      assert.equal(res.status, 200, 'el gateway debe responder a la reconsulta');
      const fallas = (await res.json()).fallas || [];
      assert.deepEqual(
        d.fallas.map((f) => `${f.falla}:${f.certeza}`).sort(),
        fallas.map((f) => `${f.id}:${f.certeza}`).sort(),
        `la certeza guardada debe ser la del motor para ${JSON.stringify(d.sintomas)}`
      );
    }
  } finally {
    if (apiSeed.pid) matarArbol(apiSeed.pid);
  }
});

// ---------------------------------------------------------------------------
// 2.2 Estado del clúster de motores: solo administrador y sin destinos
// ---------------------------------------------------------------------------

test('35 | API: el estado de las réplicas es solo para el administrador y no expone destinos', async () => {
  // Una réplica viva (el motor de la suite) y otra muerta: así la respuesta trae
  // dos alias y al menos un estado distinto de "sana".
  const puerto = PUERTO_API + 17;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puerto),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      PROLOG_BASES: `http://localhost:${PUERTO_PROLOG},http://127.0.0.1:9`,
      PROLOG_TIMEOUT_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-replicas.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-replicas.err'), 'w') }));

  try {
    const base = `http://localhost:${puerto}`;
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    const ruta = `${base}/api/admin/replicas`;

    // Sin sesión: 401.
    assert.equal((await fetch(ruta)).status, 401, 'sin sesión el estado del clúster debe ser 401');

    // Estudiante: 403. La suite vacía usuarios en pruebas anteriores, así que se
    // recrea la cuenta y se inicia sesión de nuevo en vez de confiar en la cookie.
    await usuarioEnMongo({ ...CUENTA_API, role: 'estudiante_mecanica', nombre: 'API E2E' });
    const ingresoEst = await api('/api/auth/login', { method: 'POST', body: CUENTA_API });
    assert.equal(ingresoEst.status, 200, 'la cuenta estudiante debe poder iniciar sesión');
    assert.equal(
      (await fetch(ruta, { headers: { Cookie: ingresoEst.cookie } })).status,
      403,
      'un estudiante no debe ver el estado del clúster'
    );

    // Administrador: 200 con una entrada por réplica.
    const cookieAdmin = await sesionGateway();
    // La réplica muerta (127.0.0.1:9) falla su sonda de arranque y queda
    // desactualizada; el reparto la salta y atiende la viva.
    for (let i = 0; i < 2; i++) {
      await peticionGateway(base, '/api/prolog/api/sintomas', { cookie: cookieAdmin });
    }

    const res = await fetch(ruta, { headers: { Cookie: cookieAdmin } });
    assert.equal(res.status, 200, 'el administrador debe ver el estado del clúster');
    const { replicas } = await res.json();
    assert.equal(replicas.length, 2, 'una entrada por réplica');
    assert.deepEqual(
      replicas.map((r) => r.alias),
      ['motor-1', 'motor-2'],
      'el alias debe ser estable y por posición, no el destino'
    );

    const ESTADOS = new Set(['sana', 'caida', 'desactualizada', 'resincronizando']);
    for (const r of replicas) {
      assert.ok(ESTADOS.has(r.estado), `estado desconocido: ${r.estado}`);
      assert.ok(
        r.actualizadoEn === null || !Number.isNaN(Date.parse(r.actualizadoEn)),
        'actualizadoEn debe ser null o una marca ISO válida'
      );
    }
    assert.ok(replicas.some((r) => r.estado === 'sana'), 'la réplica viva debe salir sana');
    assert.ok(
      replicas.some((r) => r.estado !== 'sana'),
      'la réplica muerta no debe salir sana'
    );

    // Nunca los destinos.
    const texto = JSON.stringify(replicas);
    assert.doesNotMatch(texto, /127\.0\.0\.1:9/, 'no debe filtrarse la IP muerta');
    assert.doesNotMatch(texto, /localhost:\d+/, 'no debe filtrarse ningún destino');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
  }
});

// ---------------------------------------------------------------------------
// 2.3 Una réplica desactualizada no atiende hasta recargarse
// ---------------------------------------------------------------------------

test('36 | Catálogo multi-réplica: una réplica desactualizada vuelve a sanar sola, sin mutación', async () => {
  // Réplica falsa (HTTP server de bolsillo): responde a /health pero sus
  // /api/fallas/bootstrap fallan al inicio, lo que la deja desactualizada. Así se
  // comprueba que, mientras no está sana, el reparto NO le manda diagnósticos y
  // que, al volver a responder, se recarga SOLA (sin mutación del catálogo): la
  // detecta el sondeo de /health de revisarReplicas().
  const puertoFalsa = PUERTO_PROLOG + 3;
  const puertoApi = PUERTO_API + 18;
  let bootstrapOk = false;
  const hits = { diagnostico: 0, bootstrap: 0 };
  const falsa = crearServidorHttp((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok');
      }
      if (req.url.startsWith('/api/fallas/bootstrap')) {
        hits.bootstrap += 1;
        res.writeHead(bootstrapOk ? 200 : 503, { 'Content-Type': 'application/json' });
        return res.end(bootstrapOk ? '{"ok":true}' : '{"error":"sin catalogo"}');
      }
      if (req.url.startsWith('/api/diagnostico')) {
        hits.diagnostico += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"fallas":[]}');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    });
  });
  await new Promise((r) => falsa.listen(puertoFalsa, r));

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoApi),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      PROLOG_BASES: `http://localhost:${PUERTO_PROLOG},http://localhost:${puertoFalsa}`,
      PROLOG_TIMEOUT_MS: '500',
      // Ventana amplia a proposito: mas abajo se comprueba que tres consultas
      // seguidas del panel caben dentro de un solo intento de recarga.
      PROLOG_RESYNC_MIN_INTERVAL_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-desactualizada.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-desactualizada.err'), 'w') }));

  let cookie = null;
  try {
    const base = `http://localhost:${puertoApi}`;
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    cookie = await sesionGateway();

    // La réplica falsa queda desactualizada: su bootstrap devuelve 503.
    let estadoFalsa = null;
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${base}/api/admin/replicas`, { headers: { Cookie: cookie } });
      const datos = await r.json();
      estadoFalsa = datos.replicas.find((x) => x.alias === 'motor-2')?.estado;
      if (estadoFalsa === 'desactualizada') break;
      await sleep(250);
    }
    assert.equal(estadoFalsa, 'desactualizada', 'la réplica que no pudo recargarse debe salir desactualizada');

    // Mientras está desactualizada, el reparto no le manda diagnósticos.
    for (let i = 0; i < 6; i++) {
      const res = await peticionGateway(base, '/api/prolog/api/diagnostico', {
        method: 'POST',
        cookie,
        body: { marca: 'gen', modelo: 'gen', anio: 0, sintomas: [] },
      });
      assert.equal(res.status, 200, 'la réplica sana debe atender');
    }
    assert.equal(hits.diagnostico, 0, 'la réplica desactualizada no debe recibir diagnósticos');

    // Consultar el panel no relanza el bootstrap en cada refresco: lo impiden el
    // flag `resincronizando` (una recarga a la vez) y el mínimo entre intentos. Tres
    // consultas seguidas dentro de la ventana generan como mucho un intento.
    const antesBootstrap = hits.bootstrap;
    await sleep(2300); // abre la ventana del mínimo
    await fetch(`${base}/api/admin/replicas`, { headers: { Cookie: cookie } });
    for (let i = 0; i < 40 && hits.bootstrap === antesBootstrap; i++) await sleep(50);
    assert.equal(hits.bootstrap, antesBootstrap + 1, 'la primera consulta dispara un intento');
    await sleep(200); // deja caer `resincronizando`: sólo queda el mínimo
    await fetch(`${base}/api/admin/replicas`, { headers: { Cookie: cookie } });
    await fetch(`${base}/api/admin/replicas`, { headers: { Cookie: cookie } });
    assert.equal(
      hits.bootstrap,
      antesBootstrap + 1,
      'el mínimo entre intentos impide relanzar el bootstrap en consultas seguidas'
    );

    // Se habilita el bootstrap. SIN tocar el catálogo: el sondeo de /health que
    // dispara /api/admin/replicas (revisarReplicas) la detecta viva
    // y lanza su recarga; la recuperación no depende de que llegue una mutación.
    bootstrapOk = true;
    let estadoFinal = null;
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${base}/api/admin/replicas`, { headers: { Cookie: cookie } });
      const datos = await r.json();
      estadoFinal = datos.replicas.find((x) => x.alias === 'motor-2')?.estado;
      if (estadoFinal === 'sana') break;
      await sleep(250);
    }
    assert.equal(estadoFinal, 'sana', 'sin mutación del catálogo la réplica debe volver a sanar sola');

    // Una vez recargada, vuelve a recibir diagnósticos (round-robin).
    const antes = hits.diagnostico;
    for (let i = 0; i < 12 && hits.diagnostico === antes; i++) {
      await peticionGateway(base, '/api/prolog/api/diagnostico', {
        method: 'POST',
        cookie,
        body: { marca: 'gen', modelo: 'gen', anio: 0, sintomas: [] },
      });
    }
    assert.ok(hits.diagnostico > antes, 'la réplica ya recargada vuelve a recibir diagnósticos');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    await new Promise((r) => falsa.close(r));
  }
});

// ---------------------------------------------------------------------------
// 2.3c Reinicio silencioso: el gateway lo detecta por el identificador de arranque
//      que el motor publica en /health, aunque ninguna petición haya fallado, y
//      recarga la réplica solo.
// ---------------------------------------------------------------------------

// Réplica de bolsillo para estas pruebas: publica en /health el identificador de
// arranque y el número de fallas que la prueba controle, "carga" el catálogo que
// recibe en el bootstrap, y puede simular una caída (deja de responder del todo) o
// un único timeout en un diagnóstico.
function replicaDeBolsillo() {
  const est = { startupId: 1, count: 0, alive: true, bootstrapOk: true, colgarDiagnostico: false };
  const hits = { bootstrap: 0, diagnostico: 0, colgado: 0 };
  const server = crearServidorHttp((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => { cuerpo += d; });
    req.on('end', () => {
      if (!est.alive) return; // caída: ni siquiera contesta /health
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', startupId: est.startupId, userFailuresCount: est.count }));
      }
      if (req.url.startsWith('/api/fallas/bootstrap')) {
        hits.bootstrap += 1;
        if (!est.bootstrapOk) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end('{"error":"sin catalogo"}');
        }
        try { est.count = (JSON.parse(cuerpo || '{}').fallas || []).length; } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'success', count: est.count }));
      }
      if (req.url.startsWith('/api/diagnostico')) {
        if (est.colgarDiagnostico) { est.colgarDiagnostico = false; hits.colgado += 1; return; }
        hits.diagnostico += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"fallas":[]}');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    });
  });
  return { est, hits, server };
}

// Estado que el panel asigna a una réplica, sondeando /health en vivo.
async function estadoDeReplica(base, cookie, alias) {
  const r = await fetch(`${base}/api/admin/replicas`, { headers: { Cookie: cookie } });
  return (await r.json()).replicas.find((x) => x.alias === alias)?.estado;
}

// Arranca una API con la réplica de bolsillo como motor-2, con ventanas cortas para
// que las pruebas no tarden.
function arrancarGatewayDeBolsillo(puertoApi, puertoFalsa, extra = {}) {
  return spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoApi),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      PROLOG_BASES: `http://localhost:${PUERTO_PROLOG},http://localhost:${puertoFalsa}`,
      PROLOG_TIMEOUT_MS: '500',
      PROLOG_RESYNC_MIN_INTERVAL_MS: '500',
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const DIAG_VACIO = { marca: 'gen', modelo: 'gen', anio: 0, sintomas: [] };

test('36a | Reinicio silencioso: cae y vuelve con otro arranque y catálogo vacío → se recarga sola', async () => {
  const puertoFalsa = PUERTO_PROLOG + 7;
  const puertoApi = PUERTO_API + 22;
  const { est, hits, server } = replicaDeBolsillo();
  await new Promise((r) => server.listen(puertoFalsa, r));

  const base = `http://localhost:${puertoApi}`;
  const cookie = await sesionGateway();
  // Catálogo no vacío: así el reinicio en vacío se nota en el conteo además de en el
  // identificador de arranque. La falla se crea ANTES de arrancar el gateway para
  // que su bootstrap de arranque la cargue en la réplica de bolsillo.
  const creada = await gateway('/api/fallas', {
    method: 'POST',
    cookie,
    body: {
      nombre: 'Reinicio A', sintomas: ['reinicio_a_e2e'],
      vehiculo: { marca: 'gen', modelo: 'gen', transmision: 'desconocida' },
      causas: ['causa reinicio'], procedimiento: ['paso reinicio'],
      precioMin: 100, precioMax: 200, urgencia: 'media', confianzaDato: 'media',
    },
  });
  assert.equal(creada.status, 201, 'la falla de contexto debe crearse');
  const fallaId = (await creada.json())._id;

  const proc = arrancarGatewayDeBolsillo(puertoApi, puertoFalsa, { PROLOG_REPLICA_COOLDOWN_MS: '1500' });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-reinicio-a.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-reinicio-a.err'), 'w') }));

  try {
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });

    // Arranca con la falla cargada en la réplica de bolsillo.
    for (let i = 0; i < 50 && est.count < 1; i++) await sleep(100);
    assert.ok(est.count >= 1, 'el bootstrap de arranque debe haber cargado la falla en la réplica');
    const antes = hits.bootstrap;

    // La réplica muere del todo. El gateway lo nota con una consulta y la deja en
    // cooldown (ninguna petición de la réplica responde).
    est.alive = false;
    for (let i = 0; i < 6; i++) {
      await peticionGateway(base, '/api/prolog/api/diagnostico', { method: 'POST', cookie, body: DIAG_VACIO });
    }
    assert.equal(await estadoDeReplica(base, cookie, 'motor-2'), 'caida', 'la réplica muerta debe salir del reparto');

    // Vuelve, pero es un proceso nuevo con el catálogo vacío: otro identificador y
    // cero fallas. Para el gateway no falló ninguna petición: solo cambió /health.
    est.alive = true;
    est.startupId = 2;
    est.count = 0;

    // Sin mutación del catálogo, el sondeo de /health descubre el reinicio y recarga.
    let estadoFinal = null;
    for (let i = 0; i < 60; i++) {
      estadoFinal = await estadoDeReplica(base, cookie, 'motor-2');
      if (estadoFinal === 'sana' && hits.bootstrap > antes) break;
      await sleep(200);
    }
    assert.equal(estadoFinal, 'sana', 'la réplica reiniciada debe recargarse y volver a sanar');
    assert.ok(hits.bootstrap > antes, 'la recarga de la réplica reiniciada debe haber corrido');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await gateway(`/api/fallas/${fallaId}`, { method: 'DELETE', cookie });
  }
});

test('36b | Reinicio silencioso: se reinicia entre dos consultas sin fallar ninguna → se detecta y recarga', async () => {
  const puertoFalsa = PUERTO_PROLOG + 8;
  const puertoApi = PUERTO_API + 23;
  const { est, hits, server } = replicaDeBolsillo();
  await new Promise((r) => server.listen(puertoFalsa, r));

  const base = `http://localhost:${puertoApi}`;
  const proc = arrancarGatewayDeBolsillo(puertoApi, puertoFalsa);
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-reinicio-b.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-reinicio-b.err'), 'w') }));

  try {
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    const cookie = await sesionGateway();
    for (let i = 0; i < 50 && hits.bootstrap < 1; i++) await sleep(100);
    const antes = hits.bootstrap;

    // Dos consultas normales. Entre ellas la réplica se reinicia (proceso nuevo,
    // catálogo vacío) pero NUNCA deja de responder: ninguna petición falla.
    const q1 = await peticionGateway(base, '/api/prolog/api/diagnostico', { method: 'POST', cookie, body: DIAG_VACIO });
    assert.equal(q1.status, 200, 'la primera consulta debe responder 200');
    est.startupId = 2;
    est.count = 0;
    await sleep(700); // deja vencer el mínimo entre sondeos para que la próxima consulta sondee
    const q2 = await peticionGateway(base, '/api/prolog/api/diagnostico', { method: 'POST', cookie, body: DIAG_VACIO });
    assert.equal(q2.status, 200, 'la segunda consulta debe responder 200');

    // La detección no depende de un fallo: el startupId que publica /health ya no
    // coincide y el sondeo que dispara la propia consulta la manda a recargar.
    let estadoFinal = null;
    for (let i = 0; i < 60; i++) {
      estadoFinal = await estadoDeReplica(base, cookie, 'motor-2');
      if (estadoFinal === 'sana' && hits.bootstrap > antes) break;
      await sleep(200);
    }
    assert.ok(hits.bootstrap > antes, 'la recarga debe dispararse sin que ninguna consulta fallara');
    assert.equal(estadoFinal, 'sana', 'tras recargar debe volver a sanar');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('36c | Timeout puntual con el mismo arranque: no recarga la réplica', async () => {
  const puertoFalsa = PUERTO_PROLOG + 9;
  const puertoApi = PUERTO_API + 24;
  const { est, hits, server } = replicaDeBolsillo();
  await new Promise((r) => server.listen(puertoFalsa, r));

  const base = `http://localhost:${puertoApi}`;
  const proc = arrancarGatewayDeBolsillo(puertoApi, puertoFalsa, { PROLOG_REPLICA_COOLDOWN_MS: '1000' });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-reinicio-c.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-reinicio-c.err'), 'w') }));

  try {
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    const cookie = await sesionGateway();
    for (let i = 0; i < 50 && hits.bootstrap < 1; i++) await sleep(100);
    const antes = hits.bootstrap;

    // Un único corte: la réplica recibe un diagnóstico y no contesta (timeout). El
    // gateway la deja en cooldown, pero su identificador NO cambia: es la misma
    // réplica, solo tuvo un mal momento.
    est.colgarDiagnostico = true;
    for (let i = 0; i < 10 && hits.colgado === 0; i++) {
      await peticionGateway(base, '/api/prolog/api/diagnostico', { method: 'POST', cookie, body: DIAG_VACIO });
    }
    assert.equal(hits.colgado, 1, 'el gateway debe haber sufrido el timeout al intentar la réplica');

    // Al vencer el cooldown, la sonda la ve viva con el MISMO arranque y el mismo
    // catálogo: no hay nada que recargar. Se fuerza tráfico y panel un rato.
    await sleep(1500);
    for (let i = 0; i < 10; i++) {
      await peticionGateway(base, '/api/prolog/api/diagnostico', { method: 'POST', cookie, body: DIAG_VACIO });
      await sleep(150);
    }
    assert.equal(await estadoDeReplica(base, cookie, 'motor-2'), 'sana', 'la réplica debe seguir sana');
    assert.equal(hits.bootstrap, antes, 'un timeout con el mismo arranque no debe recargar la réplica');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('36d | Invariante: una réplica que se reinicia en silencio no sirve ni un diagnóstico', async () => {
  const puertoFalsa = PUERTO_PROLOG + 10;
  const puertoApi = PUERTO_API + 25;
  const { est, hits, server } = replicaDeBolsillo();
  await new Promise((r) => server.listen(puertoFalsa, r));

  const base = `http://localhost:${puertoApi}`;
  const cookie = await sesionGateway();
  // Catálogo no vacío antes de arrancar el gateway: así la réplica de bolsillo
  // arranca SANA y sirviendo, y su reinicio en vacío se nota en el conteo.
  const creada = await gateway('/api/fallas', {
    method: 'POST',
    cookie,
    body: {
      nombre: 'Invariante', sintomas: ['invariante_e2e'],
      vehiculo: { marca: 'gen', modelo: 'gen', transmision: 'desconocida' },
      causas: ['causa invariante'], procedimiento: ['paso invariante'],
      precioMin: 100, precioMax: 200, urgencia: 'media', confianzaDato: 'media',
    },
  });
  assert.equal(creada.status, 201, 'la falla de contexto debe crearse');
  const fallaId = (await creada.json())._id;

  const proc = arrancarGatewayDeBolsillo(puertoApi, puertoFalsa);
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-invariante.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-invariante.err'), 'w') }));

  try {
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    const diag = () => peticionGateway(base, '/api/prolog/api/diagnostico', { method: 'POST', cookie, body: DIAG_VACIO });

    // Arranca SANA: la falla se le cargó en el bootstrap.
    for (let i = 0; i < 50 && est.count < 1; i++) await sleep(100);
    assert.ok(est.count >= 1, 'el bootstrap de arranque debe cargar la falla en la réplica');

    // Y sirviendo: el reparto le manda algún diagnóstico (la otra réplica también está).
    for (let i = 0; i < 6 && hits.diagnostico < 1; i++) assert.equal((await diag()).status, 200);
    assert.ok(hits.diagnostico >= 1, 'con la réplica sana el reparto la usa');

    // El proceso muere y vuelve con OTRO arranque y el catálogo VACÍO, pero sin
    // dejar de responder: el gateway no falla ninguna petición. Su recarga todavía no
    // está disponible, así que sigue sin catálogo mientras se comprueba el invariante.
    const antesDiag = hits.diagnostico;
    est.startupId = 2;
    est.count = 0;
    est.bootstrapOk = false;
    // Deja vencer el mínimo entre sondeos: la confirmación de identidad caduca y la
    // próxima consulta TIENE que sondearla antes de decidir.
    await sleep(700);

    // Desde la PRIMERA consulta, ninguna debe servirla la réplica obsoleta; todas
    // responden 200 (las atiende la réplica sana).
    for (let i = 0; i < 8; i++) {
      const res = await diag();
      assert.equal(res.status, 200, 'la réplica sana debe atender');
      assert.ok(Array.isArray((await res.json()).fallas), 'la respuesta viene del motor, no del gateway');
    }
    assert.equal(
      hits.diagnostico,
      antesDiag,
      'la réplica reiniciada (identidad cambiada) no debe servir ni un diagnóstico'
    );
    let estadoTrasReinicio = null;
    for (let i = 0; i < 20; i++) {
      estadoTrasReinicio = await estadoDeReplica(base, cookie, 'motor-2');
      if (estadoTrasReinicio === 'desactualizada') break;
      await sleep(100);
    }
    assert.equal(
      estadoTrasReinicio,
      'desactualizada',
      'el reinicio silencioso debe dejarla fuera hasta recargarse'
    );

    // Y en cuanto su recarga está disponible, se recarga sola y vuelve al reparto.
    const antesBootstrap = hits.bootstrap;
    est.bootstrapOk = true;
    let estadoFinal = null;
    for (let i = 0; i < 60; i++) {
      estadoFinal = await estadoDeReplica(base, cookie, 'motor-2');
      if (estadoFinal === 'sana' && hits.bootstrap > antesBootstrap) break;
      await sleep(200);
    }
    assert.equal(estadoFinal, 'sana', 'la réplica reiniciada debe recargarse y volver a sanar');
    assert.ok(hits.bootstrap > antesBootstrap, 'la recarga de la réplica reiniciada debe haber corrido');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await gateway(`/api/fallas/${fallaId}`, { method: 'DELETE', cookie });
  }
});

test('36e | Reinicio sin tráfico de por medio: se detecta entre dos consultas separadas más de 5 s', async () => {
  const puertoFalsa = PUERTO_PROLOG + 11;
  const puertoApi = PUERTO_API + 26;
  const { est, hits, server } = replicaDeBolsillo();
  await new Promise((r) => server.listen(puertoFalsa, r));

  const base = `http://localhost:${puertoApi}`;
  // Ventana por defecto (5000 ms), la de producción: es lo que hace que "más de 5 s
  // sin tráfico" importe. Con la ventana corta el caso ya lo cubre 36b/36d.
  const proc = arrancarGatewayDeBolsillo(puertoApi, puertoFalsa, { PROLOG_RESYNC_MIN_INTERVAL_MS: '5000' });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-sin-trafico.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-sin-trafico.err'), 'w') }));

  try {
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    const cookie = await sesionGateway();
    const diag = () => peticionGateway(base, '/api/prolog/api/diagnostico', { method: 'POST', cookie, body: DIAG_VACIO });
    for (let i = 0; i < 50 && hits.bootstrap < 1; i++) await sleep(100);

    const q1 = await diag();
    assert.equal(q1.status, 200, 'la primera consulta debe responder 200');
    const q1b = await diag();
    assert.equal(q1b.status, 200, 'la segunda consulta debe responder 200');
    // Con la réplica sana el reparto la usa (round-robin entre las dos).
    const antes = hits.diagnostico;
    assert.ok(antes >= 1, 'con la réplica sana el reparto le manda diagnósticos');

    // Sin NINGUNA otra petición, el proceso se reinicia (mismo puerto, otro arranque,
    // catálogo vacío). Sólo la consulta siguiente puede delatarlo, y su sondeo de
    // identidad es lo que impide que la sirva la réplica obsoleta.
    est.startupId = 2;
    est.count = 0;
    await sleep(5500);
    const q2 = await diag();
    assert.equal(q2.status, 200, 'la segunda consulta debe responder 200');
    assert.equal(hits.diagnostico, antes, 'la réplica reiniciada no debe servir la consulta');

    // El sondeo que dispara esa misma consulta la manda a recargar.
    let estadoFinal = null;
    for (let i = 0; i < 60; i++) {
      estadoFinal = await estadoDeReplica(base, cookie, 'motor-2');
      if (estadoFinal === 'sana') break;
      await sleep(200);
    }
    assert.equal(estadoFinal, 'sana', 'tras recargar debe volver a sanar');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// 2.4 Sin MOTOR_TOKEN no se arranca en producción
// ---------------------------------------------------------------------------

test('37 | Producción sin MOTOR_TOKEN: ni el motor ni la API arrancan', async () => {
  // Motor: sin token y con NODE_ENV=production, server/1 aborta antes de servir.
  const puertoMotor = PUERTO_PROLOG + 4;
  const entornoMotor = { ...process.env, NODE_ENV: 'production', PORT: String(puertoMotor) };
  delete entornoMotor.MOTOR_TOKEN;
  const motorSinToken = spawn(SWIPL, ['-q', '-f', PL_FILE, '-g', `server(${puertoMotor})`, '-t', 'halt'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: entornoMotor,
  });
  let errorMotor = '';
  motorSinToken.stderr.on('data', (d) => { errorMotor += d.toString(); });
  const codigoMotor = await new Promise((r) => motorSinToken.on('exit', (c) => r(c)));
  assert.notEqual(codigoMotor, 0, 'el motor en producción sin token debe salir con error');
  assert.match(errorMotor, /MOTOR_TOKEN/, 'el motor debe explicar por qué no arranca');

  // El mismo motor CON token sí arranca: la condición es el token, no producción.
  const motorConToken = spawn(SWIPL, ['-q', '-f', PL_FILE, '-g', `server(${puertoMotor}), sleep(3600)`, '-t', 'halt'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', PORT: String(puertoMotor), MOTOR_TOKEN: MOTOR_TOKEN_E2E },
  });
  motorConToken.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('motor-prod.out'), 'w') }));
  motorConToken.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('motor-prod.err'), 'w') }));
  try {
    await sondeo(`http://localhost:${puertoMotor}/health`, { timeout: 60000 });
  } finally {
    if (motorConToken.pid) matarArbol(motorConToken.pid);
  }

  // API: sin token y con NODE_ENV=production, el arranque falla.
  const puertoApi = PUERTO_API + 19;
  const entornoApi = { ...process.env, NODE_ENV: 'production', PORT: String(puertoApi), MONGO_URI: TEST_DB };
  delete entornoApi.MOTOR_TOKEN;
  const apiSinToken = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: entornoApi,
  });
  let errorApi = '';
  apiSinToken.stderr.on('data', (d) => { errorApi += d.toString(); });
  const codigoApi = await new Promise((r) => apiSinToken.on('exit', (c) => r(c)));
  assert.notEqual(codigoApi, 0, 'la API en producción sin token debe salir con error');
  assert.match(errorApi, /MOTOR_TOKEN/, 'la API debe explicar por qué no arranca');

  // Con MOTOR_TOKEN (y SESSION_SECRET, que producción también exige) sí arranca.
  const apiConToken = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(puertoApi),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      SESSION_SECRET: 'secreto-produccion-e2e',
    },
  });
  apiConToken.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-prod.out'), 'w') }));
  apiConToken.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-prod.err'), 'w') }));
  try {
    await sondeo(`http://localhost:${puertoApi}/api/config/tipo-cambio`, { timeout: 60000 });
  } finally {
    if (apiConToken.pid) matarArbol(apiConToken.pid);
  }
});

// ---------------------------------------------------------------------------
// 2.4 Un corte a mitad de la respuesta reintenta en la otra réplica
// ---------------------------------------------------------------------------

test('38 | Gateway multi-réplica: un corte a mitad de la respuesta reintenta en la otra, no da 500', async () => {
  // Réplica de bolsillo que pasa la sonda de arranque (para que el reparto la
  // elija) pero, al diagnosticar, manda las cabeceras y corta el socket sin
  // terminar el cuerpo. `fetch` resuelve en cuanto llegan las cabeceras: si el
  // gateway lee el cuerpo FUERA del bucle de reintento, el corte se escapa como
  // 500 aunque la otra replica este viva. Este test lo fija.
  const puertoFalsa = PUERTO_PROLOG + 5;
  const puertoApi = PUERTO_API + 20;
  const hits = { diagnostico: 0 };
  const falsa = crearServidorHttp((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok');
      }
      if (req.url === '/api/fallas/bootstrap') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
      }
      if (req.url === '/api/diagnostico') {
        hits.diagnostico += 1;
        // Cabeceras completas y cuerpo truncado: Content-Length promete mas de lo
        // que se manda y el socket se cierra. Es el corte a mitad de respuesta.
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
        res.write('{"fallas":[');
        setTimeout(() => res.socket.destroy(), 20);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => falsa.listen(puertoFalsa, r));

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoApi),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      // La que corta va PRIMERO: el cursor arranca ahi, asi que el primer
      // diagnostico cae en ella y es el que dispara el reintento.
      PROLOG_BASES: `http://localhost:${puertoFalsa},http://localhost:${PUERTO_PROLOG}`,
      PROLOG_TIMEOUT_MS: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-corta.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-corta.err'), 'w') }));

  try {
    const base = `http://localhost:${puertoApi}`;
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    const cookie = await sesionGateway();

    const primera = await peticionGateway(base, '/api/prolog/api/diagnostico', {
      method: 'POST',
      cookie,
      body: { marca: 'gen', modelo: 'gen', anio: 0, sintomas: [] },
    });
    assert.equal(
      primera.status,
      200,
      'el corte a mitad de respuesta debe reintentar en la otra replica, no dar 500/502'
    );
    const cuerpo = await primera.json();
    assert.ok(Array.isArray(cuerpo.fallas), 'la respuesta la da el motor vivo, no el gateway');
    assert.ok(hits.diagnostico >= 1, 'la replica que corta debe haber recibido el primer intento');

    // Queda fuera del reparto (cooldown): la siguiente ya no la toca.
    const antes = hits.diagnostico;
    const segunda = await peticionGateway(base, '/api/prolog/api/diagnostico', {
      method: 'POST',
      cookie,
      body: { marca: 'gen', modelo: 'gen', anio: 0, sintomas: [] },
    });
    assert.equal(segunda.status, 200);
    assert.equal(hits.diagnostico, antes, 'la replica que corto sale del reparto');

    // El failover deja su causa en el log (codigo de socket incluido), sin el
    // token del motor: es lo que permite distinguir esto de un 500 real.
    await sleep(150);
    const registro = readFileSync(logPath('api-corta.err'), 'utf8');
    assert.match(registro, /UND_ERR_SOCKET|terminated/, 'el log registra la causa de red del corte');
    assert.doesNotMatch(registro, new RegExp(MOTOR_TOKEN_E2E), 'el log no debe filtrar el token del motor');

    const salud = await (await fetch(`${base}/health`)).json();
    assert.equal(salud.motores.sanos, 1, 'solo queda sana la replica que respondio');
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    await new Promise((r) => falsa.close(r));
  }
});

// ---------------------------------------------------------------------------
// 2.7 El panel refleja la salud real de la réplica, sin tocar el reparto
// ---------------------------------------------------------------------------

test('39 | API: el estado de las réplicas refleja la salud real, no solo el cooldown', async () => {
  // Réplica de bolsillo que responde a /health mientras está viva y, al dejar de
  // responder, cuelga la conexión. La sonda en vivo del panel debe verla caída
  // aunque el gateway nunca le mandara tráfico (su cooldown sigue en cero) y aunque
  // ya haya vencido el cooldown, que es lo que una vista por cooldown ignoraría.
  const puertoFalsa = PUERTO_PROLOG + 6;
  const puertoApi = PUERTO_API + 21;
  let viva = true;
  const falsa = crearServidorHttp((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      if (req.url === '/health') {
        if (!viva) return; // sin respuesta: la sonda debe rendirse por timeout
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok');
      }
      if (req.url.startsWith('/api/fallas/bootstrap')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{}');
    });
  });
  await new Promise((r) => falsa.listen(puertoFalsa, r));

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(puertoApi),
      MONGO_URI: TEST_DB,
      MOTOR_TOKEN: MOTOR_TOKEN_E2E,
      PROLOG_BASES: `http://localhost:${PUERTO_PROLOG},http://localhost:${puertoFalsa}`,
      PROLOG_REPLICA_COOLDOWN_MS: '1000',
      PROLOG_HEALTH_TIMEOUT_MS: '300',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.pipe(createWriteStream(null, { fd: openSync(logPath('api-salud-real.out'), 'w') }));
  proc.stderr.pipe(createWriteStream(null, { fd: openSync(logPath('api-salud-real.err'), 'w') }));

  try {
    const base = `http://localhost:${puertoApi}`;
    await sondeo(`${base}/api/config/tipo-cambio`, { timeout: 60000 });
    const cookie = await sesionGateway();
    const ruta = `${base}/api/admin/replicas`;
    const consultar = async () => (await fetch(ruta, { headers: { Cookie: cookie } })).json();
    const estadoDe = (datos) => datos.replicas.find((x) => x.alias === 'motor-2')?.estado;

    // Q1: la falsa responde; la sonda la ve sana.
    assert.equal(estadoDe(await consultar()), 'sana', 'la réplica que responde debe salir sana');

    // Deja de responder. Q2 la ve caída...
    viva = false;
    const q2 = await consultar();
    assert.equal(estadoDe(q2), 'caida', 'sin respuesta, la segunda consulta debe verla caída');

    // ...pero mirar el panel no la sacó del reparto: el gateway la sigue contando
    // sana porque nunca le mandó tráfico que fallara.
    const salud2 = await (await fetch(`${base}/health`)).json();
    assert.equal(salud2.motores.sanos, 2, 'el panel no puede degradar el reparto por un sondeo');

    // Vencido el cooldown, una vista basada solo en él diría sana; la sonda en vivo
    // la sigue viendo caída.
    await sleep(1200);
    assert.equal(estadoDe(await consultar()), 'caida', 'el cooldown vencido no la vuelve a mostrar sana');

    // Nunca los destinos.
    assert.doesNotMatch(
      JSON.stringify(q2),
      /localhost:\d+|127\.0\.0\.1/,
      'no debe filtrarse la URL ni la IP'
    );
  } finally {
    if (proc.pid) matarArbol(proc.pid);
    falsa.closeAllConnections();
    await new Promise((r) => falsa.close(r));
  }
});

// ---------------------------------------------------------------------------
// Tickets: las rutas del mecanico y el correo fake. El interruptor apagado se
// prueba en backend/tickets/rutas.test.js (montarTickets devuelve false), sin
// levantar otro Prolog ni otro servidor.
// ---------------------------------------------------------------------------
async function sesionEstudianteTickets() {
  const cuenta = { username: 'tickets_estudiante', password: 'clave-tickets-estudiante' };
  await usuarioEnMongo({ ...cuenta, role: 'estudiante_mecanica', nombre: 'Estudiante Tickets' });
  const ingreso = await api('/api/auth/login', { method: 'POST', body: cuenta });
  assert.equal(ingreso.status, 200, 'la cuenta de estudiante debe poder iniciar sesión');
  return ingreso.cookie;
}

async function crearTicketDePrueba(cookieAdmin, cookieDatos, correo) {
  const diagnostico = await api('/api/diagnosticos', {
    method: 'POST',
    cookie: cookieDatos,
    body: {
      vehiculo: { marca: 'nissan', modelo: 'altima', anio: 2018 },
      sintomas: ['ruido_motor'],
      fallas: [
        {
          falla: 'cvt_nissan_altima',
          certeza: 0.9,
          nombre: 'CVT Altima',
          urgencia: 'critica',
          moneda: 'usd',
        },
      ],
    },
  });
  assert.equal(diagnostico.status, 201, 'el diagnostico de la prueba debe guardarse');
  const diag = diagnostico.body;

  const respuesta = await api('/api/tickets', {
    method: 'POST',
    cookie: cookieAdmin,
    body: {
      diagnosticoId: diag._id,
      fallasIds: ['cvt_nissan_altima'],
      cliente: { nombre: 'Ana Ticket', correo },
      // Un cliente no puede fijar precios: el servidor debe ignorarlos.
      precios: [{ falla: 'cvt_nissan_altima', precioMinMXN: 1, precioMaxMXN: 1 }],
      fallas: [{ falla: 'cvt_nissan_altima', precioMinMXN: 1, precioMaxMXN: 1 }],
    },
  });
  return { diag, respuesta };
}

test('40 | Tickets: rol, catalogo del servidor, conversion con la tasa guardada y sin tokens', async () => {
  const cookieAdmin = await sesionGateway();
  const cookieDatos = await sesionEstudianteTickets();

  const sinSesion = await api('/api/tickets');
  assert.equal(sinSesion.status, 401, 'sin sesion no se listan tickets');

  const estudiante = await api('/api/tickets', { cookie: cookieDatos });
  assert.equal(estudiante.status, 403, 'un estudiante no administra tickets');

  const correo = `tickets-${Date.now()}@example.com`;
  const { diag, respuesta } = await crearTicketDePrueba(cookieAdmin, cookieDatos, correo);
  assert.equal(respuesta.status, 201, 'el administrador debe poder crear el ticket');
  const ticket = respuesta.body;

  const tasa = diag.tipo_cambio.usd_mxn;
  assert.ok(tasa > 0, 'el diagnostico debe traer su tasa congelada');
  assert.equal(ticket.fallas[0].monedaOrigen, 'USD');
  assert.equal(ticket.fallas[0].costoMinOrigen, 3000);
  assert.equal(ticket.fallas[0].costoMaxOrigen, 4700);
  assert.equal(
    ticket.fallas[0].precioMinMXN,
    Math.round(3000 * tasa * 100) / 100,
    'el precio minimo sale del catalogo y de la tasa guardada, no del body'
  );
  assert.equal(
    ticket.fallas[0].precioMaxMXN,
    Math.round(4700 * tasa * 100) / 100,
    'el precio maximo sale del catalogo y de la tasa guardada'
  );
  assert.notEqual(ticket.fallas[0].precioMinMXN, 1, 'los precios falsificados del body se ignoran');
  assert.equal(JSON.stringify(ticket).includes('tokenHash'), false);
  assert.equal(JSON.stringify(ticket).includes('tokenVenceEn'), false);

  const lista = await api('/api/tickets?limit=999', { cookie: cookieAdmin });
  assert.equal(lista.status, 200);
  const paginados = lista.body;
  assert.equal(paginados.limit, 100, 'la paginacion se acota a 100');
  assert.equal(JSON.stringify(paginados).includes('tokenHash'), false);

  const detalle = await api(`/api/tickets/${ticket._id}`, { cookie: cookieAdmin });
  assert.equal(detalle.status, 200);
  assert.equal(JSON.stringify(detalle.body).includes('tokenHash'), false);

  const ajeno = await api('/api/tickets', {
    method: 'POST',
    cookie: cookieAdmin,
    body: {
      diagnosticoId: diag._id,
      fallasIds: ['aceite_motor_bajo'],
      cliente: { nombre: 'Ana Ticket', correo },
    },
  });
  assert.equal(ajeno.status, 422, 'una falla ajena al diagnostico no se cotiza');
});

test('41 | Tickets: enviar, leer el enlace fake, reenviar tras fallo y no autorizar por PATCH', async () => {
  const cookieAdmin = await sesionGateway();
  const cookieDatos = await sesionEstudianteTickets();
  const correo = `tickets-envio-${Date.now()}@example.com`;
  const { respuesta } = await crearTicketDePrueba(cookieAdmin, cookieDatos, correo);
  assert.equal(respuesta.status, 201);
  const ticket = respuesta.body;

  const enviado = await api(`/api/tickets/${ticket._id}/enviar`, {
    method: 'POST',
    cookie: cookieAdmin,
  });
  assert.equal(enviado.status, 200, 'el correo fake debe aceptar el envio');
  const ticketEnviado = enviado.body;
  assert.equal(ticketEnviado.envio.enviado, true);
  assert.equal(JSON.stringify(ticketEnviado).includes('tokenHash'), false);

  const require = createRequire(import.meta.url);
  const m = require(path.join(BACKEND_DIR, 'node_modules', 'mongoose'));
  await m.connect(TEST_DB);
  let primero;
  try {
    primero = await m.connection
      .collection('correos_prueba')
      .find({ para: correo })
      .sort({ creadoEn: -1 })
      .toArray();
  } finally {
    await m.disconnect();
  }
  assert.equal(primero.length, 1, 'el fake debe guardar el correo en correos_prueba');
  const enlace = /href="([^"]+)"/.exec(primero[0].html)?.[1];
  assert.ok(enlace, 'el correo debe traer el enlace');
  const token1 = new URL(enlace).hash.slice(1);
  assert.ok(token1.length > 20, 'el enlace debe llevar el token en el fragmento');
  assert.equal(enlace, `${WEB_URL}/cotizacion#${token1}`);

  // Fallo simulado: el ticket queda como cotizacion enviada pero sin envio
  // confirmado. El reintento debe regenerar el token y volver a enviar.
  await m.connect(TEST_DB);
  try {
    await m.connection.collection('tickets').updateOne(
      { _id: new m.Types.ObjectId(ticket._id) },
      { $set: { 'envio.enviado': false, 'envio.ultimoError': 'fallo simulado' } }
    );
  } finally {
    await m.disconnect();
  }

  const reenviado = await api(`/api/tickets/${ticket._id}/enviar`, {
    method: 'POST',
    cookie: cookieAdmin,
  });
  assert.equal(reenviado.status, 200, 'el reintento debe completarse');
  const ticketReenviado = reenviado.body;
  assert.equal(ticketReenviado.envio.enviado, true);
  assert.equal(ticketReenviado.envio.intentos, 2);

  await m.connect(TEST_DB);
  let segundo;
  try {
    segundo = await m.connection
      .collection('correos_prueba')
      .find({ para: correo })
      .sort({ creadoEn: -1 })
      .toArray();
  } finally {
    await m.disconnect();
  }
  assert.equal(segundo.length, 2, 'el reintento debe guardar otro correo');
  const token2 = new URL(/href="([^"]+)"/.exec(segundo[0].html)[1]).hash.slice(1);
  assert.notEqual(token2, token1, 'el reintento debe reemplazar el token anterior');

  const autorizar = await api(`/api/tickets/${ticket._id}/estado`, {
    method: 'PATCH',
    cookie: cookieAdmin,
    body: { a: 'autorizado' },
  });
  assert.equal(autorizar.status, 400, 'autorizar es del cliente, no de estas rutas');

  const cancelar = await api(`/api/tickets/${ticket._id}/estado`, {
    method: 'PATCH',
    cookie: cookieAdmin,
    body: { a: 'cancelado' },
  });
  assert.equal(cancelar.status, 200);
  const cancelado = cancelar.body;
  assert.equal(cancelado.estado, 'cancelado');
  assert.equal(JSON.stringify(cancelado).includes('tokenHash'), false);
});