const { ESTADOS } = require('./modelo');

// Quien puede ir a donde. Los estados sin salida son terminales.
const TRANSICIONES = Object.freeze({
  diagnosticado: ['cotizacion_enviada', 'cancelado'],
  cotizacion_enviada: ['autorizado', 'rechazado', 'vencido', 'cancelado'],
  autorizado: ['en_reparacion', 'cancelado'],
  rechazado: ['cotizacion_enviada', 'cancelado'],
  vencido: ['cotizacion_enviada', 'cancelado'],
  en_reparacion: ['terminado', 'cancelado'],
  terminado: [],
  cancelado: [],
});

function puedeTransicionar(de, a) {
  return (TRANSICIONES[de] || []).includes(a);
}

function normalizarEstablecer(establecer) {
  const salida = {};
  for (const [campo, valor] of Object.entries(establecer || {})) {
    if (valor === undefined) continue;
    salida[campo] = valor;
  }
  return salida;
}

/**
 * Cambia de estado en UNA operacion atomica. Devuelve el documento actualizado
 * o null si otro proceso gano la carrera.
 */
async function cambiarEstado(
  Ticket,
  {
    id,
    de,
    a,
    por = null,
    ahora = new Date(),
    tokenHash,
    exigirToken = false,
    establecer = {},
    agregar = {},
  } = {}
) {
  if (!puedeTransicionar(de, a)) {
    throw new Error(`Transicion no permitida: ${de} -> ${a}`);
  }
  if (!id) throw new Error('Falta el id del ticket.');

  const extra = normalizarEstablecer(establecer);
  if ('tokenHash' in extra) {
    if (typeof extra.tokenHash !== 'string' || extra.tokenHash.trim() === '') {
      throw new Error('tokenHash debe ser un hash no vacio.');
    }
    if (!(extra.tokenVenceEn instanceof Date) || Number.isNaN(extra.tokenVenceEn.getTime())) {
      throw new Error('tokenVenceEn debe ser una fecha valida junto con tokenHash.');
    }
  }

  // Toda salida de cotizacion_enviada invalida el token en la misma operacion.
  const saleDeCotizacion = de === 'cotizacion_enviada';
  if (saleDeCotizacion && 'tokenHash' in extra) {
    throw new Error('No se puede fijar tokenHash al salir de cotizacion_enviada.');
  }

  const filtro = { _id: id, estado: de };
  if (exigirToken) {
    if (typeof tokenHash !== 'string' || tokenHash.trim() === '') {
      throw new Error('Se requiere tokenHash para decidir la cotizacion.');
    }
    filtro.tokenHash = tokenHash;
    filtro.tokenVenceEn = { $gt: ahora };
  }

  const update = {
    $set: { estado: a, actualizadoEn: ahora, ...extra },
    // Un solo $push: el historial y lo que agregue la transicion (decisiones)
    // se escriben juntos o no se escribe nada.
    $push: { historial: { de, a, en: ahora, por }, ...agregar },
  };
  if (saleDeCotizacion) update.$unset = { tokenHash: '' };

  return Ticket.findOneAndUpdate(filtro, update, { new: true });
}

/**
 * Vencimiento perezoso: marca vencido solo si el token ya expiro. Se puede
 * ubicar por id o por tokenHash (el flujo publico solo tiene el token).
 */
async function vencerExpirada(Ticket, { id, tokenHash, ahora = new Date() } = {}) {
  if (tokenHash != null) {
    if (typeof tokenHash !== 'string' || tokenHash.trim() === '') {
      throw new Error('tokenHash invalido.');
    }
  } else if (!id) {
    throw new Error('Falta el id o el tokenHash del ticket.');
  }

  const filtro = {
    estado: 'cotizacion_enviada',
    tokenVenceEn: { $lte: ahora },
  };
  if (tokenHash != null) filtro.tokenHash = tokenHash;
  else filtro._id = id;

  return Ticket.findOneAndUpdate(
    filtro,
    {
      $set: { estado: 'vencido', actualizadoEn: ahora },
      $unset: { tokenHash: '' },
      $push: { historial: { de: 'cotizacion_enviada', a: 'vencido', en: ahora, por: null } },
    },
    { new: true }
  );
}

module.exports = {
  ESTADOS,
  TRANSICIONES,
  puedeTransicionar,
  cambiarEstado,
  vencerExpirada,
};
