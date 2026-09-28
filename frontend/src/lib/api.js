const PROLOG_URL = 'http://localhost:8000/api/diagnostico';
const PROLOG_SINTOMAS_URL = 'http://localhost:8000/api/sintomas';
const PROLOG_FALLAS_URL = 'http://localhost:8000/api/fallas';
const API_DIAGNOSTICOS = '/api/diagnosticos';

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

// Best-effort: el historial es informativo, un fallo al guardar no debe
// afectar el diagnóstico que el usuario ya está viendo.
export function guardarDiagnostico(vehiculo, sintomas, fallas) {
  return fetch(API_DIAGNOSTICOS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehiculo,
      sintomas,
      fallas: fallas.map((f) => ({ falla: f.id, certeza: f.certeza ?? 0 })),
    }),
  }).catch(() => {});
}
