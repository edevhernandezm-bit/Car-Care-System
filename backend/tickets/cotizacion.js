const LEYENDA = 'No incluye mano de obra';

// Los precios llegan como numero decimal; se suman en centavos enteros para
// que 0.1 + 0.2 no se convierta en 0.30000000000000004.
function aCentavos(valor, campo) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${campo} debe ser un numero no negativo.`);
  }
  return Math.round(n * 100);
}

// Traduce una falla del catalogo del motor a precios MXN y conserva el dato
// original para que el snapshot del ticket sea auditable. La moneda del motor
// llega como 'mxn'/'usd' (estaticas) o 'MXN' (dinamicas): se normaliza.
function precioCatalogoEnMXN(falla, tipoCambio) {
  if (typeof falla?.costo_min !== 'number' || typeof falla?.costo_max !== 'number') {
    throw new Error('El catalogo trae costos invalidos.');
  }
  const min = falla.costo_min;
  const max = falla.costo_max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0 || min > max) {
    throw new Error('El catalogo trae costos invalidos.');
  }

  const moneda = String(falla.moneda ?? '').trim().toLowerCase();
  if (moneda === 'mxn') {
    return {
      monedaOrigen: 'MXN',
      costoMinOrigen: min,
      costoMaxOrigen: max,
      precioMinMXN: min,
      precioMaxMXN: max,
    };
  }
  if (moneda === 'usd') {
    const usd = Number(tipoCambio?.usd_mxn);
    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error('El tipo de cambio no es utilizable.');
    }
    // Un solo redondeo por extremo: se pasa de USD a centavos de MXN directo.
    const minCentavos = Math.round(min * usd * 100);
    const maxCentavos = Math.round(max * usd * 100);
    return {
      monedaOrigen: 'USD',
      costoMinOrigen: min,
      costoMaxOrigen: max,
      precioMinMXN: minCentavos / 100,
      precioMaxMXN: maxCentavos / 100,
    };
  }
  throw new Error('La moneda del catalogo no es reconocida.');
}

function calcularCotizacion({ fallasSeleccionadas, fallasDiagnostico, tipoCambio } = {}) {
  if (!Array.isArray(fallasSeleccionadas) || fallasSeleccionadas.length === 0) {
    throw new Error('Selecciona al menos una falla para cotizar.');
  }

  const idsDiagnostico = new Set(
    (Array.isArray(fallasDiagnostico) ? fallasDiagnostico : []).map((f) => f?.falla)
  );

  const unicas = new Map();
  for (const item of fallasSeleccionadas) {
    const id = typeof item?.falla === 'string' ? item.falla.trim() : '';
    if (!id) throw new Error('Cada falla seleccionada debe traer su identificador.');
    if (!idsDiagnostico.has(id)) {
      throw new Error(`La falla "${id}" no pertenece al diagnostico.`);
    }
    if (unicas.has(id)) continue;

    const min = aCentavos(item.precioMinMXN, `precioMinMXN de ${id}`);
    const max = aCentavos(item.precioMaxMXN, `precioMaxMXN de ${id}`);
    if (min > max) {
      throw new Error(`El precio minimo de "${id}" no puede superar al maximo.`);
    }
    unicas.set(id, {
      falla: id,
      nombre: typeof item.nombre === 'string' && item.nombre.trim() ? item.nombre.trim() : id,
      precioMinMXN: min,
      precioMaxMXN: max,
    });
  }

  const usd = Number(tipoCambio?.usd_mxn);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error('El tipo de cambio no es utilizable.');
  }

  let minCentavos = 0;
  let maxCentavos = 0;
  for (const falla of unicas.values()) {
    minCentavos += falla.precioMinMXN;
    maxCentavos += falla.precioMaxMXN;
  }

  return {
    fallas: [...unicas.values()].map((falla) => ({
      falla: falla.falla,
      nombre: falla.nombre,
      precioMinMXN: falla.precioMinMXN / 100,
      precioMaxMXN: falla.precioMaxMXN / 100,
    })),
    totalMinMXN: minCentavos / 100,
    totalMaxMXN: maxCentavos / 100,
    // minCentavos / usd da centavos de USD; se redondea una sola vez.
    totalMinUSD: Math.round(minCentavos / usd) / 100,
    totalMaxUSD: Math.round(maxCentavos / usd) / 100,
    tipoCambio: {
      usd_mxn: usd,
      fecha: String(tipoCambio?.fecha || ''),
      fuente: String(tipoCambio?.fuente || ''),
    },
    leyenda: LEYENDA,
  };
}

module.exports = { LEYENDA, calcularCotizacion, precioCatalogoEnMXN };
