// El motor de Prolog se consume a través del gateway same-origin de Express, no
// directo desde el navegador: así no depende de un host hardcodeado, no expone
// CORS ni HTTP mixto, y funciona igual en dev y en producción.
const PROLOG_URL = '/api/prolog/api/diagnostico';
const PROLOG_SINTOMAS_URL = '/api/prolog/api/sintomas';
const PROLOG_FALLAS_URL = '/api/prolog/api/fallas';
const API_DIAGNOSTICOS = '/api/diagnosticos';
const API_STATS_CERTEZA = '/api/stats/certeza';
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

// Agregados de certeza, ya calculados y agrupados por el backend. No se recalcula
// en el navegador: el promedio se hace sobre todos los documentos guardados, no
// sobre el tramo que quepa en la respuesta.
//
// El renombrado queda aislado del fetch porque es un contrato con el handler
// /api/stats/certeza de backend/server.js, y esa clase de acuerdo es la que
// fallo en guardarDiagnostico: un nombre mal ledo no lanza error, manda un
// undefined que JSON.stringify se come en silencio y el backend responde 400.
// Normalizar de mas tampoco vale: `?? 0` en vez de `?? null` convertiria una
// certeza sin medir en un 0% medido.
export function normalizarStatsCerteza(data) {
  return {
    totalConsultas: data.total_consultas ?? 0,
    totalFallas: data.total_fallas_inferidas ?? 0,
    // null cuando el backend no tiene nada que promediar (no hay fallas). El
    // `?? null` deja pasar un 0 explicito, que si es una certeza valida.
    certezaPromedio: data.certeza_promedio_global ?? null,
    porFalla: Array.isArray(data.por_falla) ? data.por_falla : [],
  };
}

export async function obtenerStatsCerteza(signal) {
  const res = await fetch(API_STATS_CERTEZA, { signal });
  if (!res.ok) throw new Error('No se pudieron consultar las estadísticas');
  return normalizarStatsCerteza(await res.json());
}

// El cuerpo de la peticion, aislado del fetch para poder probarlo. Los cinco
// campos son exactamente los que declara el schema de Diagnostico: `falla` y
// `certeza` son required, los otros tres tienen default ''. No se rellena un
// valor inventado para una certeza ausente (un 0 de relleno se presentaria como
// una medicion real y envenenaria los promedios de /api/stats/certeza): si el
// motor no la mando, que el schema lo rechaze con 400 y quede en el log.
export function cuerpoDiagnostico({ vehiculo, sintomas, fallas }) {
  return {
    vehiculo,
    sintomas,
    fallas: fallas.map((f) => ({
      falla: f.id,
      certeza: f.certeza,
      nombre: f.nombre,
      urgencia: f.urgencia,
      moneda: f.moneda,
    })),
  };
}

// Best-effort: el historial es informativo, un fallo al guardar no debe
// afectar el diagnóstico que el usuario ya está viendo. Resuelve con el
// documento guardado (que trae la tasa congelada de esta emisión) o con null
// si no se pudo persistir, para que la vista use la tasa vigente como respaldo.
//
// Este es el UNICO lugar que convierte la forma de vista de `falla` (id) a la
// forma de persistencia (`falla`). Quien llama pasa las fallas tal cual salen de
// mapearProlog(): si el llamador tambien las re-mapea, el `id` ya no existe en
// lo que llega aqui, JSON.stringify descarta la clave por ser undefined, y el
// backend responde 400 por `falla` required. Eso fue lo que hacia que ningun
// diagnostico emitido desde la UI llegara al historial.
export function guardarDiagnostico(diagnostico) {
  return fetch(API_DIAGNOSTICOS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoDiagnostico(diagnostico)),
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}
