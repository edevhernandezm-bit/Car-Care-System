const test = require('node:test');
const assert = require('node:assert/strict');

const { LEYENDA, calcularCotizacion } = require('./cotizacion');

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

test('rechaza un tipo de cambio invalido', () => {
  const seleccion = [{ falla: 'bateria', nombre: 'Bateria', precioMinMXN: 100, precioMaxMXN: 200 }];
  assert.throws(() => cotizar(seleccion, { usd_mxn: 0 }), /tipo de cambio/);
  assert.throws(() => cotizar(seleccion, { usd_mxn: NaN }), /tipo de cambio/);
  assert.throws(() => cotizar(seleccion, null), /tipo de cambio/);
});
