const test = require('node:test');
const assert = require('node:assert/strict');

const { ESTADOS } = require('./modelo');
const {
  TRANSICIONES,
  puedeTransicionar,
  cambiarEstado,
  vencerExpirada,
} = require('./transiciones');

function ticketFalso(resultado = { _id: 't1' }) {
  const llamadas = [];
  return {
    llamadas,
    async findOneAndUpdate(filtro, update, opciones) {
      llamadas.push({ filtro, update, opciones });
      return resultado;
    },
  };
}

test('el mapa cubre exactamente las transiciones permitidas', () => {
  for (const de of ESTADOS) {
    for (const a of ESTADOS) {
      const esperado = (TRANSICIONES[de] || []).includes(a);
      assert.equal(puedeTransicionar(de, a), esperado, `${de} -> ${a}`);
    }
  }
});

test('las transiciones clave estan permitidas', () => {
  const permitidas = [
    ['diagnosticado', 'cotizacion_enviada'],
    ['cotizacion_enviada', 'autorizado'],
    ['cotizacion_enviada', 'rechazado'],
    ['cotizacion_enviada', 'vencido'],
    ['autorizado', 'en_reparacion'],
    ['en_reparacion', 'terminado'],
    ['vencido', 'cotizacion_enviada'],
  ];
  for (const [de, a] of permitidas) assert.equal(puedeTransicionar(de, a), true, `${de} -> ${a}`);
});

test('los estados terminales no salen', () => {
  for (const de of ['rechazado', 'terminado', 'cancelado']) {
    for (const a of ESTADOS) assert.equal(puedeTransicionar(de, a), false, `${de} -> ${a}`);
  }
});

test('cambiarEstado usa un solo filtro por id y estado', async () => {
  const Ticket = ticketFalso();
  const ahora = new Date('2026-10-25T12:00:00.000Z');
  const por = 'user-1';

  const resultado = await cambiarEstado(Ticket, {
    id: 't1',
    de: 'diagnosticado',
    a: 'cotizacion_enviada',
    por,
    ahora,
    establecer: { tokenHash: 'hash-1', tokenVenceEn: new Date('2026-10-28T12:00:00.000Z') },
  });

  assert.deepEqual(resultado, { _id: 't1' });
  assert.equal(Ticket.llamadas.length, 1);
  const { filtro, update, opciones } = Ticket.llamadas[0];
  assert.deepEqual(filtro, { _id: 't1', estado: 'diagnosticado' });
  assert.equal(update.$set.estado, 'cotizacion_enviada');
  assert.equal(update.$set.actualizadoEn, ahora);
  assert.equal(update.$set.tokenHash, 'hash-1');
  assert.ok(update.$set.tokenVenceEn instanceof Date);
  assert.deepEqual(update.$push.historial, {
    de: 'diagnosticado',
    a: 'cotizacion_enviada',
    en: ahora,
    por,
  });
  assert.equal(update.$unset, undefined);
  assert.deepEqual(opciones, { new: true });
});

test('la decision del cliente exige token vigente', async () => {
  const Ticket = ticketFalso();
  const ahora = new Date('2026-10-25T12:00:00.000Z');

  await cambiarEstado(Ticket, {
    id: 't1',
    de: 'cotizacion_enviada',
    a: 'autorizado',
    ahora,
    exigirToken: true,
    tokenHash: 'hash-1',
  });

  const { filtro } = Ticket.llamadas[0];
  assert.deepEqual(filtro, {
    _id: 't1',
    estado: 'cotizacion_enviada',
    tokenHash: 'hash-1',
    tokenVenceEn: { $gt: ahora },
  });
});

test('toda salida de cotizacion_enviada elimina el token en la misma operacion', async () => {
  for (const a of ['autorizado', 'rechazado', 'vencido', 'cancelado']) {
    const Ticket = ticketFalso();
    await cambiarEstado(Ticket, {
      id: 't1',
      de: 'cotizacion_enviada',
      a,
      exigirToken: true,
      tokenHash: 'hash-1',
    });
    const { update } = Ticket.llamadas[0];
    assert.deepEqual(update.$unset, { tokenHash: '' }, a);
    assert.equal('tokenHash' in update.$set, false, a);
  }
});

test('vencido -> cotizacion_enviada fija un token nuevo sin borrarlo', async () => {
  const Ticket = ticketFalso();
  const vence = new Date('2026-10-28T12:00:00.000Z');
  await cambiarEstado(Ticket, {
    id: 't1',
    de: 'vencido',
    a: 'cotizacion_enviada',
    establecer: { tokenHash: 'hash-2', tokenVenceEn: vence },
  });
  const { update } = Ticket.llamadas[0];
  assert.equal(update.$set.tokenHash, 'hash-2');
  assert.equal(update.$set.tokenVenceEn, vence);
  assert.equal(update.$unset, undefined);
});

test('nunca acepta tokenHash vacio ni nulo', async () => {
  const Ticket = ticketFalso();
  for (const tokenHash of [null, '', '   ']) {
    await assert.rejects(
      () =>
        cambiarEstado(Ticket, {
          id: 't1',
          de: 'diagnosticado',
          a: 'cotizacion_enviada',
          establecer: { tokenHash, tokenVenceEn: new Date() },
        }),
      /tokenHash/
    );
  }
  assert.equal(Ticket.llamadas.length, 0);
});

test('exige tokenVenceEn valido junto con tokenHash', async () => {
  const Ticket = ticketFalso();
  await assert.rejects(
    () =>
      cambiarEstado(Ticket, {
        id: 't1',
        de: 'diagnosticado',
        a: 'cotizacion_enviada',
        establecer: { tokenHash: 'hash-1', tokenVenceEn: '2026-10-28' },
      }),
    /tokenVenceEn/
  );
});

test('rechaza una transicion que no esta en el mapa', async () => {
  const Ticket = ticketFalso();
  await assert.rejects(
    () => cambiarEstado(Ticket, { id: 't1', de: 'diagnosticado', a: 'autorizado' }),
    /no permitida/
  );
  assert.equal(Ticket.llamadas.length, 0);
});

test('devuelve null cuando pierde la carrera', async () => {
  const Ticket = ticketFalso(null);
  const resultado = await cambiarEstado(Ticket, {
    id: 't1',
    de: 'cotizacion_enviada',
    a: 'autorizado',
    exigirToken: true,
    tokenHash: 'hash-1',
  });
  assert.equal(resultado, null);
});

test('vencerExpirada marca vencido por id cuando el token ya expiro', async () => {
  const Ticket = ticketFalso();
  const ahora = new Date('2026-10-25T12:00:00.000Z');

  await vencerExpirada(Ticket, { id: 't1', ahora });

  const { filtro, update, opciones } = Ticket.llamadas[0];
  assert.deepEqual(filtro, {
    _id: 't1',
    estado: 'cotizacion_enviada',
    tokenVenceEn: { $lte: ahora },
  });
  assert.equal(update.$set.estado, 'vencido');
  assert.equal(update.$set.actualizadoEn, ahora);
  assert.deepEqual(update.$unset, { tokenHash: '' });
  assert.deepEqual(update.$push.historial, {
    de: 'cotizacion_enviada',
    a: 'vencido',
    en: ahora,
    por: null,
  });
  assert.deepEqual(opciones, { new: true });
});

test('vencerExpirada puede ubicar el ticket solo por token', async () => {
  const Ticket = ticketFalso();
  await vencerExpirada(Ticket, { tokenHash: 'hash-1' });
  const { filtro } = Ticket.llamadas[0];
  assert.equal(filtro.tokenHash, 'hash-1');
  assert.equal('_id' in filtro, false);
  assert.ok(filtro.tokenVenceEn.$lte instanceof Date);
});

test('vencerExpirada devuelve null si otro proceso ya lo cambio', async () => {
  const Ticket = ticketFalso(null);
  assert.equal(await vencerExpirada(Ticket, { id: 't1' }), null);
});

test('vencerExpirada exige id o token', async () => {
  const Ticket = ticketFalso();
  await assert.rejects(() => vencerExpirada(Ticket, {}), /id o el tokenHash/);
  await assert.rejects(() => vencerExpirada(Ticket, { tokenHash: '' }), /tokenHash invalido/);
});
