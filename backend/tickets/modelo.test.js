const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { Ticket, esClaveDuplicada, CORREO_MAX, NOMBRE_MAX, TELEFONO_MAX, COMENTARIO_MAX } = require('./modelo');

function ticketValido(extra = {}) {
  return new Ticket({
    diagnosticoId: new mongoose.Types.ObjectId(),
    creadoPor: new mongoose.Types.ObjectId(),
    cliente: { nombre: 'Ana', correo: 'ana@example.com' },
    cotizacion: {
      totalMinMXN: 100,
      totalMaxMXN: 200,
      totalMinUSD: 5.46,
      totalMaxUSD: 10.93,
      tipoCambio: { usd_mxn: 18.3, fecha: '2026-10-25', fuente: 'prueba' },
    },
    ...extra,
  });
}

// Mongoose 9 retiro validateSync; validate() async es el camino vigente.
async function errores(documento) {
  try {
    await documento.validate();
    return null;
  } catch (error) {
    return error.errors;
  }
}

test('esClaveDuplicada reconoce el codigo 11000', () => {
  assert.equal(esClaveDuplicada({ code: 11000 }), true);
  assert.equal(esClaveDuplicada({ code: 11001 }), false);
  assert.equal(esClaveDuplicada(new Error('otro')), false);
  assert.equal(esClaveDuplicada(null), false);
});

test('un ticket valido no tiene errores', async () => {
  assert.equal(await errores(ticketValido()), null);
});

test('el estado inicial y el envio tienen valores seguros', () => {
  const ticket = ticketValido();
  assert.equal(ticket.estado, 'diagnosticado');
  assert.equal(ticket.envio.enviado, false);
  assert.equal(ticket.envio.intentos, 0);
  assert.equal(ticket.envio.codigoError, undefined);
  assert.equal(ticket.envio.ultimoIntentoEn, undefined);
  assert.deepEqual(ticket.decisiones.toObject(), []);
});

test('decisiones solo acepta resultado, motivo y comentario validos', async () => {
  const valida = ticketValido();
  valida.decisiones.push({
    resultado: 'rechazado',
    motivo: 'precio_alto',
    comentario: 'a'.repeat(COMENTARIO_MAX),
    en: new Date(),
  });
  assert.equal(await errores(valida), null);

  const sinExtras = ticketValido();
  sinExtras.decisiones.push({ resultado: 'rechazado', en: new Date() });
  assert.equal(await errores(sinExtras), null);

  for (const decision of [
    { resultado: 'otro', en: new Date() },
    { resultado: 'rechazado', motivo: 'prefiero_otro_taller', en: new Date() },
    {
      resultado: 'rechazado',
      comentario: 'a'.repeat(COMENTARIO_MAX + 1),
      en: new Date(),
    },
  ]) {
    const ticket = ticketValido();
    ticket.decisiones.push(decision);
    const fallos = await errores(ticket);
    assert.ok(
      fallos['decisiones.0.resultado'] ||
        fallos['decisiones.0.motivo'] ||
        fallos['decisiones.0.comentario']
    );
  }
});

test('precios[] y el precio final aceptan solo montos válidos', async () => {
  const ticket = ticketValido({
    cotizacion: {
      ...ticketValido().cotizacion,
      precioFinalMXN: 1500,
      precioFinalUSD: 81.97,
      leyenda: 'Incluye mano de obra',
    },
    precios: [
      {
        precioFinalMXN: 1500,
        en: new Date(),
        por: new mongoose.Types.ObjectId(),
      },
    ],
  });
  assert.equal(await errores(ticket), null);

  for (const precioFinalMXN of [0, -1, 10000000]) {
    const invalido = ticketValido({ precios: [{ precioFinalMXN, en: new Date() }] });
    assert.ok((await errores(invalido))['precios.0.precioFinalMXN'], String(precioFinalMXN));
  }
});

test('una decisión guarda el precio final vigente', async () => {
  const ticket = ticketValido();
  ticket.decisiones.push({
    resultado: 'autorizado',
    precioFinalMXN: 1500,
    en: new Date(),
  });
  assert.equal(await errores(ticket), null);

  const invalida = ticketValido();
  invalida.decisiones.push({ resultado: 'autorizado', precioFinalMXN: 0, en: new Date() });
  assert.ok((await errores(invalida))['decisiones.0.precioFinalMXN']);
});

test('acepta solo los codigos de error fijos y proveedor_<3 digitos>', async () => {
  for (const codigo of [
    'tiempo_agotado',
    'error_red',
    'sin_proveedor',
    'destinatario_invalido',
    'simulado',
    'desconocido',
    'proveedor_403',
    'proveedor_500',
  ]) {
    const ticket = ticketValido();
    ticket.envio.codigoError = codigo;
    assert.equal(await errores(ticket), null, codigo);
  }

  for (const codigo of ['proveedor_40', 'proveedor_5000', 'texto libre', 'ana@example.com']) {
    const ticket = ticketValido();
    ticket.envio.codigoError = codigo;
    assert.ok((await errores(ticket))['envio.codigoError'], codigo);
  }
});

test('valida el formato y el largo del correo', async () => {
  const invalido = ticketValido();
  invalido.cliente.correo = 'ana@';
  assert.ok((await errores(invalido))['cliente.correo']);

  const largo = ticketValido();
  largo.cliente.correo = 'a'.repeat(CORREO_MAX - 3) + '@x.com';
  assert.ok((await errores(largo))['cliente.correo']);

  const alLimite = ticketValido();
  const dominio = '@x.com';
  alLimite.cliente.correo = 'a'.repeat(CORREO_MAX - dominio.length) + dominio;
  assert.equal(await errores(alLimite), null);
});

test('acota nombre y telefono', async () => {
  const nombre = ticketValido();
  nombre.cliente.nombre = 'a'.repeat(NOMBRE_MAX + 1);
  assert.ok((await errores(nombre))['cliente.nombre']);

  const telefono = ticketValido();
  telefono.cliente.telefono = '1'.repeat(TELEFONO_MAX + 1);
  assert.ok((await errores(telefono))['cliente.telefono']);

  const valido = ticketValido();
  valido.cliente.telefono = '1'.repeat(TELEFONO_MAX);
  assert.equal(await errores(valido), null);
});

test('nunca acepta tokenHash nulo ni vacio', async () => {
  for (const tokenHash of [null, '']) {
    const ticket = ticketValido({ tokenHash });
    assert.ok((await errores(ticket)).tokenHash, String(tokenHash));
  }
  const conHash = ticketValido({ tokenHash: 'a'.repeat(64) });
  assert.equal(await errores(conHash), null);
});

test('el snapshot conserva moneda y costos de origen', async () => {
  const ticket = ticketValido({
    fallas: [
      {
        falla: 'cvt_nissan_altima',
        nombre: 'CVT Altima',
        precioMinMXN: 54900,
        precioMaxMXN: 86010,
        monedaOrigen: 'USD',
        costoMinOrigen: 3000,
        costoMaxOrigen: 4700,
      },
    ],
  });
  assert.equal(await errores(ticket), null);

  const sinMoneda = ticketValido({
    fallas: [
      {
        falla: 'cvt_nissan_altima',
        nombre: 'CVT Altima',
        precioMinMXN: 54900,
        precioMaxMXN: 86010,
        costoMinOrigen: 3000,
        costoMaxOrigen: 4700,
      },
    ],
  });
  assert.ok((await errores(sinMoneda))['fallas.0.monedaOrigen']);
});

test('el indice de tokenHash es unico y parcial', () => {
  const indice = Ticket.schema.indexes().find(([campos]) => campos.tokenHash === 1);
  assert.ok(indice, 'falta el indice de tokenHash');
  assert.equal(indice[1].unique, true);
  assert.deepEqual(indice[1].partialFilterExpression, { tokenHash: { $type: 'string' } });
});
