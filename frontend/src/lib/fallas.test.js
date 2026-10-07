// Pruebas de lib/fallas.js con el runner nativo de Node, igual que
// diagnostico.test.js: el modulo es ESM plano y puro, sin React ni DOM.
//
// Aqui se prueba lo que el motor necesita recibir. Un formulario que deja pasar
// un identificador vacio o un precio minimo mayor que el maximo no falla en la
// pantalla: falla mas tarde, en Prolog o en la consulta de costos, donde nadie
// sabe de donde salio.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANIO_MAXIMO,
  fallaAFormulario,
  fallaAPayload,
  FALLA_VACIA,
  slugPrologId,
  validarFalla,
} from './fallas.js';

const VALIDA = {
  ...FALLA_VACIA,
  nombre: 'Fuga de aceite en el diferencial',
  sintomas: ['Olor a quemado', 'Mancha de aceite bajo el vehiculo'],
  vehiculo: {
    marca: 'nissan',
    modelo: 'sentra',
    anio: 2012,
    anioDesde: 2010,
    anioHasta: 2015,
    transmision: 'manual',
  },
  causas: ['Sello de diferencial seco'],
  procedimiento: ['Revisar nivel de aceite', 'Sustituir sello'],
  precioMin: 1800,
  precioMax: 4500,
};

test('slugPrologId: normaliza a un functor valido', () => {
  assert.equal(slugPrologId('Fuga de aceite en el diferencial'), 'fuga_de_aceite_en_el_diferencial');
  assert.equal(slugPrologId('Junta homocinética dañada'), 'junta_homocinetica_danada');
  assert.equal(slugPrologId('  spaces  raros  '), 'spaces_raros');
  assert.equal(slugPrologId('!!!'), '', 'sin letras ni numeros no hay identificador');
});

test('validarFalla: una falla completa pasa sin errores', () => {
  assert.deepEqual(validarFalla(VALIDA), {});
});

test('validarFalla: el nombre es obligatorio y tiene que producir identificador', () => {
  assert.ok(validarFalla({ ...VALIDA, nombre: '   ' }).nombre);
  assert.ok(validarFalla({ ...VALIDA, nombre: '***' }).nombre);
});

test('validarFalla: exige al menos un sintoma', () => {
  assert.ok(validarFalla({ ...VALIDA, sintomas: [] }).sintomas);
  // Espacios en blanco no son un sintoma: si contaran, el sintoma viaja a Prolog
  // como una cadena vacia que nunca casa con nada.
  assert.ok(validarFalla({ ...VALIDA, sintomas: ['  ', ''] }).sintomas);
});

test('validarFalla: el rango de precios se comprueba en los dos sentidos', () => {
  assert.ok(validarFalla({ ...VALIDA, precioMin: -1 }).precioMin);
  assert.ok(validarFalla({ ...VALIDA, precioMax: -5 }).precioMax);
  assert.ok(validarFalla({ ...VALIDA, precioMin: 5000, precioMax: 100 }).precioMax);
});

test('validarFalla: un campo de precio vacio no se reporta como rango invertido', () => {
  // El minimo en blanco y el maximo en 100: decir "el maximo no puede ser menor
  // que el minimo" seria un segundo error del mismo campo, del mismo envio.
  const errores = validarFalla({ ...VALIDA, precioMin: '', precioMax: 100 });
  assert.ok(errores.precioMin);
  assert.equal(errores.precioMax, undefined);
});

test('validarFalla: el precio vacio se distingue del precio no numerico', () => {
  assert.ok(validarFalla({ ...VALIDA, precioMin: '' }).precioMin);
  assert.ok(validarFalla({ ...VALIDA, precioMin: 'mil' }).precioMin);
});

test('validarFalla: el rango de años usa 0 como "no lo sé" y descarta el futuro', () => {
  const conAnios = (desde, hasta) => ({
    ...VALIDA,
    vehiculo: { ...VALIDA.vehiculo, anio: desde, anioDesde: desde, anioHasta: hasta },
  });
  assert.equal(validarFalla(conAnios(0, 0)).anioDesde, undefined, '0 significa cualquier año');
  assert.ok(validarFalla(conAnios(-1, 2015)).anioDesde);
  assert.ok(validarFalla(conAnios(2000, 3000)).anioHasta);
  assert.ok(validarFalla(conAnios(2015.5, 2020)).anioDesde);
  assert.equal(ANIO_MAXIMO, new Date().getFullYear(), 'el tope se recalcula, no es un literal');
});

test('validarFalla: el rango de años no puede estar invertido', () => {
  const errores = validarFalla({
    ...VALIDA,
    vehiculo: { ...VALIDA.vehiculo, anio: 2020, anioDesde: 2020, anioHasta: 2010 },
  });
  assert.ok(errores.anioHasta);
});

test('validarFalla: un extremo de año vacío no se reporta como rango invertido', () => {
  const errores = validarFalla({
    ...VALIDA,
    vehiculo: { ...VALIDA.vehiculo, anio: 0, anioDesde: 0, anioHasta: 2020 },
  });
  assert.equal(errores.anioHasta, undefined);
});

test('validarFalla: marca y modelo son obligatorios', () => {
  // Sin marca ni modelo la falla se afirmaria aplicable a cualquier vehiculo y
  // apareceria en diagnosticos de coches que no la tienen.
  assert.ok(validarFalla({ ...VALIDA, vehiculo: { ...VALIDA.vehiculo, marca: '' } }).marca);
  assert.ok(validarFalla({ ...VALIDA, vehiculo: { ...VALIDA.vehiculo, modelo: '  ' } }).modelo);
});

test('fallaAPayload: el rango de años viaja sin ordenar para que la validación lo vea', () => {
  // Si el payload normalizara el orden, `validarFalla` nunca veria el rango
  // invertido y el usuario no sabria que lo escribio al reves. Ordenarlo es
  // tarea de la persistencia.
  const payload = fallaAPayload({
    ...VALIDA,
    vehiculo: { ...VALIDA.vehiculo, anio: 2020, anioDesde: 2020, anioHasta: 2010 },
  });
  assert.equal(payload.vehiculo.anioDesde, 2020);
  assert.equal(payload.vehiculo.anioHasta, 2010);
  assert.ok(validarFalla({ ...VALIDA, vehiculo: { ...VALIDA.vehiculo, anio: 2020, anioDesde: 2020, anioHasta: 2010 } }).anioHasta);
});

test('fallaAPayload: un documento con solo anio abre el rango con ese año', () => {
  // Las filas guardadas antes del rango no tienen anioDesde/anioHasta.
  const payload = fallaAPayload({
    ...VALIDA,
    vehiculo: { marca: 'nissan', modelo: 'sentra', anio: 2012, transmision: 'manual' },
  });
  assert.equal(payload.vehiculo.anioDesde, 2012);
  assert.equal(payload.vehiculo.anioHasta, 2012);
});

test('validarFalla: causas y procedimiento no pueden quedar vacios', () => {
  // El diagnostico los imprime como si fueran el porque y el como: sin ellos la
  // falla entra al motor y sale una recomendacion que no explica nada.
  assert.ok(validarFalla({ ...VALIDA, causas: [] }).causas);
  assert.ok(validarFalla({ ...VALIDA, procedimiento: [] }).procedimiento);
});

test('fallaAPayload: las listas de texto salen limpias y como arrays', () => {
  const payload = fallaAPayload({
    ...VALIDA,
    causas: [' Sello seco ', '', '  '],
    procedimiento: ['Paso 1', ''],
  });
  assert.deepEqual(payload.causas, ['Sello seco']);
  assert.deepEqual(payload.procedimiento, ['Paso 1']);
  assert.deepEqual(payload.sintomas, VALIDA.sintomas);
});

test('fallaAPayload: los precios salen como numero, no como cadena del input', () => {
  // El input type=number entrega texto. Sin Number(), el schema lo guardaria
  // como cadena y la resta de precios compararia "1800" con 4500 como texto.
  const payload = fallaAPayload({ ...VALIDA, precioMin: '1800', precioMax: '4500' });
  assert.equal(payload.precioMin, 1800);
  assert.equal(payload.precioMax, 4500);
});

test('fallaAFormulario: conserva solo lo editable y no filtra lo de solo lectura', () => {
  // El documento de MongoDB trae prologId, activo, _id y creadoPor. Si el
  // formulario los copiara, volverian en el PUT como campos que el usuario no
  // toco y el backend tendria que defenderse.
  const doc = {
    _id: 'abc123',
    prologId: 'fuga_de_aceite',
    activo: true,
    deletedAt: null,
    creadoPor: { username: 'admin', nombre: 'Administrador' },
    ...VALIDA,
  };
  const form = fallaAFormulario(doc);

  assert.equal(form.nombre, doc.nombre);
  assert.deepEqual(form.sintomas, doc.sintomas);
  assert.equal(form.prologId, undefined);
  assert.equal(form.activo, undefined);
  assert.equal(form.creadoPor, undefined);
  assert.deepEqual(fallaAPayload(form).nombre, doc.nombre);
});

test('fallaAFormulario: un documento sin listas no rompe el formulario', () => {
  // El schema permite omitir causas y procedimiento. Abrirlos para editar no
  // puede lanzar sobre undefined.
  const form = fallaAFormulario({ nombre: 'X', precioMin: 1, precioMax: 2 });
  assert.deepEqual(form.sintomas, []);
  assert.deepEqual(form.causas, []);
  assert.deepEqual(form.procedimiento, []);
});