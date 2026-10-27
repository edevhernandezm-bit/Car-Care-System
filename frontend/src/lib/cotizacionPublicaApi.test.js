import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultarCotizacionPublica, decidirCotizacionPublica } from './api.js';

test('las peticiones públicas omiten credenciales y clasifican respuestas', async () => {
  const original = globalThis.fetch;
  let status = 200;
  let llamada;
  globalThis.fetch = async (url, opciones) => {
    llamada = { url, opciones };
    return { ok: status === 200, status, json: async () => ({ estado: 'autorizado' }) };
  };
  try {
    assert.equal((await consultarCotizacionPublica('token')).tipo, 'ok');
    assert.equal(llamada.opciones.credentials, 'omit');
    assert.deepEqual(JSON.parse(llamada.opciones.body), { token: 'token' });
    assert.equal(llamada.url, '/api/publico/cotizacion/consultar');
    for (const [codigo, tipo] of [[404, 'invalido'], [429, 'limite'], [422, 'datos'], [500, 'red']]) {
      status = codigo;
      assert.equal((await decidirCotizacionPublica({ token: 'token', decision: 'autorizar' })).tipo, tipo);
    }
    globalThis.fetch = async () => { throw new Error('red'); };
    assert.equal((await consultarCotizacionPublica('token')).tipo, 'red');
  } finally {
    globalThis.fetch = original;
  }
});
