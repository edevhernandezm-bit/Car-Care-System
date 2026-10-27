const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

const { crearRutasTickets, montarTickets } = require('./rutas');

const auth = (req, _res, next) => {
  req.session = { userId: new mongoose.Types.ObjectId().toString() };
  next();
};
const admin = (_req, _res, next) => next();

test('montarTickets no registra nada con el interruptor apagado', () => {
  const usos = [];
  const app = { use: (...args) => usos.push(args[0]) };
  assert.equal(montarTickets(app, { ticketsEnabled: false }, {}), false);
  assert.deepEqual(usos, []);
});

test('con el interruptor apagado, /api/tickets cae en el 404 global', async () => {
  const app = express();
  assert.equal(montarTickets(app, { ticketsEnabled: false }, {}), false);
  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  const servidor = app.listen(0);
  try {
    await new Promise((resolve) => servidor.once('listening', resolve));
    const respuesta = await fetch(`http://127.0.0.1:${servidor.address().port}/api/tickets`);
    assert.equal(respuesta.status, 404);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});

test('montarTickets registra /api/tickets con el interruptor encendido', () => {
  const usos = [];
  const app = { use: (...args) => usos.push(args[0]) };
  const montado = montarTickets(
    app,
    { ticketsEnabled: true },
    { requireAuth: auth, requireAdmin: admin }
  );
  assert.equal(montado, true);
  assert.deepEqual(usos, ['/api/tickets']);
});

function ticketBase(extra = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    diagnosticoId: new mongoose.Types.ObjectId(),
    estado: 'diagnosticado',
    cliente: { nombre: 'Ana', correo: 'ana@example.com' },
    vehiculo: { marca: 'Toyota', modelo: 'Corolla', anio: 2020 },
    fallas: [
      {
        falla: 'bateria',
        nombre: 'Bateria',
        precioMinMXN: 100,
        precioMaxMXN: 200,
        monedaOrigen: 'MXN',
        costoMinOrigen: 100,
        costoMaxOrigen: 200,
      },
    ],
    cotizacion: {
      totalMinMXN: 100,
      totalMaxMXN: 200,
      totalMinUSD: 5.46,
      totalMaxUSD: 10.93,
      tipoCambio: { usd_mxn: 18.3, fecha: '2026-10-25', fuente: 'estimada' },
      leyenda: 'No incluye mano de obra',
    },
    precios: [],
    envio: { enviado: false, intentos: 0 },
    ...extra,
  };
}

// Entregable con la misma forma que devuelve Mongoose (awaitable y encadenable).
function consulta(resultado) {
  const q = {
    select: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    lean: async () => resultado,
  };
  q.then = (res, rej) => Promise.resolve(resultado).then(res, rej);
  return q;
}

function aplicarSet(documento, cambios) {
  const copia = { ...documento };
  for (const [ruta, valor] of Object.entries(cambios || {})) {
    const partes = ruta.split('.');
    let actual = copia;
    for (const parte of partes.slice(0, -1)) {
      actual[parte] = { ...(actual[parte] || {}) };
      actual = actual[parte];
    }
    actual[partes[partes.length - 1]] = valor;
  }
  return copia;
}

function appCon({
  ticket,
  mailer,
  resultado,
  actualizaciones = [],
  transiciones = [],
  candidatos = [],
}) {
  const final = resultado === undefined ? ticket : resultado;
  // La primera lectura es el ticket a enviar; las siguientes, el documento ya
  // actualizado que devuelve la ruta.
  let lecturas = 0;
  const Ticket = {
    findById: () => consulta(++lecturas === 1 ? ticket : final),
    find: (filtro) =>
      consulta(filtro?.tokenVenceEn ? candidatos : Array.isArray(final) ? final : [final]),
    countDocuments: async () => (Array.isArray(final) ? final.length : 1),
    async findOneAndUpdate(_filtro, update) {
      transiciones.push(update);
      const actualizado = aplicarSet(ticket, update.$set);
      return { ...actualizado, estado: actualizado.estado || 'cotizacion_enviada' };
    },
    async updateOne(_filtro, update) {
      actualizaciones.push(update);
      return { acknowledged: true };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/api/tickets',
    crearRutasTickets({
      Ticket,
      Diagnostico: {},
      requireAuth: auth,
      requireAdmin: admin,
      pedirAMotor: async () => {
        throw new Error('no se usa en enviar');
      },
      cabecerasMotor: {},
      config: { ticketsEnabled: true, publicAppUrl: 'https://car-care.test' },
      mailer,
    })
  );
  return app;
}

async function conServidor(app, fn) {
  const servidor = app.listen(0);
  try {
    await new Promise((resolve) => servidor.once('listening', resolve));
    return await fn(`http://127.0.0.1:${servidor.address().port}`);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
}

async function enviar(app, id, body = { precioFinalMXN: 19.99 }) {
  return conServidor(app, (base) =>
    fetch(`${base}/api/tickets/${id}/enviar`, {
      method: 'POST',
      headers: body === null ? undefined : { 'Content-Type': 'application/json' },
      body: body === null ? undefined : JSON.stringify(body),
    })
  );
}

function capturarErrores(fn) {
  const original = console.error;
  const lineas = [];
  console.error = (...args) => lineas.push(args.join(' '));
  return Promise.resolve(fn())
    .then((resultado) => ({ resultado, lineas }))
    .finally(() => {
      console.error = original;
    });
}

function sinEnlaceNiToken(cuerpo) {
  const texto = JSON.stringify(cuerpo);
  assert.equal(texto.includes('cotizacion#'), false, 'ninguna respuesta debe traer el enlace');
  assert.doesNotMatch(texto, /[A-Za-z0-9_-]{43}/, 'ninguna respuesta debe traer un token');
}

test('MAIL_PROVIDER=ninguno responde 502 con codigo sin_proveedor', async () => {
  const ticket = ticketBase();
  const actualizaciones = [];
  const app = appCon({
    ticket,
    actualizaciones,
    mailer: { enviarCotizacion: async () => ({ omitido: true }) },
  });

  const { resultado: respuesta, lineas } = await capturarErrores(() => enviar(app, ticket._id));
  assert.equal(respuesta.status, 502);
  assert.equal(actualizaciones.length, 1);
  assert.equal(actualizaciones[0].$set['envio.enviado'], false);
  assert.equal(actualizaciones[0].$set['envio.codigoError'], 'sin_proveedor');
  assert.ok(actualizaciones[0].$set['envio.ultimoIntentoEn'] instanceof Date);
  assert.equal(actualizaciones[0].$inc['envio.intentos'], 1);
  assert.equal(actualizaciones[0].$unset, undefined);
  assert.deepEqual(lineas, [`[correo] ticket=${ticket._id} codigo=sin_proveedor`]);
  assert.equal(JSON.stringify(await respuesta.json()).includes('ana@example.com'), false);
});

test('un error del mailer con codigo fijo se guarda y se loguea sin texto libre', async () => {
  for (const codigo of [
    'simulado',
    'tiempo_agotado',
    'error_red',
    'proveedor_403',
    'proveedor_500',
    'destinatario_invalido',
  ]) {
    const ticket = ticketBase();
    const actualizaciones = [];
    const app = appCon({
      ticket,
      actualizaciones,
      mailer: {
        async enviarCotizacion() {
          throw Object.assign(new Error('texto libre ana@example.com'), { codigo });
        },
      },
    });

    const { resultado: respuesta, lineas } = await capturarErrores(() => enviar(app, ticket._id));
    assert.equal(respuesta.status, 502, codigo);
    assert.equal(actualizaciones[0].$set['envio.codigoError'], codigo);
    assert.deepEqual(lineas, [`[correo] ticket=${ticket._id} codigo=${codigo}`]);
    assert.equal(lineas.join(' ').includes('texto libre'), false);
  }
});

test('un error del mailer sin codigo o con codigo invalido se registra como desconocido', async () => {
  for (const error of [
    new Error('texto libre ana@example.com'),
    Object.assign(new Error('otro'), { codigo: 'texto libre' }),
    Object.assign(new Error('otro'), { codigo: 'proveedor_40' }),
  ]) {
    const ticket = ticketBase();
    const actualizaciones = [];
    const app = appCon({
      ticket,
      actualizaciones,
      mailer: {
        async enviarCotizacion() {
          throw error;
        },
      },
    });

    const { resultado: respuesta, lineas } = await capturarErrores(() => enviar(app, ticket._id));
    assert.equal(respuesta.status, 502);
    assert.equal(actualizaciones[0].$set['envio.codigoError'], 'desconocido');
    assert.deepEqual(lineas, [`[correo] ticket=${ticket._id} codigo=desconocido`]);
    assert.equal(lineas.join(' ').includes('ana@example.com'), false);
  }
});

test('el exito limpia codigoError y actualiza ultimoIntentoEn', async () => {
  const anterior = new Date('2026-10-01T00:00:00.000Z');
  const ticket = ticketBase({
    estado: 'cotizacion_enviada',
    envio: { enviado: false, intentos: 1, codigoError: 'simulado', ultimoIntentoEn: anterior },
  });
  const actualizaciones = [];
  const final = {
    ...ticket,
    envio: { enviado: true, intentos: 2, ultimoIntentoEn: new Date() },
  };
  const app = appCon({
    ticket,
    resultado: final,
    actualizaciones,
    mailer: { enviarCotizacion: async () => ({ id: 'correo-1' }) },
  });

  const respuesta = await enviar(app, ticket._id);
  assert.equal(respuesta.status, 200);
  assert.equal(actualizaciones[0].$set['envio.enviado'], true);
  assert.ok(actualizaciones[0].$set['envio.ultimoIntentoEn'] instanceof Date);
  assert.equal(actualizaciones[0].$set['envio.codigoError'], undefined);
  assert.deepEqual(actualizaciones[0].$unset, { 'envio.codigoError': '' });

  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.envio.enviado, true);
  assert.equal(cuerpo.envio.codigoError, undefined);
  assert.ok(cuerpo.envio.ultimoIntentoEn);
  sinEnlaceNiToken(cuerpo);
});

test('los fallos de id o de estado no se registran como errores de envio', async () => {
  for (const [id, estado, esperado] of [
    ['no-es-un-id', 'diagnosticado', 400],
    [String(new mongoose.Types.ObjectId()), 'autorizado', 409],
    [String(new mongoose.Types.ObjectId()), 'cotizacion_enviada', 409],
  ]) {
    const ticket = ticketBase({ _id: id, estado, envio: { enviado: true, intentos: 1 } });
    const actualizaciones = [];
    const app = appCon({
      ticket,
      actualizaciones,
      mailer: { enviarCotizacion: async () => ({ id: 'no-debe-usarse' }) },
    });

    const { resultado: respuesta, lineas } = await capturarErrores(() => enviar(app, id));
    assert.equal(respuesta.status, esperado, `${estado}: ${esperado}`);
    assert.equal(actualizaciones.length, 0, `${estado} no registra intento`);
    assert.deepEqual(lineas, [], `${estado} no loguea codigo de envio`);
  }
});

test('GET lista y detalle solo exponen los cuatro campos de envio', async () => {
  const ticket = ticketBase({
    tokenHash: 'a'.repeat(64),
    tokenVenceEn: new Date('2026-11-01T00:00:00.000Z'),
    envio: {
      enviado: false,
      intentos: 3,
      codigoError: 'proveedor_500',
      ultimoIntentoEn: new Date('2026-10-26T00:00:00.000Z'),
      ultimoError: 'texto viejo',
      destinatario: 'ana@example.com',
      cuerpo: 'detalle interno',
    },
  });
  const app = appCon({ ticket, mailer: { enviarCotizacion: async () => ({}) } });

  await conServidor(app, async (base) => {
    for (const ruta of ['/api/tickets', `/api/tickets/${ticket._id}`]) {
      const respuesta = await fetch(`${base}${ruta}`);
      assert.equal(respuesta.status, 200);
      const cuerpo = await respuesta.json();
      const item = cuerpo.tickets ? cuerpo.tickets[0] : cuerpo;
      assert.deepEqual(
        Object.keys(item.envio).sort(),
        ['codigoError', 'enviado', 'intentos', 'ultimoIntentoEn']
      );
      assert.equal(JSON.stringify(item.envio).includes('ana@example.com'), false);
      assert.equal(JSON.stringify(item.envio).includes('detalle interno'), false);
      assert.equal(JSON.stringify(cuerpo).includes('tokenHash'), false);
      sinEnlaceNiToken(cuerpo);
    }
  });
});

test('la lista muestra ultimaDecision sin comentario y el detalle conserva decisiones', async () => {
  const decision = {
    resultado: 'rechazado',
    motivo: 'precio_alto',
    comentario: '<b>comentario secreto</b>',
    en: new Date('2026-10-26T00:00:00.000Z'),
  };
  const ticket = ticketBase({ estado: 'rechazado', decisiones: [decision] });
  const mailer = { enviarCotizacion: async () => ({}) };

  const appLista = appCon({ ticket, resultado: [ticket], mailer });
  await conServidor(appLista, async (base) => {
    const respuesta = await fetch(`${base}/api/tickets`);
    assert.equal(respuesta.status, 200);
    const cuerpo = await respuesta.json();
    const item = cuerpo.tickets[0];
    assert.deepEqual(item.ultimaDecision, { resultado: 'rechazado', motivo: 'precio_alto' });
    assert.equal('decisiones' in item, false, 'la lista no entrega el arreglo completo');
    assert.equal(JSON.stringify(item).includes('comentario'), false);
    assert.equal(JSON.stringify(item).includes('comentario secreto'), false);
  });

  const appDetalle = appCon({ ticket, mailer });
  await conServidor(appDetalle, async (base) => {
    const respuesta = await fetch(`${base}/api/tickets/${ticket._id}`);
    assert.equal(respuesta.status, 200);
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.decisiones.length, 1);
    assert.equal(cuerpo.decisiones[0].comentario, '<b>comentario secreto</b>');
    assert.equal(cuerpo.decisiones[0].motivo, 'precio_alto');
  });
});

test('reenviar desde rechazado reinicia el envio y conserva las decisiones', async () => {
  const ticket = ticketBase({
    estado: 'rechazado',
    envio: { enviado: true, intentos: 1 },
    decisiones: [
      { resultado: 'rechazado', motivo: 'otro', comentario: 'sin cambios', en: new Date() },
    ],
  });
  const transiciones = [];
  const final = {
    ...ticket,
    estado: 'cotizacion_enviada',
    envio: { enviado: true, intentos: 2 },
  };
  const app = appCon({
    ticket,
    resultado: final,
    transiciones,
    mailer: { enviarCotizacion: async () => ({ id: 'correo-1' }) },
  });

  const respuesta = await enviar(app, ticket._id);
  assert.equal(respuesta.status, 200);
  assert.equal(transiciones.length, 1);
  const update = transiciones[0];
  assert.equal(update.$set.estado, 'cotizacion_enviada');
  assert.equal(update.$set['envio.enviado'], false, 'el envio anterior se reinicia');
  assert.equal(typeof update.$set.tokenHash, 'string');
  assert.ok(update.$set.tokenVenceEn instanceof Date);
  assert.equal(update.$set.decisiones, undefined, 'las decisiones no se reescriben');
  assert.equal(update.$push.historial.de, 'rechazado');
  assert.equal(update.$push.decisiones, undefined);
});

test('enviar rechaza precios ausentes o inválidos antes de tocar Mongo', async () => {
  const casos = [
    ['sin cuerpo', null],
    ['sin la clave', {}],
    ['tres decimales', { precioFinalMXN: 10.001 }],
    ['texto', { precioFinalMXN: '500' }],
    ['notación exponencial', { precioFinalMXN: '1e3' }],
    ['NaN', { precioFinalMXN: NaN }],
    ['Infinity', { precioFinalMXN: Infinity }],
    ['cero', { precioFinalMXN: 0 }],
    ['negativo', { precioFinalMXN: -1 }],
    ['fuera del máximo', { precioFinalMXN: 10000000 }],
  ];

  for (const [nombre, body] of casos) {
    const ticket = ticketBase();
    const actualizaciones = [];
    const transiciones = [];
    let correos = 0;
    const app = appCon({
      ticket,
      actualizaciones,
      transiciones,
      mailer: { enviarCotizacion: async () => { correos += 1; return {}; } },
    });

    const respuesta = await enviar(app, ticket._id, body);
    assert.equal(respuesta.status, 422, nombre);
    assert.deepEqual(await respuesta.json(), { error: 'Datos no válidos' }, nombre);
    assert.equal(actualizaciones.length, 0, `${nombre}: no registra intento`);
    assert.equal(transiciones.length, 0, `${nombre}: no cambia el ticket`);
    assert.equal(correos, 0, `${nombre}: no manda correo`);
  }
});

test('un precio válido fija MXN, USD y agrega precios[] en la misma transición', async () => {
  const ticket = ticketBase();
  const transiciones = [];
  const resumenes = [];
  const app = appCon({
    ticket,
    transiciones,
    mailer: {
      async enviarCotizacion(datos) {
        resumenes.push(datos.resumen);
        return { id: 'correo-1' };
      },
    },
  });

  const respuesta = await enviar(app, ticket._id, { precioFinalMXN: 1234.5 });
  assert.equal(respuesta.status, 200);
  assert.equal(transiciones.length, 1);
  const update = transiciones[0];
  assert.equal(update.$set['cotizacion.precioFinalMXN'], 1234.5);
  assert.equal(update.$set['cotizacion.precioFinalUSD'], Math.round(123450 / 18.3) / 100);
  assert.equal(update.$set['cotizacion.leyenda'], 'Incluye mano de obra');
  assert.equal(update.$set['envio.enviado'], false);
  assert.equal(update.$push.precios.precioFinalMXN, 1234.5);
  assert.ok(update.$push.precios.en instanceof Date);
  assert.ok(update.$push.precios.por);
  assert.equal(resumenes[0].precioFinalMXN, 1234.5);
  assert.equal(resumenes[0].precioFinalUSD, Math.round(123450 / 18.3) / 100);
  assert.equal(resumenes[0].leyenda, 'Incluye mano de obra');
});

test('el reintento de un envío fallido también reemplaza el precio y el token', async () => {
  const ticket = ticketBase({
    estado: 'cotizacion_enviada',
    envio: { enviado: false, intentos: 1 },
  });
  const transiciones = [];
  const app = appCon({
    ticket,
    transiciones,
    mailer: { enviarCotizacion: async () => ({ id: 'correo-1' }) },
  });

  const respuesta = await enviar(app, ticket._id, { precioFinalMXN: 0.1 });
  assert.equal(respuesta.status, 200);
  const update = transiciones[0];
  assert.equal(update.$set['cotizacion.precioFinalMXN'], 0.1);
  assert.equal(update.$set['cotizacion.precioFinalUSD'], Math.round(10 / 18.3) / 100);
  assert.equal(update.$push.precios.precioFinalMXN, 0.1);
  assert.equal(typeof update.$set.tokenHash, 'string');
});

test('la lista vence primero los candidatos con token expirado', async () => {
  const ticket = ticketBase({
    estado: 'cotizacion_enviada',
    tokenHash: 'a'.repeat(64),
    tokenVenceEn: new Date('2020-01-01T00:00:00.000Z'),
    envio: { enviado: true, intentos: 1 },
  });
  const transiciones = [];
  const app = appCon({
    ticket,
    resultado: [ticket],
    candidatos: [{ _id: ticket._id }],
    transiciones,
    mailer: { enviarCotizacion: async () => ({}) },
  });

  await conServidor(app, async (base) => {
    const respuesta = await fetch(`${base}/api/tickets`);
    assert.equal(respuesta.status, 200);
  });
  assert.equal(transiciones.length, 1);
  assert.equal(transiciones[0].$set.estado, 'vencido');
});

test('GET /atencion devuelve solo ids y estado, sin datos del cliente', async () => {
  const ticket = ticketBase({ estado: 'autorizado' });
  const app = appCon({
    ticket,
    resultado: [ticket],
    mailer: { enviarCotizacion: async () => ({}) },
  });

  await conServidor(app, async (base) => {
    const respuesta = await fetch(`${base}/api/tickets/atencion`);
    assert.equal(respuesta.status, 200);
    const cuerpo = await respuesta.json();
    assert.deepEqual(cuerpo, {
      tickets: [
        {
          ticketId: String(ticket._id),
          diagnosticoId: String(ticket.diagnosticoId),
          estado: 'autorizado',
        },
      ],
    });
    assert.equal(JSON.stringify(cuerpo).includes('ana@example.com'), false);
    assert.equal(JSON.stringify(cuerpo).includes('Ana'), false);
  });
});
