const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');

const app = express();
const PUERTO = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/car_care_system';

// Proxies delante de la API: CloudFront y el ALB, en ese orden. Sin declararlos
// Express no se fia de X-Forwarded-Proto/For: `req.ip` seria la IP interna del
// ALB (y el limitador de peticiones contaria a todos los clientes como uno) y
// `req.protocol` no veria el https que termina CloudFront.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 2);
app.set('trust proxy', TRUST_PROXY_HOPS);

// Motor de inferencia Prolog. El navegador ya no lo llama directo: todo pasa por
// este gateway same-origin, de modo que el frontend funciona igual en dev (proxy
// de Vite) y en produccion (nginx -> Express -> Prolog), sin CORS ni HTTP mixto.
const PROLOG_BASE = process.env.PROLOG_BASE || 'http://localhost:8000';
const PROLOG_TIMEOUT_MS = Number(process.env.PROLOG_TIMEOUT_MS) || 3000;
// Token que comparte con el motor. El motor rechaza con 401 cualquier peticion
// que no lo traiga (salvo su preflight), porque su CRUD no exige nada por si
// mismo: sin esto, quien alcance el puerto del motor vacia el catalogo. Debe ser
// hexadecimal (SWI lee el valor de la cabecera como termino Prolog) y el mismo
// en los dos contenedores. El valor por defecto solo cubre el desarrollo local.
const MOTOR_TOKEN = process.env.MOTOR_TOKEN || 'decafbaddecafbad';
const CABECERAS_MOTOR = { 'Content-Type': 'application/json', 'X-Motor-Token': MOTOR_TOKEN };
// Allowlist de origenes. Acepta una lista separada por comas: CORS_ORIGIN=*
// habilita cualquier origen (util solo en desarrollo).
const CORS_ORIGENES = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// --- Tasa de cambio USD -> MXN ---
// La tasa se congela por diagnóstico: cada documento guarda la que se usó al
// emitirlo, para que el historial siga siendo auditable aunque la tasa vigente
// cambie. Se resuelve en este orden y se devuelve siempre de dónde salió:
//   1. caché en memoria (TTL 6 h para tasa real, 5 min para estimada)
//   2. Frankfurter (datos de referencia del BCE, sin clave)
//   3. documento Config en MongoDB (semilla, sobrevive reinicios)
//   4. constante de código
const TIPO_CAMBIO_URL =
  process.env.TIPO_CAMBIO_URL || 'https://api.frankfurter.app/latest?from=USD&to=MXN';
const TIPO_CAMBIO_TIMEOUT_MS = 3000;
const TIPO_CAMBIO_TTL_MS = 6 * 60 * 60 * 1000;
// Una tasa estimada o constante no debe quedar fijada por el TTL completo: si la
// API publica estuvo caida un momento, 6 h de una tasa vieja son horas de datos
// incorrectos. Se reintenta cada 5 min.
const TIPO_CAMBIO_TTL_ESTIMADO_MS = 5 * 60 * 1000;
const TIPO_CAMBIO_FALLBACK = Number(process.env.TIPO_CAMBIO_USD_MXN) || 18.3;

let cacheTipoCambio = null;
// Promesa en vuelo. Sin esto, N peticiones simultaneas con la cache fria disparan
// N llamadas a Frankfurter (stampede). Con esto, todas comparten una sola.
let pendienteTipoCambio = null;

// Cabecera que inyecta CloudFront y que nadie mas conoce: quien le pegue al DNS
// del ALB directo no la trae y se queda fuera. Solo se exige si esta definida,
// porque en local no hay CloudFront delante. `/health` queda exento a proposito:
// el health check del ALB llega al destino sin pasar por CloudFront, y si se le
// exigiera la cabecera el balanceador sacaria la tarea de servicio.
const ORIGIN_VERIFY = process.env.ORIGIN_VERIFY;
app.use((req, res, next) => {
  if (!ORIGIN_VERIFY || req.path === '/health') return next();
  if (req.get('X-Origin-Verify') === ORIGIN_VERIFY) return next();
  return res.status(403).json({ error: 'Origen no autorizado' });
});

// `origin` debe compararse contra la allowlist de forma explicita: pasar un
// string a `cors` hace que lo devuelva siempre, sin comparar con el origen real
// de la peticion (es decir, no restringe nada).
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || CORS_ORIGENES.includes('*') || CORS_ORIGENES.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  })
);
app.use(express.json({ limit: '1mb' }));

function sanitizeUri(uri) {
  try {
    if (!uri) return uri;
    return uri.replace(/:\/\/([^:]+):([^@]+)@/, '://****:****@');
  } catch (e) {
    return uri;
  }
}

// Sesiones
// En produccion no hay secreto por defecto: el del repositorio permitiria
// fabricar una cookie de sesion valida. El arranque falla con un mensaje claro
// en vez de aceptarlo en silencio.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error(
    '[config] Falta SESSION_SECRET. En produccion no se usa el secreto de desarrollo: definela en el entorno.'
  );
  process.exit(1);
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-session-secret-cambiar-en-prod',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: 'sesiones' }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

// Modelos
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['administrador_mecanico', 'estudiante_mecanica'], required: true },
  nombre: String,
  activo: { type: Boolean, default: true },
}, { timestamps: true });

const fallaSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },
  sintomas: [String],
  // El año se guarda como rango porque así lo declara la base de conocimiento de
  // Prolog: sus fallas por vehículo usan `Anio >= Min, Anio =< Max`, nunca un año
  // exacto. `anio` se conserva para las filas ya guardadas y para el formulario
  // de diagnóstico; cuando no llega rango, `normalizarVehiculo` usa `anio` como
  // ambos extremos, que es la semántica exacta que se pidió para "no sé el rango".
  vehiculo: {
    marca: String,
    modelo: String,
    anio: Number,
    anioDesde: Number,
    anioHasta: Number,
    transmision: String,
  },
  causas: [String],
  solucion: String,
  procedimiento: [String],
  precioMin: { type: Number, required: true, min: 0 },
  precioMax: { type: Number, required: true, min: 0 },
  moneda: { type: String, enum: ['MXN'], default: 'MXN' },
  creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  prologId: { type: String, required: true },
  activo: { type: Boolean, default: true, index: true },
  deletedAt: { type: Date, default: null, index: true },
  origen: { type: String, enum: ['usuario'], default: 'usuario' },
  confianzaDato: { type: String, default: 'media' },
  fuenteFalla: { type: String, default: 'Registrado por usuario (Administrador/Mecánico)' },
  urgencia: { type: String, default: 'media' },
  certezaBase: { type: Number, default: 0.7, min: 0, max: 1 },
}, { timestamps: true });

// Indice unico PARCIAL: solo las fallas vivas reservan su prologId. Con un indice
// unico global, una falla borrada logicamente seguia ocupandi el identificador
// para siempre, y volver a registrar la misma falla (flujo normal: se creo,
// se elimino por error, se vuelve a capturar) terminaba en un 500 de indice
// duplicado en vez de recrearse.
fallaSchema.index(
  { prologId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
fallaSchema.index({ activo: 1, deletedAt: 1 });
const User = mongoose.model('User', userSchema);
const Falla = mongoose.model('Falla', fallaSchema);

// El indice de prologId paso de unico global a unico parcial (solo las fallas
// vivas reservan el identificador). En una base ya creada el indice viejo sigue
// ahi: autoIndex no cambia las opciones de un indice que ya existe, solo avisa, y
// el unico global seguiria rechazando la recreacion de una falla borrada, que es
// justo lo que el parcial viene a permitir. Por eso se reemplaza al arrancar, y
// solo si el indice encontrado tiene la forma exacta del anterior (unico, sin
// filtro parcial): cualquier otro indice con ese nombre se deja como esta, porque
// significaria que alguien lo cambio a proposito.
//
// Entre el drop y el create hay una ventana sin restriccion de unicidad. Con una
// instalacion de un solo backend que escribe por peticion es inocua, y aun asi
// el orden es fijo: primero se suelta el viejo, despues se crea el parcial, y si
// la creacion falla el arranque lo dice en vez de dejarlo para siempre.
async function alinearIndicePrologId() {
  // En una base recien creada la coleccion `fallas` todavia no existe, y listar
  // sus indices sobre un namespace inexistente lanza. Antes de este try el fallo
  // era real: al ser el primer toque a la coleccion, una instalacion nueva
  // moria en el arranque (`ns does not exist` -> process.exit) y nunca llegaba a
  // crear el indice que vino a sustituir. Sin indice viejo que retirar no hay
  // nada que alinear, asi que se sigue de largo.
  let existentes;
  try {
    existentes = await Falla.collection.indexes();
  } catch (err) {
    // Solo se tolera la base recien creada: Mongo lanza NamespaceNotFound
    // porque la coleccion todavia no existe, y ahi no hay indice que alinear.
    // Cualquier otro error (permisos, red, primary caida) es real y se propaga:
    // tragarselo devolveria el arranque con la unicidad de `prologId` sin
    // comprobar, que es justo la invariante que este indice sostiene.
    const namespaceAusente =
      err.code === 26 ||
      err.codeName === 'NamespaceNotFound' ||
      err.codeName === 'IndexNotFound';
    if (!namespaceAusente) throw err;
    console.log(`[indices] Sin índices en fallas todavía: ${err.message}`);
    return;
  }
  const viejo = existentes.find((i) => i.name === 'prologId_1');
  if (!viejo) return;
  if (viejo.partialFilterExpression) {
    // El indice parcial es la unica garantia de que dos fallas activas no
    // compartan `prologId`. Si el que ya existe filtra por otra cosa, protege
    // algo distinto y sustituirlo cambiaria la invariante sin avisar, asi que
    // se deja como esta y el arranque lo dice en voz alta.
    const filtra = viejo.partialFilterExpression;
    if (JSON.stringify(filtra) !== JSON.stringify({ deletedAt: null })) {
      console.warn(
        `[indices] prologId_1 ya es parcial pero con filtro inesperado ` +
          `(${JSON.stringify(filtra)}). Se conserva; la unicidad entre fallas ` +
          'activas queda sin garantizar.',
      );
    }
    return;
  }
  await Falla.collection.dropIndex('prologId_1');
  console.log('[indices] Retirado el índice único global prologId_1 (sustituto parcial)');
  await Falla.createIndexes();
  const [final] = (await Falla.collection.indexes()).filter((i) => i.name === 'prologId_1');
  console.log(
    final?.unique && final?.partialFilterExpression
      ? '[indices] prologId_1 recreado como único parcial'
      : '[indices] prologId_1 NO quedó como único parcial: revisa el motor'
  );
}

// Vuelca las fallas registradas de MongoDB al motor. El endpoint de bootstrap de
// Prolog limpia primero las dinamicas de usuario y afirma el lote completo, asi
// que las fallas borradas en Mongo desaparecen tambien del motor sin que nadie
// tenga que acordarse de retractar una por una.
async function bootstrapFallasDinamicas() {
  try {
    const activas = await Falla.find({ activo: true, deletedAt: null }).lean();
    // Se llama al endpoint tambien con el lote vacio, y el motivo es el
    // retract: si aqui se salia con un `return` temprano, un arranque en el que
    // ya no quedara ninguna falla viva dejaba en Prolog las dinamicas del
    // arranque anterior, porque el motor solo se limpia cuando alguien le envia
    // un bootstrap. El lote vacio es el unico modo de limpar.
    const r = await fetch(`${PROLOG_BASE}/api/fallas/bootstrap`, {
      method: 'POST',
      headers: CABECERAS_MOTOR,
      body: JSON.stringify({ fallas: activas.map(payloadProlog) }),
      // El arranque espera de verdad a que Prolog responda (a diferencia de la
      // sincronizacion por peticion), porque si no el primer diagnostico podria
      // correr contra un motor sin las fallas de Mongo.
      signal: AbortSignal.timeout(PROLOG_TIMEOUT_MS * 2),
    });
    if (!r.ok) throw new Error(`Bootstrap Prolog HTTP ${r.status}`);
    const j = await r.json();
    console.log(
      activas.length === 0
        ? '[bootstrap] Motor sin fallas dinámicas de usuario'
        : `[bootstrap] Fallas dinámicas cargadas en Prolog: ${j.count}`
    );
  } catch (e) {
    console.error('[bootstrap] Error cargando fallas dinámicas:', e.message);
  }
}

// Sin al menos un administrador nobody puede entrar: las rutas de escritura
// exigen ese rol y /api/usuarios tambien. En una base nueva la coleccion esta
// vacia, asi que se crea una cuenta inicial desde el entorno. Solo si la
// coleccion esta vacia: en cuanto existe un usuario, esta funcion no vuelve a
// tocar la base.
async function seedAdminSiHaceFalta() {
  try {
    if ((await User.estimatedDocumentCount()) > 0) return;
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
      console.warn('[seed] No hay usuarios. Define ADMIN_USERNAME y ADMIN_PASSWORD para crear el primero.');
      return;
    }
    await User.create({
      username: username.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      role: 'administrador_mecanico',
      nombre: process.env.ADMIN_NOMBRE || 'Administrador',
    });
    console.log(`[seed] Administrador inicial creado: ${username}`);
  } catch (e) {
    console.error('[seed] Error creando el administrador inicial:', e.message);
  }
}

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log(`MongoDB conectado: ${sanitizeUri(MONGO_URI)}`);
    await seedAdminSiHaceFalta();
    await alinearIndicePrologId();
    await bootstrapFallasDinamicas();
  })
  .catch((err) => {
    console.error('Error conectando a MongoDB:', err.message);
    process.exit(1);
  });

// --- Gateway same-origin hacia el motor Prolog ---
// El motor no debe ser alcanzable directo: su CRUD de catalogo (POST/PUT/DELETE
// /api/fallas y el bootstrap) no exige nada, asi que cualquiera desde internet
// podria vaciarlo o sobreescribirlo. Este gateway publica solo lo que el
// frontend consume (inferencia y lecturas de catalogo); el catalogo se modifica
// por /api/fallas, que ya sincroniza con el motor y exige rol de administrador.
const RUTAS_PROLOG_PERMITIDAS = new Map([
  ['/api/diagnostico', ['POST', 'OPTIONS']],
  ['/api/sintomas', ['GET', 'OPTIONS']],
  ['/api/fallas', ['GET', 'OPTIONS']],
]);

// Se compara la ruta cruda, sin decodificar y sin normalizar, contra la lista:
// asi `/api/%73intomas`, `/api/sintomas/` o `/api/../api/sintomas` no coinciden
// y no hay forma de esquivar la lista codificando o subiendo directorios.
function rutaPrologPermitida(ruta) {
  if (ruta.includes('%') || ruta.includes('..') || ruta.includes('//')) return null;
  return RUTAS_PROLOG_PERMITIDAS.get(ruta) || null;
}

function autorizarGatewayProlog(req, res, next) {
  const permitidos = rutaPrologPermitida(req.path);
  if (!permitidos) {
    return res.status(404).json({ error: 'Ruta no encontrada' });
  }
  if (!permitidos.includes(req.method)) {
    res.setHeader('Allow', permitidos.join(', '));
    return res.status(405).json({ error: 'Método no permitido' });
  }
  // El preflight no lleva credenciales por diseno: exigir sesion aqui romperia
  // CORS sin cerrar nada, porque el motor solo responde 204 y no ejecuta nada.
  if (req.method === 'OPTIONS') return next();
  return requireAuth(req, res, next);
}

// `req.url` ya viene sin el prefijo de montaje: /api/prolog/api/sintomas ->
// http://localhost:8000/api/sintomas
app.use('/api/prolog', autorizarGatewayProlog, async (req, res, next) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROLOG_TIMEOUT_MS);
  try {
    const init = {
      method: req.method,
      headers: { ...CABECERAS_MOTOR, 'Content-Type': req.headers['content-type'] || 'application/json' },
      signal: controller.signal,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      init.body = JSON.stringify(req.body);
    }

    const respuesta = await fetch(`${PROLOG_BASE}${req.url}`, init);
    clearTimeout(timeout);

    res.status(respuesta.status);
    res.setHeader('Content-Type', respuesta.headers.get('content-type') || 'application/json');
    res.send(await respuesta.text());
  } catch (err) {
    clearTimeout(timeout);
    next(Object.assign(new Error('No se pudo contactar al motor Prolog'), { status: 502 }));
  }
});

// --- Salud ---
// Sonda del balanceador. Es barata (solo mira el estado en memoria de la
// conexion, no consulta la base) y publica: el health check del ALB la pide sin
// credenciales y tiene que llegar antes que la sesion. Si Mongo no esta
// conectado la tarea no puede atender nada util (sesiones y datos viven ahi),
// asi que se marca 503 para que el balanceador no le mande trafico.
app.get('/health', (_req, res) => {
  const conectado = mongoose.connection.readyState === 1;
  res.status(conectado ? 200 : 503).json({
    status: conectado ? 'ok' : 'degradado',
    db: conectado ? 'conectado' : 'desconectado',
  });
});

// --- Tasa de cambio ---
// Un único documento con clave 'tipo_cambio_usd_mxn' guarda la última tasa
// conocida. Es el respaldo cuando la API pública no responde.
const configSchema = new mongoose.Schema({
  clave: { type: String, required: true, unique: true },
  valor: { type: Number, required: true },
  fecha: { type: String, required: true },
  fuente: { type: String, required: true },
  actualizado_en: { type: Date, default: Date.now },
});

const Config = mongoose.model('Config', configSchema);

async function tasaDesdeApi() {
  const res = await fetch(TIPO_CAMBIO_URL, { signal: AbortSignal.timeout(TIPO_CAMBIO_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Frankfurter respondió ${res.status}`);
  const data = await res.json();
  const valor = Number(data?.rates?.MXN);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`Frankfurter devolvió una tasa inválida: ${JSON.stringify(data)}`);
  }
  return { valor, fecha: String(data.date), fuente: 'frankfurter', es_estimado: false };
}

async function tasaDesdeMongo() {
  const doc = await Config.findOne({ clave: 'tipo_cambio_usd_mxn' }).lean();
  if (doc) {
    return {
      valor: doc.valor,
      fecha: doc.fecha,
      fuente: doc.fuente,
      es_estimado: true,
    };
  }
  // Sin semilla: se crea con la constante para que exista un respaldo en BD.
  const fecha = hoyISO();
  await Config.updateOne(
    { clave: 'tipo_cambio_usd_mxn' },
    { $setOnInsert: { valor: TIPO_CAMBIO_FALLBACK, fecha, fuente: 'constante', actualizado_en: new Date() } },
    { upsert: true }
  );
  return { valor: TIPO_CAMBIO_FALLBACK, fecha, fuente: 'constante', es_estimado: true };
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

async function obtenerTipoCambio() {
  let tasa;
  try {
    tasa = await tasaDesdeApi();
  } catch (err) {
    console.warn(`Tipo de cambio: API pública no disponible (${err.message}). Usando respaldo.`);
    try {
      tasa = await tasaDesdeMongo();
    } catch (errBd) {
      console.error(`Tipo de cambio: respaldo en BD falló (${errBd.message}). Usando constante.`);
      tasa = { valor: TIPO_CAMBIO_FALLBACK, fecha: hoyISO(), fuente: 'constante', es_estimado: true };
    }
  }

  cacheTipoCambio = { ...tasa, obtenido_en: Date.now() };

  // Persistir la tasa real para que un reinicio con la API caída no pierda el
  // último dato bueno conocido. Se espera el write: es rápido, y sin él el
  // respaldo en BD dependería de que el proceso sobreviva después de responder.
  if (tasa.fuente === 'frankfurter') {
    try {
      await Config.updateOne(
        { clave: 'tipo_cambio_usd_mxn' },
        { $set: { valor: tasa.valor, fecha: tasa.fecha, fuente: tasa.fuente, actualizado_en: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      console.error(`Tipo de cambio: no se pudo persistir (${err.message})`);
    }
  }

  return cacheTipoCambio;
}

async function resolverTipoCambio() {
  const ttl = cacheTipoCambio?.es_estimado ? TIPO_CAMBIO_TTL_ESTIMADO_MS : TIPO_CAMBIO_TTL_MS;
  if (cacheTipoCambio && Date.now() - cacheTipoCambio.obtenido_en < ttl) {
    return cacheTipoCambio;
  }
  // Cache fría: todas las peticiones concurrentes comparten una sola resolución.
  if (!pendienteTipoCambio) {
    pendienteTipoCambio = obtenerTipoCambio().finally(() => {
      pendienteTipoCambio = null;
    });
  }
  return pendienteTipoCambio;
}

// --- Historial de consultas y estadísticas del factor de certeza ---
// Cada consulta al motor de inferencia se guarda para generar las estadísticas
// del factor de certeza (certeza promedio por falla, conteos y promedio global).

const diagnosticoSchema = new mongoose.Schema({
  vehiculo: {
    marca: { type: String, default: '' },
    modelo: { type: String, default: '' },
    anio: { type: Number, default: 0 },
    transmision: { type: String, default: 'desconocida' },
  },
  // Tasa congelada al emitir este diagnóstico. El historial se reconstruye con
  // estos valores, nunca con la tasa vigente.
  tipo_cambio: {
    usd_mxn: { type: Number, required: true },
    fecha: { type: String, required: true },
    fuente: { type: String, required: true },
  },
  sintomas: [{ type: String }],
  fallas: [
    {
      falla: { type: String, required: true },
      // El motor calcula la certeza y la redondea a dos decimales
      // (certeza_falla/3 en motor_inferencia.pl:932). El 0 entra por esa via:
      // una regla con certeza menor a 0.005 redondea a 0.0 y sale en el JSON.
      // Por eso el intervalo es [0, 1] y no (0, 1]: excluirlo rechazaba con 400
      // un diagnostico que el motor si habia emitido, y se perdia entero. El
      // extremo superior sigue cerrado porque es el que envenena los promedios
      // de /api/stats/certeza: sin el, un cliente podria guardar certeza: 99.
      // Mongoose no implementa exclusiveMaximum (es JSON Schema), asi que los
      // limites se fijan con validator.
      certeza: {
        type: Number,
        required: true,
        validate: {
          validator: (v) => Number.isFinite(v) && v >= 0 && v <= 1,
          message: 'la certeza debe estar en el intervalo [0, 1]',
        },
      },
      nombre: { type: String, default: '' },
      urgencia: { type: String, default: '' },
      moneda: { type: String, default: '' },
    },
  ],
  creado_en: { type: Date, default: Date.now },
});

// Indices que sostienen las consultas reales: el historial se ordena por
// `creado_en` y las estadísticas agrupan por `fallas.falla`.
diagnosticoSchema.index({ creado_en: -1 });
diagnosticoSchema.index({ 'fallas.falla': 1 });

const Diagnostico = mongoose.model('Diagnostico', diagnosticoSchema);

app.get('/api/diagnosticos', async (_req, res, next) => {
  try {
    const historial = await Diagnostico.find().sort({ creado_en: -1 }).limit(100);
    res.json(historial);
  } catch (err) {
    next(err);
  }
});

app.post('/api/diagnosticos', async (req, res, next) => {
  try {
    const tasa = await resolverTipoCambio();
    const diag = new Diagnostico({
      vehiculo: {
        marca: req.body.vehiculo?.marca || '',
        modelo: req.body.vehiculo?.modelo || '',
        anio: req.body.vehiculo?.anio || 0,
        transmision: req.body.vehiculo?.transmision || 'desconocida',
      },
      tipo_cambio: {
        usd_mxn: tasa.valor,
        fecha: tasa.fecha,
        fuente: tasa.fuente,
      },
      sintomas: req.body.sintomas || [],
      fallas: (req.body.fallas || []).map((f) => ({
        falla: f.falla,
        certeza: f.certeza,
        nombre: f.nombre || '',
        urgencia: f.urgencia || '',
        moneda: f.moneda || '',
      })),
    });
    const guardado = await diag.save();
    res.status(201).json(guardado);
  } catch (err) {
    next(err);
  }
});

// Estadísticas del factor de certeza: certeza promedio por falla, cantidad de
// veces que se infirió cada falla y el promedio general, basado en el historial
// guardado.

// La certeza se publica siempre a dos decimales. Un promedio con quince cifras no
// viene de datos reales, y obligaría a cada cliente a redondear por su cuenta.
// El global y el promedio por falla pasan por aquí para que la regla sea una.
const redondearCerteza = (v) => Math.round(v * 100) / 100;

app.get('/api/stats/certeza', async (_req, res, next) => {
  try {
    // total_consultas se cuenta sobre los documentos, no sobre el pipeline
    // desenrollado: una consulta que no infirió ninguna falla sigue siendo una
    // consulta, y con el $unwind desaparecería del conteo. No es un caso
    // teórico: el cliente guarda el diagnóstico aunque el motor no devuelva
    // ninguna falla.
    const [porFalla, totales, total_consultas] = await Promise.all([
      Diagnostico.aggregate([
        { $unwind: '$fallas' },
        {
          $group: {
            _id: '$fallas.falla',
            veces: { $sum: 1 },
            certeza_promedio: { $avg: '$fallas.certeza' },
          },
        },
        { $sort: { veces: -1 } },
      ]),
      Diagnostico.aggregate([
        { $unwind: '$fallas' },
        {
          $group: {
            _id: null,
            promedio_global: { $avg: '$fallas.certeza' },
            total_fallas_inferidas: { $sum: 1 },
          },
        },
      ]),
      Diagnostico.countDocuments(),

    ]);

    res.json({
      total_consultas,
      total_fallas_inferidas: (totales[0] && totales[0].total_fallas_inferidas) || 0,
      // El promedio sale null, no 0, cuando no hay ninguna falla que promediar.
      // El `|| 0` de antes convertia "aun no se midio nada" en "la certeza media
      // del sistema es 0", que es una afirmacion que nadie hizo: el cliente lo
      // pintaba como "0%" con nivel Bajo, junto a las consultas que si existen.
      // Un conteo ausente si es 0 de verdad; un promedio ausente es null.
      certeza_promedio_global: totales[0]
        ? redondearCerteza(totales[0].promedio_global)
        : null,
      por_falla: porFalla
        .map((f) => ({
          falla: f._id,
          veces: f.veces,
          certeza_promedio: redondearCerteza(f.certeza_promedio),
        }))
        // El pipeline ya ordena por `veces`, pero Mongo no garantiza un orden
        // estable entre empates y este sort sí lo tiene: mantiene determinista
        // el orden en que el cliente recibe las filas con la misma cuenta.
        .sort((a, b) => b.veces - a.veces),
    });
  } catch (err) {
    next(err);
  }
});

// Tasa vigente. Se usa solo donde no hay un diagnóstico asociado (catálogo de
// fallas): un diagnóstico ya emitido lleva su propia tasa congelada.
app.get('/api/config/tipo-cambio', async (_req, res, next) => {
  try {
    const tasa = await resolverTipoCambio();
    res.json({
      usd_mxn: tasa.valor,
      fecha: tasa.fecha,
      fuente: tasa.fuente,
      es_estimado: tasa.es_estimado,
    });
  } catch (err) {
    next(err);
  }
});

// --- Autorizacion ---
// El identificador de usuario viaja en la sesion, no en la peticion: la cookie
// HttpOnly es lo unico que el navegador manda solo, y un id leido de un header o
// del cuerpo seria falsificable por el cliente. `requireAuth` y `requireAdmin`
// son la unica frontera de confianza: el menu del frontend solo evita mostrar
// botones, pero cualquier peticion a mano pasa por aqui.
//
// El rol no se toma de la sesion para autorizar. La sesion es una fotografia: si
// un administrador degrada o desactiva a otro, la copia de su rol sigue en la
// cookie del afectado y podria escribir en fallas hasta que cerrara sesion. Por
// eso `requireAdmin` relee la cuenta antes de cada escritura; el coste es una
// lectura indexada por _id, y lo que compra es que la revocacion sea inmediata.
const ROLES = ['administrador_mecanico', 'estudiante_mecanica'];

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  try {
    const cuenta = await User.findById(req.session.userId).lean();
    if (!cuenta || !cuenta.activo) {
      // Una cuenta borrada o desactivada deja de valer aunque la sesion siga
      // viva. Se destruye la sesion para que el siguiente 401 del frontend cierre
      // la pantalla y no deje un menu de administrador sobre una sesion muerta.
      await new Promise((resolve) => req.session.destroy(resolve));
      return res.status(401).json({ error: 'La sesión ya no es válida' });
    }
    if (cuenta.role !== 'administrador_mecanico') {
      return res.status(403).json({ error: 'Se requiere rol administrador' });
    }
    req.admin = cuenta;
    next();
  } catch (err) {
    next(err);
  }
}

// El identificador que usa Prolog sale del nombre, y el motor no admite tildes ni
// espacios en el functor: se normaliza a snake_case. La NFD separa la tilde de la
// letra, asi que "ñ" queda como "n" + marca combinante y el filtro de marcas la
// elimina; no hace falta un caso especial para la enye.
function slugPrologId(nombre) {
  return String(nombre)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// --- Validacion de fallas ---
// El mismo conjunto de reglas para crear y para editar: si divergen, el mismo
// documento pasa por POST y es rechazado por PUT. Devuelve un mensaje, no una
// lista: el cliente solo necesita saber que fallo, y el schema de mongoose ya
// cubre el detalle de tipos en la capa de persistencia.
const ANIO_MAXIMO = new Date().getFullYear();
const TRANSMISIONES = ['desconocida', 'manual', 'automatica', 'cvt', 'dct'];
const URGENCIAS = ['baja', 'media', 'alta', 'critica'];
const CONFIANZAS = ['alta', 'media', 'baja', 'ninguna'];

// Normaliza el vehículo a la forma que se persiste. Vive en una función porque la
// construyen el POST, el PUT y la sincronización con Prolog, y el aviso de
// `payloadProlog` vale igual aquí: tres copias del mismo objeto se separan en
// cuanto una de las tres añade un campo y las otras dos no.
//
// El rango se deriva de `anioDesde`/`anioHasta` y, si no llegan, de `anio`. Con
// `anio` en 0 el rango queda 0-0, que en Prolog significa "cualquier año" porque
// `rango_anios/4` lo traduce a 0-9999, así que una falla sin año declarado no
// queda dormida. Los extremos invertidos se toleran: el orden los pone el
// formulario, no el modelo.
function normalizarVehiculo(v) {
  const src = v && typeof v === 'object' ? v : {};
  const anio = Number(src.anio ?? 0);
  const anioValido = (x) => {
    const n = Number(x);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const desde = anioValido(src.anioDesde) ?? anio;
  const hasta = anioValido(src.anioHasta) ?? desde;
  return {
    marca: src.marca || '',
    modelo: src.modelo || '',
    anio,
    anioDesde: Math.min(desde, hasta),
    anioHasta: Math.max(desde, hasta),
    transmision: src.transmision || 'desconocida',
  };
}

function validarFalla(b) {
  const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
  if (!nombre) return 'El nombre de la falla es obligatorio.';
  // Un nombre de solo simbolos o de otro alfabeto deja el identificador vacio, y
  // Prolog no puede nombrar una falla sin functor.
  if (!slugPrologId(nombre)) return 'El nombre debe incluir al menos una letra o un numero.';

  if (!Array.isArray(b.sintomas)) return 'Los síntomas deben venir como lista.';
  const sintomas = b.sintomas.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  if (sintomas.length === 0) return 'La falla necesita al menos un síntoma.';

  const precioMin = Number(b.precioMin);
  const precioMax = Number(b.precioMax);
  if (!Number.isFinite(precioMin) || !Number.isFinite(precioMax)) {
    return 'Indica el precio mínimo y el máximo.';
  }
  // Los precios son MXN: negativos y "cuesta menos que el tope" no son datos,
  // son errores de captura.
  if (precioMin < 0 || precioMax < 0) return 'Los precios no pueden ser negativos.';
  if (precioMin > precioMax) return 'El precio mínimo no puede ser mayor que el máximo.';

  // Marca y modelo son obligatorios porque son los que acotan la falla a un
  // vehículo: sin ellos la falla se afirmaría como aplicable a cualquiera y
  // aparecería en diagnósticos de coches que no la tienen.
  const vehiculo = normalizarVehiculo(b.vehiculo);
  if (!vehiculo.marca.trim()) return 'Indica la marca del vehículo.';
  if (!vehiculo.modelo.trim()) return 'Indica el modelo del vehículo.';

  const { anio, anioDesde, anioHasta } = vehiculo;
  for (const [campo, valor] of [['el año', anio], ['el año desde', anioDesde], ['el año hasta', anioHasta]]) {
    if (!Number.isInteger(valor) || valor < 0 || valor > ANIO_MAXIMO) {
      return `${campo} debe estar entre 0 y ${ANIO_MAXIMO} (0 = no lo sé).`;
    }
  }
  if (anioDesde > anioHasta) {
    return 'El año desde no puede ser mayor que el año hasta.';
  }
  const transmision = vehiculo.transmision;
  if (!TRANSMISIONES.includes(transmision)) return 'Transmisión no reconocida.';

  if (b.urgencia != null && !URGENCIAS.includes(b.urgencia)) return 'Urgencia no reconocida.';
  if (b.confianzaDato != null && !CONFIANZAS.includes(b.confianzaDato)) return 'Nivel de confianza no reconocido.';

  if (b.certezaBase != null) {
    const certeza = Number(b.certezaBase);
    if (!Number.isFinite(certeza) || certeza < 0 || certeza > 1) {
      return 'La certeza base debe estar entre 0 y 1.';
    }
  }
  return null;
}

// El cuerpo que Prolog entiende. Vive en una funcion porque aparece en el POST,
// en el PUT y en el bootstrap: tres copias se separan en cuanto uno de los tres
// anade un campo y los otros dos no.
function payloadProlog(doc) {
  return {
    nombre: doc.nombre,
    sintomas: doc.sintomas || [],
    vehiculo: doc.vehiculo || {},
    causas: doc.causas || [],
    solucion: doc.solucion || '',
    procedimiento: doc.procedimiento || [],
    precioMin: doc.precioMin,
    precioMax: doc.precioMax,
    moneda: doc.moneda || 'MXN',
    prologId: doc.prologId,
    urgencia: doc.urgencia || 'media',
    confianzaDato: doc.confianzaDato || 'media',
    fuenteFalla: doc.fuenteFalla || 'Registrado por usuario (Administrador/Mecánico)',
    certezaBase: doc.certezaBase ?? 0.7,
  };
}

// El motor es una copia de trabajo, no la fuente de verdad: MongoDB ya guardo el
// cambio cuando esto corre. Si Prolog no responde se avisa y se sigue, porque
// perder la escritura seria peor que dejar el motor desfasado; el bootstrap del
// siguiente arranque vuelve a poner todo. Por eso no es await: la peticion
// responde sin esperar al motor.
function sincronizarFallaConProlog(doc) {
  fetch(`${PROLOG_BASE}/api/fallas`, {
    method: 'POST',
    headers: CABECERAS_MOTOR,
    body: JSON.stringify(payloadProlog(doc)),
    signal: AbortSignal.timeout(PROLOG_TIMEOUT_MS),
  }).catch((err) => {
    console.warn(`[prolog] Falla ${doc.prologId} no sincronizada: ${err.message}`);
  });
}

// --- Sesion ---
// El 401 es el mismo para usuario inexistente y para contraseña incorrecta a
// proposito: distinguirlos le diria a quien prueba si ese usuario existe.
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const usuario = await User.findOne({
      username: typeof username === 'string' ? username.toLowerCase() : '',
      activo: true,
    });
    const coincide = usuario && (await bcrypt.compare(String(password ?? ''), usuario.passwordHash));
    if (!coincide) return res.status(401).json({ error: 'Credenciales inválidas' });

    // En la sesion va solo el identificador. El rol NO se copia aqui a proposito:
    // una segunda copia es una segunda fuente de verdad, y `requireAdmin` relee
    // la cuenta para que una degradacion de rol surta efecto en la peticion
    // siguiente y no "al proximo inicio de sesion".
    req.session.userId = usuario._id.toString();
    res.json({
      id: usuario._id,
      username: usuario.username,
      nombre: usuario.nombre,
      role: usuario.role,
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Se revalida contra MongoDB en cada llamada en vez de confiar solo en la sesion:
// si el usuario fue desactivado mientras su cookie sigue viva, la sesion por si
// sola lo daria por autenticado.
app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const usuario = await User.findById(req.session.userId).lean();
    if (!usuario?.activo) {
      req.session.destroy(() => res.status(401).json({ error: 'Sesión inválida' }));
      return;
    }
    res.json({
      id: usuario._id,
      username: usuario.username,
      nombre: usuario.nombre,
      role: usuario.role,
    });
  } catch (err) {
    next(err);
  }
});

// --- Usuarios ---
// Todo el CRUD es de administrador. El hash nunca sale: `select('-passwordHash')`
// en cada lectura, y las respuestas se construyen a mano en vez de devolver el
// documento, para que un campo nuevo no empiece a filtrar el hash por olvido.
app.get('/api/usuarios', requireAdmin, async (_req, res, next) => {
  try {
    const usuarios = await User.find().select('-passwordHash').sort({ username: 1 }).lean();
    res.json(usuarios);
  } catch (err) {
    next(err);
  }
});

app.post('/api/usuarios', requireAdmin, async (req, res, next) => {
  try {
    const { username, password, role, nombre } = req.body || {};
    const usuario = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido.' });
    }
    // 11000 es el codigo de clave duplicada de Mongo. Traducirlo a 409 evita que
    // el cliente vea un 500 por escribir un usuario que ya existe.
    if (await User.exists({ username: usuario })) {
      return res.status(409).json({ error: 'Ese usuario ya existe.' });
    }
    const creado = await User.create({
      username: usuario,
      passwordHash: await bcrypt.hash(String(password), 10),
      role,
      nombre: nombre || undefined,
    });
    res.status(201).json({
      id: creado._id,
      username: creado.username,
      nombre: creado.nombre,
      role: creado.role,
      activo: creado.activo,
    });
  } catch (err) {
    next(err);
  }
});

// --- Regla del ultimo administrador ---
// Degradar o desactivar al unico administrador deja la instalacion sin forma de
// entrar por la interfaz, y recuperar eso exige tocar la base a mano. La regla
// necesita dos operaciones (contar y luego escribir), asi que sin mas dos
// peticiones simultaneas podrian ver cada una "hay otro" y dejar la cuenta en
// cero. Se serializan con una cadena de promesas en este proceso: la
// instalacion es de un solo backend, asi que alcanza; con varias instancias
// haria falta una transaccion o un contador en un documento unico.
let candadoUsuarios = Promise.resolve();

function conCandado(fn) {
  const siguiente = candadoUsuarios.then(fn, fn);
  candadoUsuarios = siguiente.then(
    () => {},
    () => {}
  );
  return siguiente;
}

// Responde si la cuenta, con el cambio propuesto, seria el ultimo
// administrador activo. `role`/`activo` sin definir significan "se queda como
// esta", que es como se llama desde la desactivacion y desde una edicion que no
// toca ninguno de los dos.
async function ultimaAdminSeQuedariaFuera(objetivo, { role, activo } = {}) {
  const quedaActivo = activo === undefined ? objetivo.activo : Boolean(activo);
  const quedaComoAdmin =
    quedaActivo && (role === undefined ? objetivo.role : role) === 'administrador_mecanico';

  // Si el objetivo no es hoy un administrador activo, o si el cambio no le quita
  // el rol, no hay nada que proteger.
  if (objetivo.role !== 'administrador_mecanico' || !objetivo.activo || quedaComoAdmin) {
    return false;
  }

  const otros = await User.countDocuments({
    role: 'administrador_mecanico',
    activo: true,
    _id: { $ne: objetivo._id },
  });
  return otros === 0;
}

// Los campos ausentes se dejan como estan: es un PATCH disfrazado de PUT, que es
// lo que necesita el formulario de edicion, donde la contraseña se reescribe
// solo si el administrador escribe una nueva.
app.put('/api/usuarios/:id', requireAdmin, async (req, res, next) => {
  try {
    const { password, role, nombre, activo } = req.body || {};
    if (role != null && !ROLES.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido.' });
    }

    const objetivo = await User.findById(req.params.id);
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // El hash se calcula antes del candado: son ~100 ms de CPU y no necesita
    // serializarse, mientras que el conteo y el guardado si.
    const hash = password ? await bcrypt.hash(String(password), 10) : null;

    const error = await conCandado(async () => {
      if (await ultimaAdminSeQuedariaFuera(objetivo, { role, activo })) {
        return 'Debe quedar al menos un administrador activo.';
      }
      if (role != null) objetivo.role = role;
      if (nombre != null) objetivo.nombre = nombre;
      if (activo != null) objetivo.activo = Boolean(activo);
      if (hash) objetivo.passwordHash = hash;
      await objetivo.save();
      return null;
    });
    if (error) return res.status(400).json({ error });

    res.json({
      id: objetivo._id,
      username: objetivo.username,
      nombre: objetivo.nombre,
      role: objetivo.role,
      activo: objetivo.activo,
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/usuarios/:id', requireAdmin, async (req, res, next) => {
  try {
    const objetivo = await User.findById(req.params.id);
    if (!objetivo) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const error = await conCandado(async () => {
      if (await ultimaAdminSeQuedariaFuera(objetivo, { activo: false })) {
        return 'Debe quedar al menos un administrador activo.';
      }
      // Borrado logico, igual que las fallas: desactivar deja constancia de que la
      // cuenta existio y de quien la creo.
      objetivo.activo = false;
      await objetivo.save();
      return null;
    });
    if (error) return res.status(400).json({ error });

    res.json({ ok: true, softDeleted: true });
  } catch (err) {
    next(err);
  }
});

// --- Mi perfil ---
// Edicion de la propia cuenta. Un administrador puede cambiarlo todo (usuario,
// nombre, contraseña y su propio rol, incluso degradarse a estudiante); un
// estudiante solo su nombre y su contraseña. `role`/`username` de un estudiante
// se ignoran a proposito: sin esta rama, un estudiante podria ascenderse solo.
// El cambio de rol reutiliza la regla del ultimo administrador, porque degradar
// a la unica cuenta activa dejaria la instalacion sin nadie que pueda entrar.
app.put('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const cuenta = await User.findById(req.session.userId);
    if (!cuenta?.activo) {
      req.session.destroy(() => res.status(401).json({ error: 'Sesión inválida' }));
      return;
    }

    const esAdmin = cuenta.role === 'administrador_mecanico';
    const { username, nombre, password, role } = req.body || {};

    if (nombre != null) cuenta.nombre = nombre;

    // La contraseña se reescribe solo si llega algo: vacio significa "dejarla
    // como esta", igual que en el formulario de edicion del administrador.
    const hash = password ? await bcrypt.hash(String(password), 10) : null;

    // Solo el administrador cambia su usuario. Si el suyo ya esta tomado, hay
    // que elegir otro: el indice unico de `username` no admite duplicados.
    let usernameNuevo = null;
    if (esAdmin && typeof username === 'string' && username.trim()) {
      usernameNuevo = username.trim().toLowerCase();
      if (usernameNuevo !== cuenta.username && (await User.exists({ username: usernameNuevo }))) {
        return res.status(409).json({ error: 'Ese usuario ya existe.' });
      }
    }

    const roleNuevo = esAdmin && role != null ? role : undefined;
    if (roleNuevo !== undefined && !ROLES.includes(roleNuevo)) {
      return res.status(400).json({ error: 'Rol inválido.' });
    }

    const error = await conCandado(async () => {
      if (await ultimaAdminSeQuedariaFuera(cuenta, { role: roleNuevo })) {
        return 'Debe quedar al menos un administrador activo.';
      }
      if (usernameNuevo) cuenta.username = usernameNuevo;
      if (roleNuevo !== undefined) cuenta.role = roleNuevo;
      if (hash) cuenta.passwordHash = hash;
      await cuenta.save();
      return null;
    });
    if (error) return res.status(400).json({ error });

    res.json({
      id: cuenta._id,
      username: cuenta.username,
      nombre: cuenta.nombre,
      role: cuenta.role,
    });
  } catch (err) {
    next(err);
  }
});

// --- Fallas registradas por el usuario ---
// Esta lista es la de administracion (lo capturado por el administrador), no el
// catalogo que consume el diagnostico: ese lo sigue leyendo el gateway a Prolog,
// que ya devuelve estaticas y dinamicas juntas.
app.get('/api/fallas', requireAdmin, async (req, res, next) => {
  try {
    const incluirEliminadas = req.query.includeDeleted === 'true';
    const filtro = incluirEliminadas ? {} : { deletedAt: null };
    // El autor se resuelve con populate, que es la capa que sabe sustituir un
    // ObjectId por su documento. Asignar el objeto encontrado encima del campo
    // a mano lo pasa por el casteo del schema y el hash de la relacion se
    // convierte en un id roto.
    const fallas = await Falla.find(filtro)
      .sort({ createdAt: -1 })
      .populate('creadoPor', 'username nombre')
      .lean();
    res.json(fallas);
  } catch (err) {
    next(err);
  }
});

app.post('/api/fallas', requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const error = validarFalla(b);
    if (error) return res.status(400).json({ error });

    const prologId = slugPrologId(b.nombre);
    // El indice unico es parcial sobre `deletedAt: null`, asi que este es el
    // unico filtro que decide si el identificador esta libre.
    if (await Falla.exists({ prologId, deletedAt: null })) {
      return res.status(409).json({ error: `Ya existe una falla con el identificador "${prologId}".` });
    }

    const creada = await Falla.create({
      nombre: b.nombre.trim(),
      prologId,
      sintomas: b.sintomas.map((s) => s.trim()).filter(Boolean),
      vehiculo: normalizarVehiculo(b.vehiculo),
      causas: (b.causas || []).filter(Boolean),
      solucion: b.solucion || '',
      procedimiento: (b.procedimiento || []).filter(Boolean),
      precioMin: Number(b.precioMin),
      precioMax: Number(b.precioMax),
      // La cuenta la revalidó requireAdmin en esta misma peticion, así que el
      // autor no depende de lo que la sesión diga de sí misma.
      creadoPor: req.admin._id,
      activo: true,
      deletedAt: null,
      confianzaDato: b.confianzaDato || 'media',
      urgencia: b.urgencia || 'media',
      certezaBase: b.certezaBase != null ? Number(b.certezaBase) : 0.7,
    });

    sincronizarFallaConProlog(creada);
    res.status(201).json(creada);
  } catch (err) {
    next(err);
  }
});

app.put('/api/fallas/:id', requireAdmin, async (req, res, next) => {
  try {
    const falla = await Falla.findById(req.params.id);
    if (!falla || falla.deletedAt) {
      return res.status(404).json({ error: 'Falla no encontrada.' });
    }

    // Se valida el documento completo ya fusionado, no solo el cuerpo: si el
    // formulario edita el precio minimo y lo deja por encima del maximo, el
    // resultado tiene que ser rechazado aunque el cuerpo sea coherente.
    const b = { ...falla.toObject(), ...req.body };
    const error = validarFalla(b);
    if (error) return res.status(400).json({ error });

    falla.nombre = b.nombre.trim();
    falla.sintomas = b.sintomas.map((s) => s.trim()).filter(Boolean);
    falla.vehiculo = normalizarVehiculo(b.vehiculo);
    falla.causas = (b.causas || []).filter(Boolean);
    falla.solucion = b.solucion || '';
    falla.procedimiento = (b.procedimiento || []).filter(Boolean);
    falla.precioMin = Number(b.precioMin);
    falla.precioMax = Number(b.precioMax);
    falla.confianzaDato = b.confianzaDato || 'media';
    falla.urgencia = b.urgencia || 'media';
    falla.certezaBase = b.certezaBase != null ? Number(b.certezaBase) : 0.7;
    await falla.save();

    // El prologId no se recalcula al renombrar: es el identificador con el que la
    // falla ya se afirmo en Prolog y con el que se borraria. Regenerarlo dejaria
    // reglas huerfanas apuntando al nombre viejo.
    sincronizarFallaConProlog(falla);
    res.json(falla);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/fallas/:id', requireAdmin, async (req, res, next) => {
  try {
    const falla = await Falla.findById(req.params.id);
    if (!falla || falla.deletedAt) {
      return res.status(404).json({ error: 'Falla no encontrada.' });
    }

    falla.activo = false;
    falla.deletedAt = new Date();
    await falla.save();

    fetch(`${PROLOG_BASE}/api/fallas?prologId=${encodeURIComponent(falla.prologId)}`, {
      method: 'DELETE',
      headers: CABECERAS_MOTOR,
      signal: AbortSignal.timeout(PROLOG_TIMEOUT_MS),
    }).catch((err) => {
      console.warn(`[prolog] Falla ${falla.prologId} no retractada: ${err.message}`);
    });

    res.json({ ok: true, softDeleted: true });
  } catch (err) {
    next(err);
  }
});

// --- Manejo central de errores ---
// Los handlers delegan con next(err) y aqui se decide que se responde. El
// detalle real del error nunca sale al cliente en 5xx: solo queda en el log.
app.use((err, _req, res, _next) => {
  // Un ValidationError o un CastError los provoca el cuerpo de la peticion, no el
  // servidor: son 400, no 500. Su mensaje interno menciona rutas del schema
  // (Path "fallas.0.certeza"), asi que tampoco se reenvia tal cual.
  if (err.name === 'ValidationError' || err.name === 'CastError') {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[error ${status}]`, err);
    return res.status(status).json({ error: 'Error interno del servidor' });
  }
  return res.status(status).json({ error: err.message || 'Solicitud inválida' });
});

app.listen(PUERTO, () => {
  console.log(`API escuchando en http://localhost:${PUERTO}`);
});
