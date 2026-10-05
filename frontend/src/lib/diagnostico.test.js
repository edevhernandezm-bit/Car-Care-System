// Pruebas de lib/diagnostico.js con el runner nativo de Node: el modulo es ESM
// plano y no toca el DOM, asi que `node --test` lo importa tal cual, sin un
// bundler ni un framework de pruebas en el medio. Mismo runner que usa el e2e
// (backend/package.json -> npm test).
//
// Los textos de prueba son nombres reales del catalogo de Prolog: asi un test
// que pasa dice algo sobre el dominio y no solo sobre la funcion.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  certezaNivel,
  certezaPorcentaje,
  coincide,
  convertirCosto,
  CORTE_CERTEZA_ALTA,
  CORTE_CERTEZA_MEDIA,
  etiquetaUrgencia,
  mapearProlog,
  tasaEsEstimada,
} from './diagnostico.js';

test('coincide: encuentra con y sin tildes en las dos direcciones', () => {
  assert.ok(coincide('Pérdida de potencia', 'perdida'), 'sin tilde debe encontrar con tilde');
  assert.ok(coincide('Pérdida de potencia', 'pérdida'), 'con tilde debe encontrar con tilde');
  assert.ok(coincide('Ruido metálico en motor', 'RUIDO METALICO'), 'sin tilde y en mayúsculas');
  assert.ok(coincide('Luces débiles', 'debil'), 'la sílaba átona también se queda sin tilde');
});

test('coincide: la eñe se iguala a mano porque NFD no la descompone', () => {
  // Unica falla del catalogo con eñe: sin la regla explicita, "danada" y
  // "dañada" serian cadenas distintas.
  assert.ok(coincide('Junta homocinética dañada', 'danada'));
  assert.ok(coincide('Junta homocinética dañada', 'dañada'));
  assert.ok(coincide('Junta homocinética dañada', 'homocinetica danada'), 'las dos reglas juntas');
});

test('coincide: varias palabras, sin depender del orden', () => {
  assert.ok(coincide('Pastillas de freno desgastadas', 'pastillas freno'));
  assert.ok(coincide('Pastillas de freno desgastadas', 'freno pastillas'), 'orden invertido');
  assert.ok(coincide('Sistema de frenos con aire', 'sistema aire'));
});

test('coincide: todos los tokens tienen que aparecer', () => {
  assert.equal(coincide('Pastillas de freno desgastadas', 'pastillas pinchos'), false);
  assert.equal(coincide('Frenos sobrecalentados', 'pastillas'), false);
});

test('coincide: consulta vacia o solo espacios no filtra nada', () => {
  assert.ok(coincide('Cualquier cosa', ''));
  assert.ok(coincide('Cualquier cosa', '   '));
});

test('coincide: busca sobre la categoria y la urgencia del catalogo', () => {
  const sintomas = 'Humo azul en escape';
  assert.ok(coincide(`${sintomas} Escape`, 'escape'), 'la categoria debe ser buscable');
  const fallas = 'Fuga en sistema de refrigeración';
  assert.ok(coincide(`${fallas} ${etiquetaUrgencia('alta')}`, 'alta'), 'la urgencia debe ser buscable');
});

test('certezaNivel: distingue dato ausente de certeza baja real', () => {
  // Number(null) y Number('') dan 0 en JavaScript: sin esta distincion un campo
  // vacio se presentaria como "Baja 0%", que el motor nunca dijo.
  for (const vacio of [null, undefined, '', 'hola', NaN, {}]) {
    assert.equal(certezaNivel(vacio), 'desconocida', `${JSON.stringify(vacio)} no es una certeza`);
  }
  assert.equal(certezaNivel(0), 'baja', 'un 0 explicito si es una certeza baja');
  assert.equal(certezaPorcentaje(0), 0);
});

test('certezaNivel: los cortes del motor se respetan en el limite', () => {
  assert.equal(certezaNivel(CORTE_CERTEZA_ALTA), 'alta');
  assert.equal(certezaNivel(CORTE_CERTEZA_ALTA - 0.001), 'media');
  assert.equal(certezaNivel(CORTE_CERTEZA_MEDIA), 'media');
  assert.equal(certezaNivel(CORTE_CERTEZA_MEDIA - 0.001), 'baja');
  assert.equal(certezaNivel(1), 'alta');
});

test('convertirCosto: solo convierte usd con una tasa utilizable', () => {
  const usd = { costo_min: 300, costo_max: 1200, moneda: 'usd' };
  assert.deepEqual(convertirCosto(usd, { usd_mxn: 18.3 }), { min: 5490, max: 21960, moneda: 'mxn' });

  // Lo que ya esta en pesos, o una moneda que el motor no declaro, no se toca.
  assert.equal(convertirCosto({ ...usd, moneda: 'mxn' }, { usd_mxn: 18.3 }), null);
  assert.equal(convertirCosto({ ...usd, moneda: '' }, { usd_mxn: 18.3 }), null);

  for (const mala of [null, undefined, {}, { usd_mxn: 0 }, { usd_mxn: -5 }, { usd_mxn: 'mucho' }]) {
    assert.equal(convertirCosto(usd, mala), null, `${JSON.stringify(mala)} no es una tasa usable`);
  }
});

test('tasaEsEstimada: un respaldo nunca se presenta como conversión vigente', () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace10dias = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

  assert.equal(tasaEsEstimada({ usd_mxn: 18.3, fecha: hoy, fuente: 'frankfurter' }), false);
  assert.equal(tasaEsEstimada({ usd_mxn: 18.3, fecha: hoy, fuente: 'frankfurter', es_estimado: true }), true);
  assert.equal(tasaEsEstimada({ usd_mxn: 18.3, fecha: hoy, fuente: 'constante' }), true);
  assert.equal(tasaEsEstimada({ usd_mxn: 18.3, fecha: hace10dias, fuente: 'frankfurter' }), true);
  assert.equal(tasaEsEstimada({ usd_mxn: 18.3, fecha: 'no-es-fecha', fuente: 'frankfurter' }), true);
  assert.equal(tasaEsEstimada(null), true);
});

test('mapearProlog: completa con el catalogo lo que el motor no trae', () => {
  const catalogo = [
    {
      id: 'pastillas_freno',
      nombre: 'Pastillas de freno desgastadas',
      urgencia: 'alta',
      moneda: 'usd',
    },
  ];
  // El motor es la fuente de verdad, pero no repite el nombre en cada respuesta.
  const f = mapearProlog({ id: 'pastillas_freno', certeza: 0.72, costo_min: 300, costo_max: 1200 }, catalogo);
  assert.equal(f.nombre, 'Pastillas de freno desgastadas');
  assert.equal(f.urgencia, 'Alta');
  assert.equal(f.moneda, 'usd', 'sin esto el historial guardaria "" y el costo nunca se convertiria');
  assert.deepEqual(f.reparaciones, [], 'una ausencia es una lista vacia, no undefined');

  // Una falla que el catalogo no conoce conserva su id y no se rompe.
  const desconocida = mapearProlog({ id: 'falla_nueva', certeza: 0.5 }, []);
  assert.equal(desconocida.nombre, 'falla nueva');
  assert.equal(desconocida.urgencia, 'Desconocida');
  assert.deepEqual(desconocida.sintomas_relacionados, []);
});
