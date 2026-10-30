import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const mongoose = require('mongoose');
const { ticketSchema } = require('./../backend/tickets/modelo');
const { crearRutasTickets } = require('./../backend/tickets/rutas');
const { hashToken } = require('./../backend/tickets/token');

test('un envío en curso bloquea reintentos de otra instancia sin invalidar su enlace', { timeout: 15000 }, async () => {
  const db = await mongoose.createConnection('mongodb://127.0.0.1:27017/car_care_e2e', { serverSelectionTimeoutMS: 5000 }).asPromise();
  const Ticket = db.model('Ticket', ticketSchema);
  const id = new mongoose.Types.ObjectId();
  let liberarCorreo;
  let avisoCorreo;
  const correoIniciado = new Promise((resolve) => { avisoCorreo = resolve; });
  const correoBloqueado = new Promise((resolve) => { liberarCorreo = resolve; });
  const enlaces = [];
  const mailer = { async enviarCotizacion({ enlace }) { enlaces.push(enlace); if (enlaces.length === 1) { avisoCorreo(); await correoBloqueado; } return { id: 'prueba' }; } };
  const auth = (req, _res, next) => { req.session = { userId: new mongoose.Types.ObjectId().toString() }; next(); };
  const servidores = [];
  try {
    await Ticket.collection.insertOne({ _id: id, estado: 'diagnosticado', cliente: { nombre: 'Prueba', correo: 'prueba@example.com' }, vehiculo: {}, fallas: [], cotizacion: { tipoCambio: { usd_mxn: 20, fecha: '2026-01-01', fuente: 'prueba' } }, envio: { enviado: false, intentos: 0 }, precios: [], historial: [] });
    for (let i = 0; i < 2; i++) {
      const app = express();
      app.use(express.json());
      app.use('/api/tickets', crearRutasTickets({ Ticket, Diagnostico: {}, requireAuth: auth, requireAdmin: (_req, _res, next) => next(), config: { publicAppUrl: 'https://prueba.example' }, mailer }));
      const servidor = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => servidor.once('listening', resolve));
      servidores.push(servidor);
    }
    const enviar = (servidor) => fetch(`http://127.0.0.1:${servidor.address().port}/api/tickets/${id}/enviar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ precioFinalMXN: 100 }) });
    const primera = enviar(servidores[0]);
    await correoIniciado;
    const segunda = await enviar(servidores[1]);
    assert.equal(segunda.status, 409);
    liberarCorreo();
    const respuesta = await primera;
    assert.equal(respuesta.status, 200);
    assert.equal(enlaces.length, 1);
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.envio.enviado, true);
    assert.equal(cuerpo.envio.bloqueoId, undefined);
    const guardado = await Ticket.findById(id).lean();
    assert.equal(guardado.tokenHash, hashToken(new URL(enlaces[0]).hash.slice(1)));
    assert.equal(guardado.envio.bloqueoId, undefined);
    await Ticket.updateOne({ _id: id }, { $set: { 'envio.enviado': false, 'envio.bloqueoId': 'interrumpido', 'envio.bloqueoHasta': new Date(0) } });
    const recuperado = await enviar(servidores[1]);
    assert.equal(recuperado.status, 200);
    const final = await Ticket.findById(id).lean();
    assert.equal(final.envio.bloqueoId, undefined);
    assert.equal(final.tokenHash, hashToken(new URL(enlaces[1]).hash.slice(1)));
  } finally {
    liberarCorreo?.();
    await Promise.all(servidores.map((s) => new Promise((resolve) => s.close(resolve))));
    await Ticket.deleteOne({ _id: id });
    await db.close();
  }
});
