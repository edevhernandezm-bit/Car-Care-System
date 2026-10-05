import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  unirPorFalla,
  distribuirPorCerteza,
  filtrarPorBusqueda,
  topFallas,
} from './estadisticas.js';

// El catálogo real trae la urgencia como slug; urgencyClase() espera la
// etiqueta. Estos dos casos son los que fallaban cuando se pasaba el slug.
const CATALOGO = [
  { id: 'aceite_motor_bajo', nombre: 'Aceite de motor bajo', urgencia: 'critica' },
  { id: 'pastillas_freno', nombre: 'Pastillas de freno', urgencia: 'alta' },
  { id: 'correa_distribucion', nombre: 'Correa de distribución', urgencia: 'media' },
  { id: 'vidrio_trasero', nombre: 'Vidrio trasero', urgencia: 'baja' },
];

test('unirPorFalla: compone la etiqueta antes de clasificar la urgencia', () => {
  // Regresión: urgenciaClase('alta') devolvía 'low' porque comparaba contra
  // 'Alta'. Con las 54 del catálogo eso las hundía todas en el nivel bajo.
  const filas = unirPorFalla(
    [
      { falla: 'aceite_motor_bajo', veces: 3, certeza_promedio: 0.91 },
      { falla: 'pastillas_freno', veces: 2, certeza_promedio: 0.88 },
      { falla: 'correa_distribucion', veces: 1, certeza_promedio: 0.66 },
      { falla: 'vidrio_trasero', veces: 1, certeza_promedio: 0.42 },
    ],
    CATALOGO
  );

  const porId = Object.fromEntries(filas.map((f) => [f.id, f]));

  assert.equal(porId.aceite_motor_bajo.clase, 'high', 'crítica es high');
  assert.equal(porId.pastillas_freno.clase, 'high', 'alta es high');
  assert.equal(porId.correa_distribucion.clase, 'medium', 'media es medium');
  assert.equal(porId.vidrio_trasero.clase, 'low', 'baja es low');

  // Y la urgencia se expone como etiqueta, igual que mapearProlog(), no como
  // el slug crudo del catálogo.
  assert.equal(porId.aceite_motor_bajo.urgencia, 'Crítica');
  assert.equal(porId.pastillas_freno.urgencia, 'Alta');
});

test('unirPorFalla: una falla fuera del catálogo conserva el id y no inventa urgencia', () => {
  const [fila] = unirPorFalla([{ falla: 'falla_nueva_2026', veces: 1, certeza_promedio: 0.5 }], CATALOGO);

  // El nombre sale del id con los guiones bajos cambiados por espacios, igual
  // que hace mapearProlog(). Antes esta fila devolvía el id tal cual y en
  // pantalla se leían "falla_nueva_2026" y "Aceite de motor bajo" en la misma
  // columna, según la fila.
  assert.equal(fila.nombre, 'falla nueva 2026', 'el id des-eslugificado es lo único cierto que hay');
  assert.equal(fila.id, 'falla_nueva_2026', 'el id crudo se conserva aparte');
  assert.equal(fila.enCatalogo, false);
  assert.equal(fila.urgencia, null);
  assert.equal(fila.clase, 'sin-urgencia', 'sin catálogo no se inventa una clase de urgencia');
});

test('unirPorFalla: el nombre sale del catálogo cuando lo conoce, no del id', () => {
  // La contraparte del caso anterior: cuando el catálogo sí tiene la falla, su
  // nombre manda. El id solo se usa para buscar.
  const [fila] = unirPorFalla([{ falla: 'correa_distribucion', veces: 1 }], CATALOGO);
  assert.equal(fila.nombre, 'Correa de distribución');
  assert.equal(fila.enCatalogo, true);
});

test('unirPorFalla: separa la certeza ausente del cero real', () => {
  // El backend agrupa por falla, así que un bucket vacío es dato roto, no un
  // promedio de cero. Si se normalizara a 0, el chart lo pintaría como 0%.
  const filas = unirPorFalla(
    [
      { falla: 'pastillas_freno', veces: 2, certeza_promedio: 0 },
      { falla: 'vidrio_trasero', veces: 1 },
    ],
    CATALOGO
  );

  const porId = Object.fromEntries(filas.map((f) => [f.id, f]));
  assert.equal(porId.pastillas_freno.certeza_promedio, 0, 'un 0 explícito es una medición');
  assert.equal(porId.vidrio_trasero.certeza_promedio, null, 'lo ausente no es un 0');
});

test('unirPorFalla: tolera basura de entrada sin lanzar', () => {
  assert.deepEqual(unirPorFalla(null), []);
  assert.deepEqual(unirPorFalla(undefined), []);
  assert.deepEqual(unirPorFalla('nope'), []);

  const filas = unirPorFalla([null, { sinFalla: 1 }, { falla: 'pastillas_freno' }], CATALOGO);
  assert.equal(filas.length, 1, 'solo sobreviven las filas con falla string');
  assert.equal(filas[0].veces, 0, 'veces ausente se normaliza a 0 para que la barra exista');
});

test('unirPorFalla: conserva el orden que ya traer el endpoint', () => {
  const filas = unirPorFalla(
    [
      { falla: 'vidrio_trasero', veces: 1 },
      { falla: 'aceite_motor_bajo', veces: 9 },
      { falla: 'pastillas_freno', veces: 9 },
    ],
    CATALOGO
  );
  // No se reordena: el endpoint ya viene ordenado y un empate en veces no es
  // información que valga la pena romper con un desempate inventado.
  assert.deepEqual(filas.map((f) => f.id), [
    'vidrio_trasero',
    'aceite_motor_bajo',
    'pastillas_freno',
  ]);
});

test('distribuirPorCerteza: cuenta con los cortes del motor y siempre devuelve los cuatro', () => {
  const cortes = distribuirPorCerteza([
    { certeza_promedio: 0.91 },
    { certeza_promedio: 0.85 }, // límite exacto: alta
    { certeza_promedio: 0.7 },
    { certeza_promedio: 0.6 }, // límite exacto: media
    { certeza_promedio: 0.42 },
    { certeza_promedio: null }, // sin dato
  ]);

  const porNivel = Object.fromEntries(cortes.map((c) => [c.nivel, c.fallas]));

  // 0.85 cae en alta y 0.6 en media, igual que certezaNivel y que el motor.
  assert.equal(porNivel.alta, 2);
  assert.equal(porNivel.media, 2);
  assert.equal(porNivel.baja, 1);
  assert.equal(porNivel.desconocida, 1);
  assert.equal(cortes.length, 4, 'el eje no se encoge aunque no haya datos de un corte');
});

test('distribuirPorCerteza: sin filas devuelve los cuatro cortes en cero', () => {
  const cortes = distribuirPorCerteza([]);
  assert.equal(cortes.length, 4);
  assert.ok(cortes.every((c) => c.fallas === 0));
});

test('distribuirPorCerteza: una certeza 0 cuenta como baja, no como sin dato', () => {
  // El motor redondea a dos decimales y puede emitir 0.0 (ver
  // certeza_falla/3 en motor_inferencia.pl). Con 0 legal en el backend, eso es
  // una medición real de la fila, no información que no llegó.
  const cortes = distribuirPorCerteza([{ certeza_promedio: 0 }]);
  const porNivel = Object.fromEntries(cortes.map((c) => [c.nivel, c.fallas]));
  assert.equal(porNivel.baja, 1);
  assert.equal(porNivel.desconocida, 0);
});

test('topFallas: recorta y declara el total para que el recorte sea visible', () => {
  const filas = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, veces: 20 - i }));
  const { filas: top, total, recortadas } = topFallas(filas);

  assert.equal(top.length, 12);
  assert.equal(total, 20);
  assert.equal(recortadas, true, 'sin esto, 12 de 20 parecerían ser todas');
  assert.equal(top[0].id, 'f0', 'el más frecuente sigue primero');
});

test('topFallas: no declara recorte cuando caben todas', () => {
  const filas = [{ id: 'a' }, { id: 'b' }];
  const { filas: top, total, recortadas } = topFallas(filas);
  assert.equal(top.length, 2);
  assert.equal(total, 2);
  assert.equal(recortadas, false);
});

// La búsqueda de Estadísticas. Filtra las filas del historial por nombre y
// urgencia; los contadores de arriba no se tocan.
const HISTORIAL = unirPorFalla(
  [
    { falla: 'aceite_motor_bajo', veces: 5, certeza_promedio: 0.91 },
    { falla: 'pastillas_freno', veces: 4, certeza_promedio: 0.88 },
    { falla: 'correa_distribucion', veces: 3, certeza_promedio: 0.66 },
    { falla: 'vidrio_trasero', veces: 2, certeza_promedio: 0.42 },
    { falla: 'falla_nueva_2026', veces: 1, certeza_promedio: 0.5 },
  ],
  CATALOGO
);

test('filtrarPorBusqueda: una consulta vacía devuelve las filas sin tocar', () => {
  assert.equal(filtrarPorBusqueda(HISTORIAL, '').length, HISTORIAL.length);
  assert.equal(filtrarPorBusqueda(HISTORIAL, '   ').length, HISTORIAL.length);
});

test('filtrarPorBusqueda: busca por nombre de falla', () => {
  const r = filtrarPorBusqueda(HISTORIAL, 'freno');
  assert.deepEqual(r.map((f) => f.id), ['pastillas_freno']);
});

test('filtrarPorBusqueda: busca por urgencia, con y sin tilde', () => {
  // La urgencia se expone como etiqueta ("Crítica"), no como el slug del
  // catálogo ("critica"). Un usuario escribe "critica" sin tilde y tiene que
  // encontrar las misma fila que con "crítica".
  assert.deepEqual(filtrarPorBusqueda(HISTORIAL, 'Crítica').map((f) => f.id), ['aceite_motor_bajo']);
  assert.deepEqual(filtrarPorBusqueda(HISTORIAL, 'critica').map((f) => f.id), ['aceite_motor_bajo']);
});

test('filtrarPorBusqueda: encuentra ids fuera del catálogo', () => {
  // El nombre de esa fila viene del id des-eslugificado, así que "2026" la
  // encuentra sin que nadie tenga que haberle puesto nombre.
  assert.deepEqual(filtrarPorBusqueda(HISTORIAL, '2026').map((f) => f.id), ['falla_nueva_2026']);
});

test('filtrarPorBusqueda: con varias palabras exige que esten todas', () => {
  assert.equal(filtrarPorBusqueda(HISTORIAL, 'distribucion correa').length, 1);
  assert.equal(filtrarPorBusqueda(HISTORIAL, 'correa freno').length, 0, 'están en filas distintas');
});

test('filtrarPorBusqueda: sin coincidencias devuelve lista vacía, no las filas', () => {
  assert.deepEqual(filtrarPorBusqueda(HISTORIAL, 'alternador'), []);
});

test('filtrarPorBusqueda: filtra antes del recorte para no perder una falla del final', () => {
  // El orden importa: si se recortara a 12 primero, "vidrio_trasero" (puesto 4
  // de 5 aquí) sobreviviría, pero con el catálogo real una falla rara que no
  // entra al top se perdería aunque su nombre coincida con la búsqueda.
  const { filas, total } = topFallas(filtrarPorBusqueda(HISTORIAL, 'vidrio'));
  assert.deepEqual(filas.map((f) => f.id), ['vidrio_trasero']);
  assert.equal(total, 1, 'el total es del subconjunto filtrado, no de las 54 del historial');
});

test('filtrarPorBusqueda: tolera basura de entrada sin lanzar', () => {
  assert.deepEqual(filtrarPorBusqueda(null, 'freno'), []);
  assert.deepEqual(filtrarPorBusqueda('nope', 'freno'), []);
  assert.deepEqual(filtrarPorBusqueda(HISTORIAL, null).length, HISTORIAL.length, 'ausente no es filtro');
});
