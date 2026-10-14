// Pruebas del armado del cuerpo de /api/diagnosticos con el runner nativo de
// Node: api.js no toca fetch en este modulo (solo se llama dentro de la
// funcion exportada), asi que `node --test` lo importa sin red ni DOM.
//
// La forma del cuerpo es un contrato con el schema de Diagnostico en
// backend/server.js. Si divergen, el backend responde 400 y el diagnostico se
// pierde en silencio: guardarDiagnostico convierte un !res.ok en null, y la
// vista no tiene nada que mostrar al usuario.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cuerpoDiagnostico, normalizarStatsCerteza } from './api.js';

// mapearProlog produce esta forma: la vista usa `id`, no `falla`.
const fallaDeVista = (over = {}) => ({
  id: 'sistema_frenos_con_aire',
  nombre: 'Sistema de frenos con aire',
  urgencia: 'Alta',
  moneda: 'usd',
  certeza: 0.87,
  reparaciones: [],
  ...over,
});

test('cuerpoDiagnostico: falla viaja como `falla`, no como `id`', () => {
  // El id de la vista tiene que renombrarse. Si se pierde o se cuelga un id,
  // el schema rechaza el documento: falla es required.
  const cuerpo = cuerpoDiagnostico({
    vehiculo: { marca: 'honda', modelo: 'civic', anio: 2015 },
    sintomas: ['chirrido_al_frenar'],
    fallas: [fallaDeVista()],
  });

  assert.equal(cuerpo.fallas[0].falla, 'sistema_frenos_con_aire');
  assert.ok(!('id' in cuerpo.fallas[0]), 'el id de vista no debe viajar al backend');
});

// Esta es la regresion que se dio, reproducida con las dos rutas:
//
//   antes  el llamador mapeaba a {falla: f.id} y guardarDiagnostico volvia a
//          leer `f.id`, que ya no existia -> cuerpo sin `falla` -> 400
//   ahora  el llamador no mapea y el renombrado vive solo aqui -> cuerpo con
//          `falla`
//
// Se comprueba sobre el texto final, que es lo que viaja: el bug vivia
// justamente en ese salto de objeto a JSON.
test('cuerpoDiagnostico: el renombrado ocurre una sola vez', () => {
  const falla = fallaDeVista();

  // Ruta nueva: la forma de vista entra directamente.
  const cuerpoActual = cuerpoDiagnostico({ vehiculo: {}, sintomas: [], fallas: [falla] });
  const textoActual = JSON.stringify(cuerpoActual);
  assert.match(textoActual, /"falla":"sistema_frenos_con_aire"/);

  // Ruta vieja, simulada: el llamador entrega la forma de persistencia y aqui
  // se lee `f.id`, que en esa forma no existe.
  const yaRemapeada = { falla: falla.id, certeza: falla.certeza, nombre: falla.nombre };
  const cuerpoViejo = JSON.stringify(
    cuerpoDiagnostico({ vehiculo: {}, sintomas: [], fallas: [yaRemapeada] })
  );
  // Sin `falla`, el schema responde 400 y el diagnostico se pierde en silencio.
  assert.ok(
    !/"falla":/.test(cuerpoViejo),
    'esta asercion describe el bug: si el cuerpo viejo ya trajera falla, la regresion no seria real'
  );
});

test('cuerpoDiagnostico: una certeza ausente viaja ausente, no como 0', () => {
  // Un 0 de relleno se presentaria como medicion real y, ahora que 0 es legal,
  // contaminaria los promedios de /api/stats/certeza sin que nada lo delate.
  // Lo correcto es que el schema lo rechaze y quede en el log.
  const cuerpo = cuerpoDiagnostico({
    vehiculo: {},
    sintomas: [],
    fallas: [fallaDeVista({ certeza: undefined })],
  });
  const texto = JSON.stringify(cuerpo);
  assert.ok(!texto.includes('"certeza"'), 'la certeza ausente no debe viajar como 0');

  // Y una certeza 0 explicita si viaja: el motor la puede emitir por redondeo.
  const conCero = cuerpoDiagnostico({
    vehiculo: {},
    sintomas: [],
    fallas: [fallaDeVista({ certeza: 0 })],
  });
  assert.equal(conCero.fallas[0].certeza, 0);
  assert.ok(JSON.stringify(conCero).includes('"certeza":0'));
});

test('cuerpoDiagnostico: una consulta sin fallas es una consulta valida', () => {
  // El cliente guarda el diagnostico aunque el motor no devuelva ninguna falla:
  // total_consultas de /api/stats/certeza cuenta documentos, no fallas.
  const cuerpo = cuerpoDiagnostico({ vehiculo: { anio: 0 }, sintomas: [], fallas: [] });
  assert.deepEqual(cuerpo.fallas, []);
  assert.deepEqual(cuerpo.sintomas, []);
});

test('cuerpoDiagnostico: las observaciones se recortan y viajan siempre como texto', () => {
  // El campo es opcional en el schema (default ''), asi que la vista manda ''
  // cuando el mecanico no escribe nada en vez de omitir la clave. Los espacios
  // de los extremos se recortan aqui tambien; el backend lo repite como ultima
  // barrera, pero recortar en el borde evita mandar ruido.
  const conEspacios = cuerpoDiagnostico({
    vehiculo: {},
    sintomas: [],
    fallas: [],
    observaciones: '   prueba de compresión   ',
  });
  assert.equal(conEspacios.observaciones, 'prueba de compresión');

  // Ausente o null colapsan al mismo '' que el esquema espera.
  assert.equal(cuerpoDiagnostico({ vehiculo: {}, sintomas: [], fallas: [] }).observaciones, '');
  assert.equal(
    cuerpoDiagnostico({ vehiculo: {}, sintomas: [], fallas: [], observaciones: null }).observaciones,
    ''
  );
});

// Las fixtures de abajo son copia literal de lo que devuelve el handler
// /api/stats/certeza de backend/server.js. Si cambia un nombre del lado de alla,
// estas pruebas son las que lo dicen en vez de dejar un undefined en pantalla.

test('normalizarStatsCerteza: renombra los campos del endpoint sin perderlos', () => {
  // Payload tal cual lo emite el $group del pipeline de agregacion.
  const stats = normalizarStatsCerteza({
    total_consultas: 7,
    total_fallas_inferidas: 12,
    certeza_promedio_global: 0.72,
    por_falla: [{ falla: 'pastillas_freno', veces: 3, certeza_promedio: 0.8 }],
  });

  assert.equal(stats.totalConsultas, 7);
  assert.equal(stats.totalFallas, 12);
  assert.equal(stats.certezaPromedio, 0.72);
  assert.equal(stats.porFalla.length, 1);
  assert.equal(stats.porFalla[0].falla, 'pastillas_freno', 'porFalla pasa sin tocar: unirPorFalla lee `falla`');
});

test('normalizarStatsCerteza: un promedio sin medir es null, no 0', () => {
  // El backend devuelve null cuando no hay fallas que promediar. Si aqui se
  // convirtiera en 0, la vista dibujaria "certeza media 0%, nivel Bajo": una
  // medicion que el sistema nunca hizo.
  const stats = normalizarStatsCerteza({
    total_consultas: 3,
    total_fallas_inferidas: 0,
    certeza_promedio_global: null,
    por_falla: [],
  });

  assert.equal(stats.certezaPromedio, null);
  assert.equal(stats.totalFallas, 0, 'un conteo ausente si es 0 de verdad');
  assert.equal(stats.totalConsultas, 3);
});

test('normalizarStatsCerteza: un 0 explicito es una certeza medida y se conserva', () => {
  // Con 0 legal en el backend (el motor redondea a dos decimales y puede
  // emitir 0.0), el `??` no debe tragarselo.
  const stats = normalizarStatsCerteza({ certeza_promedio_global: 0 });
  assert.equal(stats.certezaPromedio, 0);
  assert.notEqual(stats.certezaPromedio, null);
});

test('normalizarStatsCerteza: por_falla ausente o de otro tipo no rompe la vista', () => {
  for (const porFalla of [undefined, null, 'nope', {}]) {
    const stats = normalizarStatsCerteza({ por_falla: porFalla });
    assert.deepEqual(stats.porFalla, [], `por_falla ${JSON.stringify(porFalla)} debe quedar en lista vacia`);
  }
});
