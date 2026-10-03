// El motor de Prolog se consume a través del gateway same-origin de Express, no
// directo desde el navegador: así no depende de un host hardcodeado, no expone
// CORS ni HTTP mixto, y funciona igual en dev y en producción.
const PROLOG_URL = '/api/prolog/api/diagnostico';
const PROLOG_SINTOMAS_URL = '/api/prolog/api/sintomas';
const PROLOG_FALLAS_URL = '/api/prolog/api/fallas';
const API_DIAGNOSTICOS = '/api/diagnosticos';
const API_TIPO_CAMBIO = '/api/config/tipo-cambio';

// El motor de Prolog es la única fuente de verdad: los catálogos de síntomas y
// fallas se leen de sus endpoints, nunca desde una copia local en el navegador.
// `signal` es el AbortSignal que react-query aborta al desmontar el consumidor.
export async function cargarCatalogosIngeniero(signal) {
  const [sRes, fRes] = await Promise.all([
    fetch(PROLOG_SINTOMAS_URL, { signal }),
    fetch(PROLOG_FALLAS_URL, { signal }),
  ]);
  if (!sRes.ok || !fRes.ok) throw new Error('El motor no responde');

  const [sData, fData] = await Promise.all([sRes.json(), fRes.json()]);
  return { sintomas: sData.sintomas || [], fallas: fData.fallas || [] };
}

export async function diagnosticar(vehiculo, sintomas) {
  const res = await fetch(PROLOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...vehiculo, sintomas }),
  });
  if (!res.ok) throw new Error('Servidor apagado');
  const data = await res.json();
  return data.fallas || [];
}

// Tasa vigente USD -> MXN. Se usa solo donde no hay un diagnóstico asociado
// (el catálogo de fallas); un diagnóstico ya emitido trae su tasa congelada.
export async function obtenerTipoCambio() {
  const res = await fetch(API_TIPO_CAMBIO);
  if (!res.ok) throw new Error('No se pudo consultar el tipo de cambio');
  return res.json();
}

// Best-effort: el historial es informativo, un fallo al guardar no debe
// afectar el diagnóstico que el usuario ya está viendo. Resuelve con el
// documento guardado (que trae la tasa congelada de esta emisión) o con null
// si no se pudo persistir, para que la vista use la tasa vigente como respaldo.
export function guardarDiagnostico({ vehiculo, sintomas, fallas }) {
  return fetch(API_DIAGNOSTICOS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo,
      sintomas,
      fallas: fallas.map((f) => ({
        falla: f.id,
        certeza: f.certeza ?? 0,
        nombre: f.nombre ?? '',
        urgencia: f.urgencia ?? '',
        moneda: f.moneda ?? '',
      })),
    }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}
