const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PUERTO = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/car_care_system';

// Motor de inferencia Prolog. El navegador ya no lo llama directo: todo pasa por
// este gateway same-origin, de modo que el frontend funciona igual en dev (proxy
// de Vite) y en produccion (nginx -> Express -> Prolog), sin CORS ni HTTP mixto.
const PROLOG_BASE = process.env.PROLOG_BASE || 'http://localhost:8000';
const PROLOG_TIMEOUT_MS = Number(process.env.PROLOG_TIMEOUT_MS) || 3000;
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
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

mongoose
  .connect(MONGO_URI)
  .then(() => console.log(`MongoDB conectado: ${MONGO_URI}`))
  .catch((err) => {
    console.error('Error conectando a MongoDB:', err.message);
    process.exit(1);
  });

// --- Gateway same-origin hacia el motor Prolog ---
// `req.url` ya viene sin el prefijo de montaje: /api/prolog/api/sintomas ->
// http://localhost:8000/api/sintomas
app.use('/api/prolog', async (req, res, next) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROLOG_TIMEOUT_MS);
  try {
    const init = {
      method: req.method,
      headers: { 'Content-Type': req.headers['content-type'] || 'application/json' },
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
  const fecha = new Date().toISOString().slice(0, 10);
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
      // El motor solo emite certezas en (0, 1] (validar_kb lo comprueba). Sin
      // estos límites, un cliente podría guardar certeza: 99 y envenenar los
      // promedios de /api/stats/certeza.
      certeza: { type: Number, required: true, min: 0, max: 1 },
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
app.get('/api/stats/certeza', async (_req, res, next) => {
  try {
    const porFalla = await Diagnostico.aggregate([
      { $unwind: '$fallas' },
      {
        $group: {
          _id: '$fallas.falla',
          veces: { $sum: 1 },
          certeza_promedio: { $avg: '$fallas.certeza' },
        },
      },
      { $sort: { veces: -1 } },
    ]);

    const totales = await Diagnostico.aggregate([
      { $unwind: '$fallas' },
      {
        $group: {
          _id: null,
          promedio_global: { $avg: '$fallas.certeza' },
          total_consultas: { $sum: 1 },
          total_fallas_inferidas: { $count: {} },
        },
      },
    ]);

    res.json({
      total_consultas: (totales[0] && totales[0].total_consultas) || 0,
      total_fallas_inferidas: (totales[0] && totales[0].total_fallas_inferidas) || 0,
      certeza_promedio_global: (totales[0] && totales[0].promedio_global) || 0,
      por_falla: porFalla
        .map((f) => ({
          falla: f._id,
          veces: f.veces,
          certeza_promedio: Math.round(f.certeza_promedio * 100) / 100,
        }))
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

  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`[error ${status}]`, err);
    return res.status(status).json({ error: 'Error interno del servidor' });
  }
  return res.status(status).json({ error: err.message || 'Solicitud inválida' });
});

app.listen(PUERTO, () => {
  console.log(`API escuchando en http://localhost:${PUERTO}`);
});