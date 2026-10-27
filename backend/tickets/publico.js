const express = require('express');
const rateLimit = require('express-rate-limit');

const { buscarPorToken, hashToken, estaVencido } = require('./token');
const { cambiarEstado, vencerExpirada } = require('./transiciones');
const { COMENTARIO_MAX, MOTIVOS_RECHAZO } = require('./modelo');

const ERROR_GENERICO = Object.freeze({ error: 'Enlace no válido o vencido' });
const ERROR_DATOS = Object.freeze({ error: 'Datos no válidos' });
const ERROR_INTERNO = Object.freeze({ error: 'Error interno' });
const DECISIONES = ['autorizar', 'rechazar'];
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
// C0 sin \n (permite salto de linea) y DEL.
const CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F]/;

function tokenValido(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

function decisionValida(decision) {
  return DECISIONES.includes(decision);
}

// Normaliza lo que acompana a un rechazo. Devuelve null si no cumple; si
// cumple, solo las claves que de verdad vienen (sin undefined).
function prepararRechazo({ motivo, comentario } = {}) {
  if (motivo !== undefined && !MOTIVOS_RECHAZO.includes(motivo)) return null;
  if (comentario !== undefined && typeof comentario !== 'string') return null;

  const limpio =
    typeof comentario === 'string' ? comentario.replace(/\r\n/g, '\n').trim() : '';
  if (limpio.length > COMENTARIO_MAX || CONTROL_RE.test(limpio)) return null;

  const salida = {};
  if (motivo !== undefined) salida.motivo = motivo;
  if (limpio) salida.comentario = limpio;
  return salida;
}

function aplicarCabeceras(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
}

function responderGenerico(res) {
  return res.status(404).json(ERROR_GENERICO);
}

function primerNombre(nombre) {
  return String(nombre ?? '').trim().split(/\s+/)[0] || '';
}

function esTasaEstimada(fuente) {
  return fuente === 'constante' || fuente === 'estimada';
}

function fechaISO(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString();
}

// Lista blanca explicita: lo que no este aqui no sale del servidor.
function vistaTicketPublico(ticket) {
  const cotizacion = ticket.cotizacion || {};
  const tipoCambio = cotizacion.tipoCambio || {};
  return {
    vehiculo: {
      marca: ticket.vehiculo?.marca || '',
      modelo: ticket.vehiculo?.modelo || '',
      anio: ticket.vehiculo?.anio ?? 0,
    },
    fallas: (ticket.fallas || []).map((falla) => String(falla.nombre ?? '')),
    totalMinMXN: cotizacion.totalMinMXN,
    totalMaxMXN: cotizacion.totalMaxMXN,
    totalMinUSD: cotizacion.totalMinUSD,
    totalMaxUSD: cotizacion.totalMaxUSD,
    tipoCambio: {
      fecha: String(tipoCambio.fecha ?? ''),
      fuente: String(tipoCambio.fuente ?? ''),
    },
    tasaEstimada: esTasaEstimada(tipoCambio.fuente),
    leyenda: String(cotizacion.leyenda ?? ''),
    vigenteHasta: fechaISO(ticket.tokenVenceEn),
    cliente: { nombre: primerNombre(ticket.cliente?.nombre) },
  };
}

function crearRutasPublicas({
  Ticket,
  limite = 20,
  ventanaMs = 15 * 60 * 1000,
  desactivarLimites = false,
} = {}) {
  const router = express.Router();

  router.use((_req, res, next) => {
    aplicarCabeceras(res);
    next();
  });

  router.use(
    rateLimit({
      windowMs: ventanaMs,
      limit: limite,
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => desactivarLimites,
      message: { error: 'Demasiadas peticiones. Intenta mas tarde.' },
    })
  );

  router.post('/cotizacion/consultar', async (req, res, next) => {
    const { token } = req.body || {};
    if (!tokenValido(token)) return responderGenerico(res);

    try {
      const ticket = await buscarPorToken(Ticket, token);
      if (!ticket || ticket.estado !== 'cotizacion_enviada') return responderGenerico(res);

      const ahora = new Date();
      if (estaVencido(ticket.tokenVenceEn, ahora)) {
        await vencerExpirada(Ticket, { id: ticket._id, ahora });
        return responderGenerico(res);
      }

      return res.json(vistaTicketPublico(ticket));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/cotizacion/decidir', async (req, res, next) => {
    const { token, decision, motivo, comentario } = req.body || {};
    if (!tokenValido(token) || !decisionValida(decision)) return responderGenerico(res);

    // Validacion previa a la base: un rechazo mal formado no depende del token.
    const esRechazo = decision === 'rechazar';
    const rechazo = esRechazo ? prepararRechazo({ motivo, comentario }) : {};
    if (!rechazo) return res.status(422).json(ERROR_DATOS);

    try {
      const ahora = new Date();
      const ticket = await buscarPorToken(Ticket, token);
      if (!ticket || ticket.estado !== 'cotizacion_enviada') return responderGenerico(res);

      if (estaVencido(ticket.tokenVenceEn, ahora)) {
        await vencerExpirada(Ticket, { id: ticket._id, ahora });
        return responderGenerico(res);
      }

      const estado = esRechazo ? 'rechazado' : 'autorizado';
      const decisionGuardada = { resultado: estado, en: ahora };
      if (esRechazo) Object.assign(decisionGuardada, rechazo);

      const actualizado = await cambiarEstado(Ticket, {
        id: ticket._id,
        de: 'cotizacion_enviada',
        a: estado,
        por: null,
        ahora,
        tokenHash: hashToken(token),
        exigirToken: true,
        agregar: { decisiones: decisionGuardada },
      });

      if (!actualizado) {
        // Si el token vencio entre la lectura y el update, el filtro atomico
        // falla y aqui se cierra el ticket como vencido.
        const actual = await buscarPorToken(Ticket, token);
        if (actual && estaVencido(actual.tokenVenceEn, ahora)) {
          await vencerExpirada(Ticket, { id: actual._id, ahora });
        }
        return responderGenerico(res);
      }

      return res.json({ estado: actualizado.estado });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function montarTicketsPublico(app, config, deps = {}) {
  if (!config?.ticketsEnabled) return false;
  app.use('/api/publico', crearRutasPublicas(deps));
  return true;
}

// Express solo reconoce un manejador de errores si declara cuatro argumentos.
function manejarErrorPublico(error, _req, res, _next) {
  aplicarCabeceras(res);
  if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    return responderGenerico(res);
  }
  return res.status(500).json(ERROR_INTERNO);
}

module.exports = {
  ERROR_GENERICO,
  ERROR_DATOS,
  crearRutasPublicas,
  montarTicketsPublico,
  manejarErrorPublico,
  tokenValido,
  decisionValida,
  prepararRechazo,
  vistaTicketPublico,
};
