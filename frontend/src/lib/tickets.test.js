import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  puedeUsarTickets,
  validarPrecioFinal,
  normalizarPrecioFinal,
  envioPendiente,
  requiereAtencionPorEstado,
  textoCodigoEnvio,
  cuerpoCrearTicket,
  validarCliente,
} from './tickets.js';

test('puedeUsarTickets: admin sin flag -> false', () => {
  assert.equal(puedeUsarTickets({ role: 'administrador_mecanico', features: { tickets: false } }), false);
});

test('puedeUsarTickets: flag sin admin -> false', () => {
  assert.equal(puedeUsarTickets({ role: 'estudiante_mecanica', features: { tickets: true } }), false);
});

test('puedeUsarTickets: estudiante -> false', () => {
  assert.equal(puedeUsarTickets({ role: 'estudiante_mecanica', features: { tickets: true } }), false);
});

test('puedeUsarTickets: ambos -> true', () => {
  assert.equal(puedeUsarTickets({ role: 'administrador_mecanico', features: { tickets: true } }), true);
});

test('validacion de precio: 19.99 válido', () => {
  assert.equal(validarPrecioFinal(19.99), true);
  assert.equal(normalizarPrecioFinal(19.99), 19.99);
});

test('validacion de precio: 0.1 válido', () => {
  assert.equal(validarPrecioFinal(0.1), true);
  assert.equal(normalizarPrecioFinal(0.1), 0.1);
});

test('validacion de precio: "1,500" inválido', () => {
  assert.equal(validarPrecioFinal('1,500'), false);
  assert.equal(normalizarPrecioFinal('1,500'), null);
});

test('validacion de precio: 10.001 inválido', () => {
  assert.equal(validarPrecioFinal(10.001), false);
  assert.equal(normalizarPrecioFinal(10.001), null);
});

test('validacion de precio: 0 inválido', () => {
  assert.equal(validarPrecioFinal(0), false);
  assert.equal(normalizarPrecioFinal(0), null);
});

test('validacion de precio: negativo inválido', () => {
  assert.equal(validarPrecioFinal(-5), false);
  assert.equal(normalizarPrecioFinal(-5), null);
});

test('validacion de precio: vacío inválido', () => {
  assert.equal(validarPrecioFinal(''), false);
  assert.equal(validarPrecioFinal(null), false);
  assert.equal(validarPrecioFinal(undefined), false);
});

test('validacion de precio: 10000000 inválido', () => {
  assert.equal(validarPrecioFinal(10000000), false);
  assert.equal(normalizarPrecioFinal(10000000), null);
});

test('marca de envío pendiente', () => {
  assert.equal(envioPendiente({ estado: 'cotizacion_enviada', envio: { enviado: false } }), true);
  assert.equal(envioPendiente({ estado: 'cotizacion_enviada', envio: { enviado: true } }), false);
  assert.equal(envioPendiente({ estado: 'diagnosticado', envio: { enviado: false } }), false);
});

test('requiere atención por estado', () => {
  assert.equal(requiereAtencionPorEstado('autorizado'), true);
  assert.equal(requiereAtencionPorEstado('rechazado'), true);
  assert.equal(requiereAtencionPorEstado('vencido'), true);
  assert.equal(requiereAtencionPorEstado('diagnosticado'), false);
  assert.equal(requiereAtencionPorEstado('cotizacion_enviada'), false);
});

test('texto por código de envío: tiempo_agotado', () => {
  assert.match(textoCodigoEnvio('tiempo_agotado'), /tardó/);
});

test('texto por código de envío: error_red', () => {
  assert.match(textoCodigoEnvio('error_red'), /conexión/);
});

test('texto por código de envío: sin_proveedor', () => {
  assert.match(textoCodigoEnvio('sin_proveedor'), /pruebas/);
});

test('texto por código de envío: destinatario_invalido', () => {
  assert.match(textoCodigoEnvio('destinatario_invalido'), /inválido/);
});

test('texto por código de envío: simulado', () => {
  assert.match(textoCodigoEnvio('simulado'), /cuenta registrada/);
});

test('texto por código de envío: desconocido', () => {
  assert.match(textoCodigoEnvio('desconocido'), /desconocido/);
});

test('texto por código de envío: proveedor_403', () => {
  assert.match(textoCodigoEnvio('proveedor_403'), /403/);
});

test('texto por código de envío: proveedor_<status> genérico', () => {
  assert.match(textoCodigoEnvio('proveedor_500'), /500/);
});

test('cuerpo de crearTicket sin precios', () => {
  const cuerpo = cuerpoCrearTicket({
    diagnosticoId: 'abc123',
    fallasIds: ['f1', 'f2'],
    cliente: { nombre: 'Ana', correo: 'ana@test.com' },
  });
  assert.equal(cuerpo.diagnosticoId, 'abc123');
  assert.deepEqual(cuerpo.fallasIds, ['f1', 'f2']);
  assert.deepEqual(cuerpo.cliente, { nombre: 'Ana', correo: 'ana@test.com' });
  assert.ok(!('precios' in cuerpo));
  assert.ok(!('precioFinalMXN' in cuerpo));
  assert.ok(!('totalMinMXN' in cuerpo));
});

test('valida datos del cliente y límites del backend', () => {
  assert.equal(validarCliente({ nombre: 'Ana', correo: 'a@b.mx', telefono: '' }), true);
  assert.equal(validarCliente({ nombre: ' ', correo: 'a@b.mx', telefono: '' }), false);
  assert.equal(validarCliente({ nombre: 'Ana', correo: 'invalido', telefono: '' }), false);
  assert.equal(validarCliente({ nombre: 'Ana', correo: 'a@b.mx', telefono: '1'.repeat(31) }), false);
});

test('el precio respeta el formato estricto sin espacios', () => {
  assert.equal(validarPrecioFinal(' 19.99'), false);
  assert.equal(validarPrecioFinal('9999999.99'), true);
  assert.equal(validarPrecioFinal('1.'), false);
});
