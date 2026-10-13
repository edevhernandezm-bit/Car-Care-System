import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request as peticionHttp } from 'node:http';
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
// es distinto del de desarrollo a proposito: si el backend no leyera
// MOTOR_TOKEN y se quedara con el default, las pruebas fallarian con 401 en vez
// de pasar, y el fallo seria invisible.
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
    env: { ...process.env, PORT: String(PUERTO_API), MONGO_URI: TEST_DB, MOTOR_TOKEN: MOTOR_TOKEN_E2E },
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

    // La sesión se guarda en Mongo, así que la cookie de la API principal vale
    // también en esta segunda instancia.
    const cookie = await sesionGateway();
    const res = await fetch(`http://localhost:${puertoMuerto}/api/prolog/api/sintomas`, {
      headers: { Cookie: cookie },
    });
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
    assert.ok(!salida.includes(contrasena), 'nunca debe registrar la contrasena');
    assert.ok(!salida.includes(usuario), 'nunca debe registrar el usuario');
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