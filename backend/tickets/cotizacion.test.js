const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEYENDA,
  LEYENDA_PRECIO_FINAL,
  centavosPrecioFinal,
  calcularCotizacion,
  precioCatalogoEnMXN,
} = require('./cotizacion');

const diagnostico = [
  { falla: 'bateria', nombre: 'Bateria' },
  { falla: 'frenos', nombre: 'Frenos' },
  { falla: 'aceite', nombre: 'Aceite' },
];

const tasa = { usd_mxn: 18.3, fecha: '2026-10-25', fuente: 'prueba' };

function cotizar(seleccionadas, tipoCambio = tasa) {
  return calcularCotizacion({
    fallasSeleccionadas: seleccionadas,
    fallasDiagnostico: diagnostico,
    tipoCambio,
  });
}

test('0.1 + 0.2 da 0.3 (suma en centavos)', () => {
  const resultado = cotizar([
    { falla: 'bateria', nombre: 'Bateria', precioMinMXN: 0.1, precioMaxMXN: 0.1 },
    { falla: 'frenos', nombre: 'Frenos', precioMinMXN: 0.2, precioMaxMXN: 0.2 },
  ]);
  assert.equal(resultado.totalMinMXN, 0.3);
  assert.equal(resultado.totalMaxMXN, 0.3);
  assert.notEqual(resultado.totalMinMXN, 0.1 + 0.2);
});

test('suma y redondea a dos decimales', () => {
  const resultado = cotizar([
    { falla: 'bateria', nombre: 'Bateria', precioMinMXN: 1200.55, precioMaxMXN: 1300.45 },
    { falla: 'frenos', nombre: 'Frenos', precioMinMXN: 300.45, precioMaxMXN: 399.55 },
  ]);
  assert.equal(resultado.totalMinMXN, 1501);
  assert.equal(resultado.totalMaxMXN, 1700);
  assert.deepEqual(resultado.fallas[0], {
    falla: 'bateria',
    nombre: 'Bateria',
    precioMinMXN: 1200.55,
    precioMaxMXN: 1300.45,
  });
});

test('convierte a USD con la tasa congelada', () => {
  const resultado = cotizar(
    [{ falla: 'bateria', nombre: 'Bateria', precioMinMXN: 1830, precioMaxMXN: 3660 }],
    { usd_mxn: 18.3, fecha: '2026-10-25', fuente: 'prueba' }
  );
  assert.equal(resultado.totalMinUSD, 100);
  assert.equal(resultado.totalMaxUSD, 200);
  assert.deepEqual(resultado.tipoCambio, {
    usd_mxn: 18.3,
    fecha: '2026-10-25',
    fuente: 'prueba',
  });
});

test('la leyenda es fija', () => {
  const resultado = cotizar([
    { falla: 'aceite', nombre: 'Aceite', precioMinMXN: 100, precioMaxMXN: 200 },
  ]);
  assert.equal(resultado.leyenda, LEYENDA);
  assert.equal(resultado.leyenda, 'No incluye mano de obra');
});

test('rechaza una seleccion vacia', () => {
  assert.throws(() => cotizar([]), /al menos una falla/);
  assert.throws(() => cotizar(undefined), /al menos una falla/);
});

test('rechaza una falla ajena al diagnostico', () => {
  assert.throws(
    () => cotizar([{ falla: 'motor', nombre: 'Motor', precioMinMXN: 1, precioMaxMXN: 2 }]),
    /no pertenece al diagnostico/
  );
});

test('colapsa duplicados para no cobrar dos veces', () => {
  const resultado = cotizar([
    { falla: 'bateria', nombre: 'Bateria', precioMinMXN: 100, precioMaxMXN: 200 },
    { falla: 'bateria', nombre: 'Bateria', precioMinMXN: 100, precioMaxMXN: 200 },
  ]);
  assert.equal(resultado.fallas.length, 1);
  assert.equal(resultado.totalMinMXN, 100);
  assert.equal(resultado.totalMaxMXN, 200);
});

test('rechaza precios invalidos', () => {
  assert.throws(
    () => cotizar([{ falla: 'bateria', nombre: 'Bateria', precioMinMXN: -1, precioMaxMXN: 2 }]),
    /no negativo/
  );
  assert.throws(
    () => cotizar([{ falla: 'bateria', nombre: 'Bateria', precioMinMXN: 300, precioMaxMXN: 200 }]),
    /no puede superar/
  );
  assert.throws(
    () => cotizar([{ falla: 'bateria', nombre: 'Bateria', precioMinMXN: NaN, precioMaxMXN: 2 }]),
    /no negativo/
  );
});

test('convierte USD del catalogo a MXN con un solo redondeo por extremo', () => {
  const resultado = precioCatalogoEnMXN(
    { costo_min: 3000, costo_max: 4700, moneda: 'usd' },
    { usd_mxn: 18.3 }
  );
  assert.deepEqual(resultado, {
    monedaOrigen: 'USD',
    costoMinOrigen: 3000,
    costoMaxOrigen: 4700,
    precioMinMXN: 54900,
    precioMaxMXN: 86010,
  });
  assert.equal(resultado.precioMinMXN, Math.round(3000 * 18.3 * 100) / 100);
});

test('acepta MXN en mayusculas y rechaza monedas desconocidas', () => {
  const mxn = precioCatalogoEnMXN(
    { costo_min: 100, costo_max: 200, moneda: 'MXN' },
    { usd_mxn: 18.3 }
  );
  assert.equal(mxn.monedaOrigen, 'MXN');
  assert.equal(mxn.precioMinMXN, 100);

  assert.throws(
    () => precioCatalogoEnMXN({ costo_min: 1, costo_max: 2, moneda: 'eur' }, { usd_mxn: 18.3 }),
    /moneda/
  );
});

test('rechaza costos del catalogo no finitos, negativos o invertidos', () => {
  const tasa = { usd_mxn: 18.3 };
  for (const falla of [
    { costo_min: NaN, costo_max: 2, moneda: 'mxn' },
    { costo_min: -1, costo_max: 2, moneda: 'mxn' },
    { costo_min: 300, costo_max: 200, moneda: 'mxn' },
    { costo_min: '1', costo_max: 2, moneda: 'mxn' },
  ]) {
    assert.throws(() => precioCatalogoEnMXN(falla, tasa), /costos invalidos/);
  }
  assert.throws(
    () => precioCatalogoEnMXN({ costo_min: 1, costo_max: 2, moneda: 'usd' }, { usd_mxn: 0 }),
    /tipo de cambio/
  );
});

test('rechaza un tipo de cambio invalido', () => {
  const seleccion = [{ falla: 'bateria', nombre: 'Bateria', precioMinMXN: 100, precioMaxMXN: 200 }];
  assert.throws(() => cotizar(seleccion, { usd_mxn: 0 }), /tipo de cambio/);
  assert.throws(() => cotizar(seleccion, { usd_mxn: NaN }), /tipo de cambio/);
  assert.throws(() => cotizar(seleccion, null), /tipo de cambio/);
});

test('la leyenda del precio final incluye la mano de obra', () => {
  assert.equal(LEYENDA_PRECIO_FINAL, 'Incluye mano de obra');
});

for (const [valor, centavos] of [
  [19.99, 1999],
  [0.1, 10],
  [1234.5, 123450],
  [9999999.99, 999999999],
]) {
  test(`acepta el precio final ${valor}`, () => {
    assert.equal(centavosPrecioFinal(valor), centavos);
  });
}

for (const [nombre, valor] of [
  ['tres decimales', 10.001],
  ['texto', '500'],
  ['notación exponencial', '1e3'],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['cero', 0],
  ['negativo', -1],
  ['fuera del máximo', 10000000],
]) {
  test(`rechaza el precio final con ${nombre}`, () => {
    assert.equal(centavosPrecioFinal(valor), null);
  });
}
