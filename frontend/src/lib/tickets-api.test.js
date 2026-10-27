import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cambiarEstadoTicket, enviarTicket, listarTickets } from './api.js';

test('las acciones usan el contrato del backend y conservan el estado HTTP', async () => {
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ url, opciones });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    await cambiarEstadoTicket({ ticketId: 'abc', a: 'en_reparacion' });
    await enviarTicket({ ticketId: 'abc', precioFinalMXN: 19.99 });
    await listarTickets(20);
    assert.deepEqual(JSON.parse(llamadas[0].opciones.body), { a: 'en_reparacion' });
    assert.deepEqual(JSON.parse(llamadas[1].opciones.body), { precioFinalMXN: 19.99 });
    assert.equal(llamadas[2].url, '/api/tickets?offset=20');
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'conflicto' }) });
    await assert.rejects(enviarTicket({ ticketId: 'abc', precioFinalMXN: 19.99 }), { status: 409 });
  } finally {
    globalThis.fetch = original;
  }
});
