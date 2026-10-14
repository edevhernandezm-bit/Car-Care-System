#!/usr/bin/env node
// Semilla de diagnostico: genera diagnosticos variados llamando al motor real
// (no inventa certezas) y los guarda con origen "semilla".
//
// Uso local (API y motor ya levantados):
//   SEED_USER=... SEED_PASS=... node scripts/seed-diagnosticos.mjs --cantidad 48
//
// Contra un servidor remoto hay que decirlo EXPLICITAMENTE:
//   SEED_USER=... SEED_PASS=... node scripts/seed-diagnosticos.mjs --url https://...
//
// Por que el flag: la semilla ESCRIBE. Apuntar por accidente a un servidor
// remoto (produccion) sembraria datos ajenos, asi que un destino que no sea
// local solo se acepta si la URL vino del flag --url. Las credenciales llegan
// por entorno (SEED_USER / SEED_PASS) para que no queden en el historial ni en
// la lista de procesos.
//
// La certeza la calcula el motor: cada caso se consulta por el gateway
// (POST /api/prolog/api/diagnostico) y se guarda lo que el motor infiere. Para
// que el lote cubra alta/media/baja sin inventar nada, se generan candidatos
// hasta juntar un piso por banda y luego se toman alternando bandas.

const LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const die = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

// --- Argumentos ---
function valorFlag(nombre) {
  const i = process.argv.indexOf(nombre);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith('--')) die(`${nombre} necesita un valor.`);
  return v;
}

const urlFlag = valorFlag('--url');
const cantidad = Number(valorFlag('--cantidad') ?? 48);
if (!Number.isInteger(cantidad) || cantidad < 1) die('--cantidad debe ser un entero mayor que 0.');

const urlBase = (urlFlag || process.env.SEED_API_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');

let host;
try {
  host = new URL(urlBase).hostname;
} catch {
  die(`URL invalida: ${urlBase}`);
}
if (!LOCALES.has(host) && !urlFlag) {
  die(
    `se niega a sembrar en ${host} sin el flag explicito.\n` +
      `      Si es intencional: node scripts/seed-diagnosticos.mjs --url ${urlBase}`
  );
}

const USUARIO = process.env.SEED_USER || '';
const CLAVE = process.env.SEED_PASS || '';
if (!USUARIO || !CLAVE) die('defina SEED_USER y SEED_PASS en el entorno.');

// --- Cupo de peticiones ---
// La API corta con 429 a las 300 peticiones / 15 min (RATE_LIMIT_MAX). Cada
// intento de inferencia y cada guardado cuentan, asi que el presupuesto de
// intentos se acota (tope 200) para no agotar el cupo de un servidor desplegado.
// El piso de 60 da margen en lotes chicos, donde la banda ALTA es la escasa.
const intentosMax = Number(
  valorFlag('--intentos-max') ?? Math.min(Math.max(cantidad * 8, 60), 200)
);

// --- Vehiculos variados (incluye pares documentados que disparan fallas de modelo) ---
const VEHICULOS = [
  { marca: 'gen', modelo: 'gen', anio: 0, transmision: 'desconocida' },
  { marca: 'nissan', modelo: 'altima', anio: 2015, transmision: 'cvt' },
  { marca: 'nissan', modelo: 'sentra', anio: 2015, transmision: 'cvt' },
  { marca: 'nissan', modelo: 'rogue', anio: 2016, transmision: 'cvt' },
  { marca: 'nissan', modelo: 'pathfinder', anio: 2014, transmision: 'cvt' },
  { marca: 'ford', modelo: 'focus', anio: 2014, transmision: 'dct' },
  { marca: 'ford', modelo: 'fiesta', anio: 2013, transmision: 'dct' },
  { marca: 'volkswagen', modelo: 'jetta', anio: 2012, transmision: 'dct' },
  { marca: 'volkswagen', modelo: 'golf', anio: 2015, transmision: 'dct' },
  { marca: 'hyundai', modelo: 'sonata', anio: 2012, transmision: 'automatica' },
  { marca: 'hyundai', modelo: 'elantra', anio: 2017, transmision: 'dct' },
  { marca: 'kia', modelo: 'sportage', anio: 2012, transmision: 'automatica' },
  { marca: 'jeep', modelo: 'grand_cherokee', anio: 2015, transmision: 'automatica' },
  { marca: 'jeep', modelo: 'cherokee', anio: 2015, transmision: 'automatica' },
  { marca: 'bmw', modelo: '328i', anio: 2014, transmision: 'desconocida' },
  { marca: 'subaru', modelo: 'forester', anio: 2014, transmision: 'cvt' },
  { marca: 'subaru', modelo: 'legacy', anio: 2011, transmision: 'cvt' },
  { marca: 'honda', modelo: 'civic', anio: 2015, transmision: 'manual' },
  { marca: 'honda', modelo: 'accord', anio: 2005, transmision: 'automatica' },
  { marca: 'toyota', modelo: 'camry', anio: 2008, transmision: 'automatica' },
  { marca: 'toyota', modelo: 'corolla', anio: 2015, transmision: 'manual' },
  { marca: 'chevrolet', modelo: 'cruze', anio: 2013, transmision: 'desconocida' },
  { marca: 'chevrolet', modelo: 'malibu', anio: 2014, transmision: 'automatica' },
  { marca: 'mazda', modelo: '3', anio: 2012, transmision: 'manual' },
  { marca: 'mitsubishi', modelo: 'lancer', anio: 2015, transmision: 'cvt' },
  { marca: 'mercedes-benz', modelo: 'clase_c', anio: 2005, transmision: 'automatica' },
  { marca: 'audi', modelo: 'a4', anio: 2006, transmision: 'cvt' },
  { marca: 'ford', modelo: 'ranger', anio: 2018, transmision: 'manual' },
  { marca: 'chevrolet', modelo: 'aveo', anio: 2016, transmision: 'manual' },
  { marca: 'volkswagen', modelo: 'vento', anio: 2018, transmision: 'automatica' },
];

const rnd = (n) => Math.floor(Math.random() * n);
const elegirAlAzar = (arr) => arr[rnd(arr.length)];
const revolver = (arr) => {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
};

// Cortes identicos a los del motor y de la vista (motor_inferencia.pl:990).
const banda = (c) => (c >= 0.85 ? 'ALTA' : c >= 0.6 ? 'MEDIA' : 'BAJA');
const ORDEN_BANDAS = ['ALTA', 'MEDIA', 'BAJA'];

async function login() {
  const res = await fetch(`${urlBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USUARIO, password: CLAVE }),
  });
  if (!res.ok) die(`login fallo: HTTP ${res.status}`);
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  if (!cookies.length) die('el login no devolvio cookie de sesion.');
  return cookies.map((c) => c.split(';')[0].trim()).join('; ');
}

async function cargarCatalogo(cookie) {
  const res = await fetch(`${urlBase}/api/prolog/api/sintomas`, { headers: { cookie } });
  if (!res.ok) die(`no pude leer el catalogo de sintomas: HTTP ${res.status}`);
  const data = await res.json();
  const sintomas = (data.sintomas || []).map((s) => s.id);
  if (!sintomas.length) die('el catalogo de sintomas vino vacio.');
  const porCategoria = {};
  for (const s of data.sintomas) (porCategoria[s.categoria || 'Otra'] ||= []).push(s.id);
  return { sintomas, porCategoria };
}

// Construye sintomas de un caso. La mayoria son pares/tríos de la MISMA
// categoria: es lo que elige un usuario con sintomas coherentes y lo que
// disparara las reglas complejas del motor (las unicas que dan certeza alta).
function construirSintomas(catalogo, categoriasConjuntas) {
  const r = Math.random();
  const tam = r < 0.1 ? 1 : r < 0.3 ? 2 : 3;
  if (Math.random() < 0.25) return revolver(catalogo.sintomas).slice(0, tam);
  const candidatas = categoriasConjuntas.filter((syms) => syms.length >= tam);
  return revolver(candidatas.length ? elegirAlAzar(candidatas) : catalogo.sintomas).slice(0, tam);
}

async function main() {
  const cookie = await login();
  const catalogo = await cargarCatalogo(cookie);
  const categoriasConjuntas = Object.values(catalogo.porCategoria).filter((c) => c.length >= 2);

  const quota = Math.ceil(cantidad / 3);
  const colas = { ALTA: [], MEDIA: [], BAJA: [] };
  let intentos = 0;

  const pisoAlcanzado = () => ORDEN_BANDAS.every((b) => colas[b].length >= quota);
  while (intentos < intentosMax && !pisoAlcanzado()) {
    intentos++;
    const vehiculo = elegirAlAzar(VEHICULOS);
    const sintomas = construirSintomas(catalogo, categoriasConjuntas);
    const res = await fetch(`${urlBase}/api/prolog/api/diagnostico`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ...vehiculo, sintomas }),
    });
    if (res.status === 429) {
      die('la API corto con 429. Baje --cantidad o espere la ventana de limites.');
    }
    if (!res.ok) die(`la inferencia fallo: HTTP ${res.status}`);
    const data = await res.json();
    const fallas = data.fallas || [];
    if (!fallas.length) continue;
    const b = banda(Math.max(...fallas.map((f) => f.certeza)));
    colas[b].push({ vehiculo, sintomas, fallas });
  }

  // Alterna bandas para que el lote las cubra; si una no alcanzo, rellena con las otras.
  const elegidos = [];
  while (elegidos.length < cantidad) {
    let tomo = false;
    for (const b of ORDEN_BANDAS) {
      if (elegidos.length >= cantidad) break;
      const caso = colas[b].shift();
      if (caso) {
        elegidos.push(caso);
        tomo = true;
      }
    }
    if (!tomo) break;
  }
  if (!elegidos.length) die('el motor no infirio ninguna falla con los casos generados.');

  for (const caso of elegidos) {
    const res = await fetch(`${urlBase}/api/diagnosticos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        vehiculo: caso.vehiculo,
        sintomas: caso.sintomas,
        origen: 'semilla',
        fallas: caso.fallas.map((f) => ({
          falla: f.id,
          certeza: f.certeza,
          nombre: f.nombre,
          urgencia: f.urgencia,
          moneda: f.moneda,
        })),
      }),
    });
    if (res.status !== 201) die(`no pude guardar un diagnostico: HTTP ${res.status}`);
  }

  const dist = { ALTA: 0, MEDIA: 0, BAJA: 0 };
  for (const caso of elegidos) dist[banda(Math.max(...caso.fallas.map((f) => f.certeza)))]++;

  console.log(`Semilla completada contra ${urlBase}`);
  console.log(`  diagnosticos guardados (origen 'semilla'): ${elegidos.length}`);
  console.log(`  por banda (certeza maxima del diagnostico): ALTA ${dist.ALTA} | MEDIA ${dist.MEDIA} | BAJA ${dist.BAJA}`);
  console.log(`  intentos de inferencia: ${intentos} (tope ${intentosMax}, piso por banda ${quota})`);
}

main().catch((err) => die(err.message));
