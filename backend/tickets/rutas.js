const express = require('express');
const mongoose = require('mongoose');

const { esClaveDuplicada, codigoErrorValido } = require('./modelo');
const {
  cambiarEstado,
  puedeTransicionar,
  vencerExpirada,
} = require('./transiciones');
const { generarToken, hashToken, calcularVencimiento } = require('./token');
const {
  calcularCotizacion,
  precioCatalogoEnMXN,
  centavosPrecioFinal,
  LEYENDA_PRECIO_FINAL,
} = require('./cotizacion');
const { construirEnlace } = require('./correo');

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 100;
const LIMITE_ATENCION = 200;
const ESTADOS_MECANICO = ['en_reparacion', 'terminado', 'cancelado'];
const ESTADOS_ATENCION = ['autorizado', 'rechazado', 'vencido'];

function idValido(id) {
  return mongoose.isValidObjectId(id);
}

// Whitelist de lo unico que una respuesta puede decir del envio.
const CAMPOS_ENVIO = ['enviado', 'intentos', 'codigoError', 'ultimoIntentoEn'];

function sinToken(documento) {
  const objeto = typeof documento?.toObject === 'function' ? documento.toObject() : documento;
  const copia = { ...objeto };
  delete copia.tokenHash;
  delete copia.tokenVenceEn;
  if (copia.envio) {
    copia.envio = CAMPOS_ENVIO.reduce((acc, campo) => {
      if (copia.envio[campo] !== undefined) acc[campo] = copia.envio[campo];
      return acc;
    }, {});
  }
  return copia;
}

// La lista solo muestra el resultado de la ultima decision y su motivo: el
// comentario se queda en el detalle.
function paraLista(ticket) {
  const copia = sinToken(ticket);
  delete copia.decisiones;
  const lista = Array.isArray(ticket.decisiones) ? ticket.decisiones : [];
  const ultima = lista[lista.length - 1];
  if (ultima) {
    copia.ultimaDecision = { resultado: ultima.resultado };
    if (ultima.motivo !== undefined) copia.ultimaDecision.motivo = ultima.motivo;
  }
  return copia;
}

function limite(valor) {
  const n = Number.parseInt(String(valor ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, LIMITE_MAXIMO) : LIMITE_POR_DEFECTO;
}

function desplazamiento(valor) {
  const n = Number.parseInt(String(valor ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function textoVehiculo(vehiculo) {
  return [vehiculo?.marca, vehiculo?.modelo, vehiculo?.anio]
    .filter((parte) => parte !== undefined && parte !== null && parte !== '' && parte !== 0)
    .join(' ');
}

function resumenTicket(ticket) {
  const cotizacion = ticket.cotizacion || {};
  return {
    vehiculo: textoVehiculo(ticket.vehiculo),
    fallas: (ticket.fallas || []).map((falla) => falla.nombre),
    precioFinalMXN: cotizacion.precioFinalMXN,
    precioFinalUSD: cotizacion.precioFinalUSD,
    leyenda: LEYENDA_PRECIO_FINAL,
    tipoCambio: cotizacion.tipoCambio,
  };
}

// Una sola consulta de candidatos; vencerExpirada es atomica por ticket, asi
// que dos listados simultaneos solo dejan una transicion a vencido.
async function vencerCandidatos(Ticket) {
  const ahora = new Date();
  const candidatos = await Ticket.find({
    estado: 'cotizacion_enviada',
    tokenVenceEn: { $lte: ahora },
  })
    .select('_id')
    .limit(LIMITE_ATENCION)
    .lean();

  await Promise.all(
    (Array.isArray(candidatos) ? candidatos : []).map((ticket) =>
      vencerExpirada(Ticket, { id: ticket._id, ahora })
    )
  );
}

function codigoDeEnvio(error) {
  return codigoErrorValido(error?.codigo) ? error.codigo : 'desconocido';
}

// Registra el resultado del intento. En exito se borra el codigo y la fecha del
// ultimo intento se conserva (actualizada); en fallo se guarda el codigo fijo.
async function registrarIntento(Ticket, id, enviado, codigo) {
  const update = {
    $set: {
      'envio.enviado': enviado,
      'envio.ultimoIntentoEn': new Date(),
    },
    $inc: { 'envio.intentos': 1 },
  };
  if (enviado) {
    update.$unset = { 'envio.codigoError': '' };
  } else {
    update.$set['envio.codigoError'] = codigo;
  }
  return Ticket.updateOne({ _id: id }, update);
}

async function catalogoDelMotor({ pedirAMotor, cabecerasMotor }) {
  let resultado;
  try {
    resultado = await pedirAMotor('/api/fallas', { method: 'GET', headers: cabecerasMotor });
  } catch (error) {
    throw Object.assign(new Error('No se pudo consultar el catalogo.'), { status: 502, cause: error });
  }
  if (!resultado?.respuesta?.ok) {
    throw Object.assign(new Error('No se pudo consultar el catalogo.'), { status: 502 });
  }
  let datos;
  try {
    datos = JSON.parse(resultado.cuerpo);
  } catch {
    throw Object.assign(new Error('El catalogo no es JSON valido.'), { status: 502 });
  }
  if (!Array.isArray(datos?.fallas)) {
    throw Object.assign(new Error('El catalogo no trae fallas.'), { status: 502 });
  }
  return datos.fallas;
}

function crearRutasTickets({
  Ticket,
  Diagnostico,
  requireAuth,
  requireAdmin,
  pedirAMotor,
  cabecerasMotor,
  config,
  mailer,
}) {
  const router = express.Router();
  router.use(requireAuth, requireAdmin);

  router.get('/atencion', async (req, res, next) => {
    try {
      await vencerCandidatos(Ticket);
      const tickets = await Ticket.find({ estado: { $in: ESTADOS_ATENCION } })
        .select('_id diagnosticoId estado')
        .sort({ creadoEn: -1 })
        .limit(LIMITE_ATENCION)
        .lean();
      return res.json({
        tickets: tickets.map((ticket) => ({
          ticketId: ticket._id,
          diagnosticoId: ticket.diagnosticoId,
          estado: ticket.estado,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      await vencerCandidatos(Ticket);
      const tamano = limite(req.query.limit);
      const salto = desplazamiento(req.query.offset);
      const [tickets, total] = await Promise.all([
        Ticket.find({})
          .select('-tokenHash -tokenVenceEn')
          .sort({ creadoEn: -1 })
          .skip(salto)
          .limit(tamano)
          .lean(),
        Ticket.countDocuments({}),
      ]);
      res.json({ tickets: tickets.map(paraLista), total, limit: tamano, offset: salto });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      if (!idValido(req.params.id)) {
        return res.status(400).json({ error: 'Identificador inválido' });
      }
      const ticket = await Ticket.findById(req.params.id)
        .select('-tokenHash -tokenVenceEn')
        .lean();
      if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
      return res.json(sinToken(ticket));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { diagnosticoId, fallasIds, cliente } = req.body || {};
      if (!idValido(diagnosticoId)) {
        return res.status(400).json({ error: 'Datos inválidos' });
      }
      if (
        !Array.isArray(fallasIds) ||
        fallasIds.length === 0 ||
        !fallasIds.every((id) => typeof id === 'string' && id.trim() !== '')
      ) {
        return res.status(400).json({ error: 'Datos inválidos' });
      }
      if (!cliente || typeof cliente !== 'object' || Array.isArray(cliente)) {
        return res.status(400).json({ error: 'Datos inválidos' });
      }

      const diagnostico = await Diagnostico.findById(diagnosticoId).lean();
      if (!diagnostico) return res.status(404).json({ error: 'Diagnóstico no encontrado' });

      const idsDiagnostico = new Set(
        (diagnostico.fallas || []).map((falla) => String(falla.falla))
      );
      const catalogo = await catalogoDelMotor({ pedirAMotor, cabecerasMotor });
      const porId = new Map(catalogo.map((falla) => [String(falla.id), falla]));
      const seleccion = [];

      for (const valor of fallasIds) {
        const id = valor.trim();
        if (!idsDiagnostico.has(id)) {
          return res.status(422).json({ error: 'La falla no pertenece al diagnóstico' });
        }
        const fallaCatalogo = porId.get(id);
        if (!fallaCatalogo) {
          return res.status(422).json({ error: 'La falla no está en el catálogo' });
        }
        let precios;
        try {
          precios = precioCatalogoEnMXN(fallaCatalogo, diagnostico.tipo_cambio);
        } catch {
          return res.status(422).json({ error: 'Precios del catálogo inválidos' });
        }
        seleccion.push({
          falla: id,
          nombre: fallaCatalogo.nombre || id,
          ...precios,
        });
      }

      let cotizacion;
      try {
        cotizacion = calcularCotizacion({
          fallasSeleccionadas: seleccion,
          fallasDiagnostico: diagnostico.fallas,
          tipoCambio: diagnostico.tipo_cambio,
        });
      } catch {
        return res.status(422).json({ error: 'No se pudo calcular la cotización' });
      }

      const origenPorId = new Map(seleccion.map((falla) => [falla.falla, falla]));
      const fallas = cotizacion.fallas.map((falla) => {
        const origen = origenPorId.get(falla.falla);
        return {
          ...falla,
          monedaOrigen: origen.monedaOrigen,
          costoMinOrigen: origen.costoMinOrigen,
          costoMaxOrigen: origen.costoMaxOrigen,
        };
      });

      const creado = await Ticket.create({
        diagnosticoId: diagnostico._id,
        creadoPor: req.session.userId,
        cliente,
        vehiculo: diagnostico.vehiculo || {},
        fallas,
        cotizacion: {
          totalMinMXN: cotizacion.totalMinMXN,
          totalMaxMXN: cotizacion.totalMaxMXN,
          totalMinUSD: cotizacion.totalMinUSD,
          totalMaxUSD: cotizacion.totalMaxUSD,
          tipoCambio: cotizacion.tipoCambio,
          leyenda: cotizacion.leyenda,
        },
        estado: 'diagnosticado',
      });
      return res.status(201).json(sinToken(creado));
    } catch (error) {
      if (esClaveDuplicada(error)) {
        return res.status(409).json({ error: 'El ticket ya existe' });
      }
      if (error?.name === 'ValidationError') {
        return res.status(400).json({ error: 'Datos inválidos' });
      }
      return next(error);
    }
  });

  router.post('/:id/enviar', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!idValido(id)) return res.status(400).json({ error: 'Identificador inválido' });

      // Se valida antes de tocar Mongo: un precio ausente o con mas de dos
      // decimales no puede dejar rastro en el ticket.
      const centavos = centavosPrecioFinal(req.body?.precioFinalMXN);
      if (centavos === null) {
        return res.status(422).json({ error: 'Datos no válidos' });
      }

      const ticket = await Ticket.findById(id);
      if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });

      const tasa = Number(ticket.cotizacion?.tipoCambio?.usd_mxn);
      if (!Number.isFinite(tasa) || tasa <= 0) {
        return res.status(422).json({ error: 'Datos no válidos' });
      }

      const precioMXN = centavos / 100;
      const precioUSD = Math.round(centavos / tasa) / 100;
      const ahora = new Date();
      const precioSet = {
        'cotizacion.precioFinalMXN': precioMXN,
        'cotizacion.precioFinalUSD': precioUSD,
        'cotizacion.leyenda': LEYENDA_PRECIO_FINAL,
      };
      const precioEntrada = {
        precioFinalMXN: precioMXN,
        en: ahora,
        por: req.session.userId,
      };
      const tokenVenceEn = calcularVencimiento(ahora);

      let actualizado;
      let token;
      if (
        ticket.estado === 'diagnosticado' ||
        ticket.estado === 'vencido' ||
        ticket.estado === 'rechazado'
      ) {
        token = generarToken();
        actualizado = await cambiarEstado(Ticket, {
          id,
          de: ticket.estado,
          a: 'cotizacion_enviada',
          por: req.session.userId,
          ahora,
          establecer: {
            tokenHash: hashToken(token),
            tokenVenceEn,
            ...precioSet,
            // El correo de este intento aun no ha salido.
            'envio.enviado': false,
          },
          agregar: { precios: precioEntrada },
        });
      } else if (ticket.estado === 'cotizacion_enviada' && !ticket.envio?.enviado) {
        token = generarToken();
        actualizado = await Ticket.findOneAndUpdate(
          { _id: id, estado: 'cotizacion_enviada', 'envio.enviado': false },
          {
            $set: {
              tokenHash: hashToken(token),
              tokenVenceEn,
              actualizadoEn: ahora,
              ...precioSet,
            },
            $push: { precios: precioEntrada },
          },
          { new: true }
        );
      } else if (ticket.estado === 'cotizacion_enviada') {
        return res.status(409).json({ error: 'La cotización ya fue enviada' });
      } else {
        return res.status(409).json({ error: 'El ticket no se puede enviar en su estado actual' });
      }

      if (!actualizado) {
        return res.status(409).json({ error: 'El estado del ticket cambió; vuelve a intentarlo' });
      }

      const enlace = construirEnlace(config.publicAppUrl, token);
      let resultado;
      try {
        resultado = await mailer.enviarCotizacion({
          para: actualizado.cliente.correo,
          nombre: actualizado.cliente.nombre,
          enlace,
          resumen: resumenTicket(actualizado),
        });
      } catch (error) {
        const codigo = codigoDeEnvio(error);
        await registrarIntento(Ticket, id, false, codigo);
        console.error(`[correo] ticket=${id} codigo=${codigo}`);
        return res.status(502).json({ error: 'No se pudo enviar la cotización' });
      }

      if (resultado?.omitido) {
        await registrarIntento(Ticket, id, false, 'sin_proveedor');
        console.error(`[correo] ticket=${id} codigo=sin_proveedor`);
        return res.status(502).json({ error: 'No se pudo enviar la cotización' });
      }

      await registrarIntento(Ticket, id, true, '');
      const final = await Ticket.findById(id).select('-tokenHash -tokenVenceEn').lean();
      return res.json(final || sinToken(actualizado));
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id/estado', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!idValido(id)) return res.status(400).json({ error: 'Identificador inválido' });

      const a = String(req.body?.a || '');
      if (!ESTADOS_MECANICO.includes(a)) {
        return res.status(400).json({ error: 'Transición no permitida' });
      }

      const ticket = await Ticket.findById(id);
      if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
      if (!puedeTransicionar(ticket.estado, a)) {
        return res.status(409).json({ error: 'Transición no permitida' });
      }

      const actualizado = await cambiarEstado(Ticket, {
        id,
        de: ticket.estado,
        a,
        por: req.session.userId,
      });
      if (!actualizado) {
        return res.status(409).json({ error: 'El estado del ticket cambió; vuelve a intentarlo' });
      }
      return res.json(sinToken(actualizado));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

// El interruptor vive aqui para poder probar el apagado sin levantar un segundo
// servidor ni otro motor: si esta apagado, no se registra nada y el 404 global
// de server.js responde.
function montarTickets(app, config, deps = {}) {
  if (!config?.ticketsEnabled) return false;
  app.use('/api/tickets', crearRutasTickets({ ...deps, config }));
  return true;
}

module.exports = {
  crearRutasTickets,
  montarTickets,
  LIMITE_POR_DEFECTO,
  LIMITE_MAXIMO,
  ESTADOS_MECANICO,
};
