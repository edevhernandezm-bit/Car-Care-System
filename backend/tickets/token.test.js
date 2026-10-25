const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TOKEN_BYTES,
  TOKEN_TTL_MS,
  generarToken,
  hashToken,
  calcularVencimiento,
  estaVencido,
  buscarPorToken,
} = require('./token');

test('el token tiene 32 bytes en base64url (43 caracteres)', () => {
  const token = generarToken();
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(token, 'base64url').length, TOKEN_BYTES);
});

test('mil tokens son unicos', () => {
  const tokens = new Set(Array.from({ length: 1000 }, generarToken));
  assert.equal(tokens.size, 1000);
});

test('el hash es estable y de 64 hex', () => {
  const token = generarToken();
  const primero = hashToken(token);
  const segundo = hashToken(token);
  assert.equal(primero, segundo);
  assert.match(primero, /^[a-f0-9]{64}$/);
});

test('el hash no expone el token', () => {
  const token = generarToken();
  const hash = hashToken(token);
  assert.notEqual(hash, token);
  assert.equal(hash.includes(token), false);
});

test('la vigencia es de 72 horas exactas', () => {
  const ahora = new Date('2026-10-25T12:00:00.000Z');
  const vence = calcularVencimiento(ahora);
  assert.equal(vence.getTime() - ahora.getTime(), TOKEN_TTL_MS);
  assert.equal(TOKEN_TTL_MS, 72 * 60 * 60 * 1000);
  assert.equal(vence.toISOString(), '2026-10-28T12:00:00.000Z');
});

test('estaVencido respeta el limite exacto', () => {
  const ahora = new Date('2026-10-25T12:00:00.000Z');
  assert.equal(estaVencido(new Date(ahora.getTime() - 1), ahora), true);
  assert.equal(estaVencido(new Date(ahora.getTime()), ahora), true);
  assert.equal(estaVencido(new Date(ahora.getTime() + 1), ahora), false);
  assert.equal(estaVencido(null, ahora), true);
});

test('buscarPorToken consulta por hash y nunca por el token plano', async () => {
  const llamadas = [];
  const Ticket = {
    async findOne(filtro) {
      llamadas.push(filtro);
      return { _id: 't1' };
    },
  };

  const token = generarToken();
  const encontrado = await buscarPorToken(Ticket, token);

  assert.deepEqual(encontrado, { _id: 't1' });
  assert.equal(llamadas.length, 1);
  assert.deepEqual(llamadas[0], { tokenHash: hashToken(token) });
  assert.equal(llamadas[0].tokenHash.includes(token), false);
});

test('buscarPorToken con token vacio no toca la base', async () => {
  const Ticket = {
    async findOne() {
      throw new Error('no deberia consultar');
    },
  };
  assert.equal(await buscarPorToken(Ticket, ''), null);
  assert.equal(await buscarPorToken(Ticket, null), null);
});
