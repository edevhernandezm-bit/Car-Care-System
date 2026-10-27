import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerTokenDeHash, construirCuerpoDecision, normalizarComentario, formatoMonto, formatoVigencia } from './cotizacionPublica.js';

const token = 'a'.repeat(43);
test('acepta token válido', () => assert.equal(leerTokenDeHash(`#${token}`), token));
test('rechaza token inválido', () => assert.equal(leerTokenDeHash('#abc!'), null));
test('rechaza hash vacío', () => assert.equal(leerTokenDeHash(''), null));
test('rechaza caracteres extra', () => assert.equal(leerTokenDeHash(`#${token}?x`), null));
test('autorizar omite motivo y comentario', () => assert.deepEqual(construirCuerpoDecision(token, 'autorizar', 'otro', 'texto'), { token, decision: 'autorizar' }));
test('rechazar incluye motivo y comentario normalizado', () => assert.deepEqual(construirCuerpoDecision(token, 'rechazar', 'otro', '  una\r\ndos  '), { token, decision: 'rechazar', motivo: 'otro', comentario: 'una\ndos' }));
test('omite comentario vacío', () => assert.equal(normalizarComentario('   '), undefined));
test('limita comentario a 500 caracteres', () => assert.equal(normalizarComentario('a'.repeat(501)).length, 500));
test('formatea montos con miles y dos decimales', () => assert.equal(formatoMonto(12345.5), '12,345.50'));
test('formatea vigencia válida', () => assert.ok(formatoVigencia('2026-10-25T12:00:00Z')));
