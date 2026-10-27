const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ERROR_GENERICO,
  ERROR_DATOS,
  montarTicketsPublico,
  manejarErrorPublico,
  tokenValido,
  decisionValida,
  prepararRechazo,
  vistaTicketPublico,
} = require('./publico');

test('el token publico exige exactamente 43 caracteres base64url', () => {
  assert.equal(tokenValido('A'.repeat(43)), true);
  assert.equal(tokenValido('A'.repeat(42)), false);
  assert.equal(tokenValido('A'.repeat(44)), false);
  assert.equal(tokenValido(`${'A'.repeat(42)}!`), false);
  assert.equal(tokenValido(null), false);
  assert.equal(tokenValido(123), false);
});

test('la decision publica solo acepta autorizar o rechazar', () => {
  assert.equal(decisionValida('autorizar'), true);
  assert.equal(decisionValida('rechazar'), true);
  assert.equal(decisionValida('aprobar'), false);
  assert.equal(decisionValida('AUTORIZAR'), false);
  assert.equal(decisionValida(undefined), false);
});

test('normaliza el rechazo: CRLF a LF, trim y HTML intacto', () => {
  assert.deepEqual(prepararRechazo({ motivo: 'otro', comentario: '  <b>Hola</b>\r\nmundo  ' }), {
    motivo: 'otro',
    comentario: '<b>Hola</b>\nmundo',
  });
  assert.deepEqual(prepararRechazo({}), {});
  assert.deepEqual(prepararRechazo({ comentario: '   \r\n ' }), {});
  assert.deepEqual(prepararRechazo({ comentario: 'a'.repeat(500) }), {
    comentario: 'a'.repeat(500),
  });
  assert.deepEqual(ERROR_DATOS, { error: 'Datos no válidos' });
});

test('rechaza motivo, comentario y controles invalidos', () => {
  assert.equal(prepararRechazo({ motivo: 'prefiero_otro_taller' }), null);
  assert.equal(prepararRechazo({ comentario: 123 }), null);
  assert.equal(prepararRechazo({ comentario: 'a'.repeat(501) }), null);
  assert.equal(prepararRechazo({ comentario: 'linea\tcon\ttab' }), null);
  assert.equal(prepararRechazo({ comentario: 'eco\u0007' }), null);
});

test('la vista publica solo expone la lista blanca y recorta el nombre', () => {
  const ticket = {
    _id: 'id-interno',
    tokenHash: 'hash-secreto',
    tokenVenceEn: new Date('2026-10-28T12:00:00.000Z'),
    vehiculo: { marca: 'Toyota', modelo: 'Corolla', anio: 2020, transmision: 'manual' },
    fallas: [
      {
        falla: 'frenos',
        nombre: 'Frenos',
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
      tipoCambio: { usd_mxn: 18.31, fecha: '2026-10-25', fuente: 'constante' },
      leyenda: 'No incluye mano de obra',
    },
    cliente: {
      nombre: 'Ana Maria Lopez',
      correo: 'ana@example.com',
      telefono: '5555555555',
    },
    historial: [{ de: 'diagnosticado', a: 'cotizacion_enviada' }],
    decisiones: [{ resultado: 'rechazado', motivo: 'otro', comentario: 'no debe salir' }],
  };

  assert.deepEqual(vistaTicketPublico(ticket), {
    vehiculo: { marca: 'Toyota', modelo: 'Corolla', anio: 2020 },
    fallas: ['Frenos'],
    totalMinMXN: 100,
    totalMaxMXN: 200,
    totalMinUSD: 5.46,
    totalMaxUSD: 10.93,
    tipoCambio: { fecha: '2026-10-25', fuente: 'constante' },
    tasaEstimada: true,
    leyenda: 'No incluye mano de obra',
    vigenteHasta: '2026-10-28T12:00:00.000Z',
    cliente: { nombre: 'Ana' },
  });

  const serializado = JSON.stringify(vistaTicketPublico(ticket));
  for (const prohibido of [
    'ana@example.com',
    '5555555555',
    'id-interno',
    'hash-secreto',
    'manual',
    'decisiones',
    'comentario',
    'no debe salir',
  ]) {
    assert.equal(serializado.includes(prohibido), false, `no debe salir ${prohibido}`);
  }
});

test('el manejador publico devuelve el 404 generico para errores del parser', () => {
  assert.equal(manejarErrorPublico.length, 4);
  for (const type of ['entity.parse.failed', 'entity.too.large']) {
    const res = respuestaFalsa();
    manejarErrorPublico({ type }, {}, res, () => {});
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, ERROR_GENERICO);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  }
});

test('el manejador publico no filtra el detalle de un error inesperado', () => {
  const res = respuestaFalsa();
  manejarErrorPublico(new Error('fallo con dato interno'), {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Error interno' });
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
});

test('montarTicketsPublico respeta el interruptor', () => {
  const usos = [];
  const app = { use: (...args) => usos.push(args[0]) };
  assert.equal(montarTicketsPublico(app, { ticketsEnabled: false }, {}), false);
  assert.deepEqual(usos, []);
  assert.equal(montarTicketsPublico(app, { ticketsEnabled: true }, { Ticket: {} }), true);
  assert.deepEqual(usos, ['/api/publico']);
});

function respuestaFalsa() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(nombre, valor) {
      this.headers[nombre] = valor;
      return this;
    },
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(cuerpo) {
      this.body = cuerpo;
      return this;
    },
  };
  return res;
}
