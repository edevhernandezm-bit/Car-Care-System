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

test('MAIL_PROVIDER=ninguno responde 502 y deja envio.enviado=false', async () => {
  const idTicket = new mongoose.Types.ObjectId();
  const ticket = {
    _id: idTicket,
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
    envio: { enviado: false, intentos: 0, ultimoError: '' },
  };
  const actualizaciones = [];
  const Ticket = {
    async findById() {
      return ticket;
    },
    async findOneAndUpdate() {
      return { ...ticket, estado: 'cotizacion_enviada' };
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
      mailer: { enviarCotizacion: async () => ({ omitido: true }) },
    })
  );

  const servidor = app.listen(0);
  try {
    await new Promise((resolve) => servidor.once('listening', resolve));
    const puerto = servidor.address().port;
    const respuesta = await fetch(`http://127.0.0.1:${puerto}/api/tickets/${idTicket}/enviar`, {
      method: 'POST',
    });
    assert.equal(respuesta.status, 502);
    assert.equal(actualizaciones.length, 1);
    assert.equal(actualizaciones[0].$set['envio.enviado'], false);
    assert.equal(actualizaciones[0].$inc['envio.intentos'], 1);
    assert.equal(
      actualizaciones[0].$set['envio.ultimoError'].includes('ana@example.com'),
      false
    );
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});
