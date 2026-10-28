import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { argumentos, calcularGrupo, desviacionMuestral, generar, hashCorte, markdown, media, normalizar, prepararDiagnosticos, validarCorte, variantes } from './estadisticas-corte.mjs';

const diagnostico = (id, certeza, observaciones = '') => ({ _id: id, creado_en: '2026-10-28T00:00:00Z', origen: 'usuario', vehiculo: { marca: ' Nissán ', modelo: '  A  B ' }, fallas: [{ falla: 'f1', certeza, urgencia: ' ALTA ' }], observaciones });

test('media y desviación muestral manejan muestras pequeñas', () => {
  assert.equal(media([]), null);
  assert.equal(media([1, 2, 3]), 2);
  assert.equal(desviacionMuestral([]), null);
  assert.equal(desviacionMuestral([1]), null);
  assert.equal(desviacionMuestral([1, 2, 3]), 1);
});

test('bandas incluyen los límites y las estadísticas usan fallas inferidas', () => {
  const grupo = calcularGrupo([diagnostico('1', 0.85), diagnostico('2', 0.6), diagnostico('3', 0.59)]);
  assert.equal(grupo.bandas.alta.cantidad, 1);
  assert.equal(grupo.bandas.media.cantidad, 1);
  assert.equal(grupo.bandas.baja.cantidad, 1);
  assert.equal(grupo.certeza.mediana, 0.6);
  assert.equal(grupo.fallas_distintas, 1);
  assert.equal(grupo.fallas_por_diagnostico.media, 1);
});

test('grupo vacío no divide entre cero y un único valor no tiene desviación muestral', () => {
  const vacio = calcularGrupo([]);
  assert.equal(vacio.certeza.media, null);
  assert.equal(vacio.certeza.mediana, null);
  assert.equal(vacio.certeza.desviacion_muestral, null);
  assert.equal(vacio.bandas.alta.porcentaje, null);
  assert.equal(vacio.observaciones.porcentaje, null);
  assert.equal(vacio.fallas_por_diagnostico.minimo, null);
  assert.equal(calcularGrupo([diagnostico('1', 0)]).certeza.desviacion_muestral, null);
});

test('normaliza variantes sin alterar los datos originales', () => {
  const a = diagnostico('1', 0.6, 'texto');
  const b = diagnostico('2', 0.7);
  b.vehiculo.marca = 'nissan';
  assert.equal(normalizar('  Nissán   Á B ', true), 'nissan a b');
  assert.equal(normalizar('  CrÍtica  '), 'crítica');
  assert.deepEqual(variantes([a, b]).marca[0].variantes, [' Nissán ', 'nissan']);
  assert.equal(a.vehiculo.marca, ' Nissán ');
});

test('corte exige zona y rechaza fechas inexistentes', () => {
  assert.throws(() => validarCorte('2026-10-28T20:00:00'));
  assert.throws(() => validarCorte('2026-02-30T20:00:00Z'));
  assert.equal(validarCorte('2026-10-28T20:00:00-06:00').toISOString(), '2026-10-29T02:00:00.000Z');
});

test('argumentos exigen salida y HTTPS remoto sin credenciales', () => {
  const base = ['--url', 'https://ejemplo.invalid', '--corte', '2026-10-28T20:00:00Z', '--salida', 'salida'];
  assert.equal(argumentos(base).soloConteo, false);
  assert.throws(() => argumentos(base.slice(0, -2)));
  assert.throws(() => argumentos(['--url', 'http://ejemplo.invalid', ...base.slice(2)]));
  assert.throws(() => argumentos(['--url', 'https://usuario:clave@ejemplo.invalid', ...base.slice(2)]));
  assert.equal(argumentos(['--url', 'http://localhost:5000', ...base.slice(2)]).url, 'http://localhost:5000');
});

test('filtra fecha y rechaza certeza inválida', () => {
  const filas = [diagnostico('1', 0.85), { ...diagnostico('2', 0.5), creado_en: '2026-10-29T00:00:00Z' }];
  assert.deepEqual(prepararDiagnosticos(filas, validarCorte('2026-10-28T00:00:00Z')), [filas[0]]);
  assert.throws(() => prepararDiagnosticos([diagnostico('3', 1.1)], new Date()));
});

test('hash es canónico y solo conserva la longitud de observaciones', () => {
  const a = diagnostico('a', 0.5, 'abcd');
  const b = diagnostico('b', 0.8, 'xyz');
  assert.equal(hashCorte([a, b]), hashCorte([b, { ...a, observaciones: 'wxyz' }]));
  assert.notEqual(hashCorte([a, b]), hashCorte([{ ...a, observaciones: 'a' }, b]));
});

test('informe no incluye observaciones completas ni campos personales', () => {
  const dato = { ...diagnostico('id-privado', 0.5, 'texto confidencial'), nombre: 'nombre privado', usuario: 'id-usuario' };
  const informe = { corte: '2026-10-28T00:00:00Z', generado_en: '2026-10-29T00:00:00Z', sha256: hashCorte([dato]), potencialmente_truncado: true, grupos: { reales: calcularGrupo([dato]) }, variantes: variantes([dato]) };
  const salida = JSON.stringify(informe) + markdown(informe);
  for (const secreto of ['texto confidencial', 'nombre privado', 'id-usuario', 'id-privado']) assert.equal(salida.includes(secreto), false);
  assert.match(markdown(informe), /se usó --forzar/);
});

test('aborta lista de 100 sin generar archivo ni contactar la red', async () => {
  const opciones = argumentos(['--url', 'https://ejemplo.invalid', '--corte', '2026-10-28T20:00:00Z', '--salida', 'inexistente']);
  const llamadas = [];
  const simular = async (url, config) => {
    llamadas.push({ url, config });
    if (llamadas.length === 1) return { ok: true, json: async () => ({ role: 'administrador_mecanico' }), headers: { getSetCookie: () => ['sesion=valor; HttpOnly'] } };
    return { ok: true, json: async () => Array.from({ length: 100 }, (_, i) => diagnostico(String(i), 0.6)) };
  };
  await assert.rejects(generar(opciones, 'usuario', 'clave', simular), /100 filas.*truncado/);
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[0].config.redirect, 'error');
  assert.equal(llamadas[1].config.headers.cookie, 'sesion=valor');
  assert.equal(llamadas[1].config.redirect, 'error');
});

test('forzar declara truncamiento en ambos informes sin incluir datos privados', async () => {
  const carpeta = await mkdtemp(path.join(tmpdir(), 'corte-test-'));
  try {
    const opciones = argumentos(['--url', 'https://ejemplo.invalid', '--corte', '2026-10-28T20:00:00Z', '--salida', carpeta, '--forzar']);
    const datos = Array.from({ length: 100 }, (_, i) => ({ ...diagnostico(String(i), 0.6, 'observación privada'), nombre: 'nombre privado' }));
    const simular = async (url) => url.endsWith('/login')
      ? { ok: true, json: async () => ({ role: 'administrador_mecanico' }), headers: { getSetCookie: () => ['sesion=valor; HttpOnly'] } }
      : { ok: true, json: async () => datos };
    await generar(opciones, 'usuario', 'clave', simular);
    const json = await readFile(path.join(carpeta, 'estadisticas-2026-10-28T20-00-00Z.json'), 'utf8');
    const md = await readFile(path.join(carpeta, 'estadisticas-2026-10-28T20-00-00Z.md'), 'utf8');
    assert.equal(JSON.parse(json).potencialmente_truncado, true);
    assert.match(md, /se usó --forzar/);
    for (const salida of [json, md]) {
      assert.equal(salida.includes('observación privada'), false);
      assert.equal(salida.includes('nombre privado'), false);
    }
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
});
