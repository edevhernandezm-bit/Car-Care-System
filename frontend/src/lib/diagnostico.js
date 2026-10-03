export function etiquetaUrgencia(u) {
  switch (u) {
    case 'critica': return 'Crítica';
    case 'alta': return 'Alta';
    case 'media': return 'Media';
    case 'baja': return 'Baja';
    default: return 'Desconocida';
  }
}

export function urgenciaClase(u) {
  return u === 'Crítica' || u === 'Alta' ? 'high' : u === 'Media' ? 'medium' : 'low';
}

// Cortes de certeza diagnostica. Son espejo de etiqueta_certeza/2 en
// motor_inferencia.pl:954-956, que el motor ya aplica para su salida de consola
// pero no exporta al JSON. Si se mueven alla, hay que moverlos aqui.
export const CORTE_CERTEZA_ALTA = 0.85;
export const CORTE_CERTEZA_MEDIA = 0.6;

// El motor entrega certeza como factor de MYCIN en 0..1. Un valor ausente o no
// numerico no es cero: es informacion que no llego, y se distingue de una
// certeza baja real para no presentar falta de dato como descarte.
// El null y la cadena vacia se filtran a mano porque Number(null) y Number('')
// dan 0 en JavaScript, y sin esta comprobacion un campo vacio se presentaria
// como "Baja 0%", que es una afirmacion que el motor nunca hizo.
export function certezaNivel(c) {
  if (c === null || c === undefined || c === '') return 'desconocida';
  const v = Number(c);
  if (!Number.isFinite(v)) return 'desconocida';
  if (v >= CORTE_CERTEZA_ALTA) return 'alta';
  if (v >= CORTE_CERTEZA_MEDIA) return 'media';
  return 'baja';
}

export function etiquetaCerteza(c) {
  const nivel = certezaNivel(c);
  if (nivel === 'desconocida') return 'No disponible';
  if (nivel === 'alta') return 'Alta';
  if (nivel === 'media') return 'Media';
  return 'Baja';
}

export function certezaPorcentaje(c) {
  if (certezaNivel(c) === 'desconocida') return null;
  return Math.round(Math.min(Math.max(Number(c), 0), 1) * 100);
}

// La confianza del dato NO es la certeza del diagnostico. Prolog lo separa a
// proposito (motor_inferencia.pl:628-629): la certeza sale de los sintomas que
// confirmo el usuario, y esta confianza dice cuanto pesa la investigacion que
// respalda esa falla. Solo la registran 34 de las 54 fallas del catalogo; el
// resto devuelve no_registrada o el texto de relleno del motor.
export const SIN_FUENTE = 'Base original del sistema (sin fuente registrada)';

export function procedenciaFalla(f) {
  const conf = (f.confianza_dato || '').toString().trim();
  const fuente = (f.fuente || '').toString().trim();
  const hayFuente = fuente.length > 0 && fuente !== SIN_FUENTE;
  return {
    fuente: hayFuente ? fuente : '',
    confianza: conf && conf !== 'no_registrada' ? conf : '',
    hayFuente,
  };
}

export function etiquetaConfianzaDato(c) {
  switch (c) {
    case 'alta': return 'Investigación verificada';
    case 'alta_costo_estimado': return 'Falla verificada, costo estimado';
    case 'media': return 'Investigación parcial';
    case 'baja': return 'Investigación limitada';
    default: return 'Procedencia no registrada';
  }
}

export function claseConfianzaDato(c) {
  if (c === 'alta' || c === 'alta_costo_estimado') return 'confianza-alta';
  if (c === 'media') return 'confianza-media';
  if (c === 'baja') return 'confianza-baja';
  return 'confianza-none';
}

// El motor nunca descarta una falla por no saber la transmisión (la trata como
// permisiva), así que la vista no debe insinuar que el diagnóstico se recortó.
export function etiquetaTransmision(t) {
  return !t || t === 'desconocida' ? 'transmisión desconocida' : `transmisión ${t}`;
}

export function etiquetaAnio(a) {
  return Number(a) > 0 ? String(a) : 'año desconocido';
}

export function mapearProlog(f, catalogoFallas) {
  const base = catalogoFallas.find((x) => x.id === f.id);
  return {
    id: f.id,
    nombre: base ? base.nombre : f.id.replace(/_/g, ' '),
    urgencia: etiquetaUrgencia(f.urgencia || base?.urgencia),
    // La moneda determina si el costo se convierte o ya está en MXN. Sin
    // propagarla, el historial guardaría '' y el equivalente en pesos nunca
    // podría calcularse.
    moneda: f.moneda || base?.moneda || '',
    costo_min: f.costo_min,
    costo_max: f.costo_max,
    reparaciones: f.reparaciones || [],
    certeza: f.certeza,
    fuente: f.fuente || '',
    confianza_dato: f.confianza_dato || '',
    sintomas_relacionados: Array.isArray(f.sintomas_relacionados)
      ? f.sintomas_relacionados
      : [],
  };
}

// La conversión de moneda es solo de presentación: el motor de inferencia y el
// historial guardan siempre el costo en su moneda original, junto a la tasa que
// se usó. Devuelve null cuando no hay nada que convertir (ya está en MXN, o la
// tasa no es utilizable), para que la vista decida qué mostrar.
export function convertirCosto({ costo_min, costo_max, moneda }, tasa) {
  if (moneda !== 'usd') return null;
  const valor = Number(tasa?.usd_mxn);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return { min: costo_min * valor, max: costo_max * valor, moneda: 'mxn' };
}

// Una tasa de respaldo o muy vieja no debe presentarse como conversión vigente:
// el costo equivalente se marca como estimado en lugar de mostrarse como actual.
export function tasaEsEstimada(tasa, diasMax = 7) {
  if (!tasa) return true;
  if (tasa.es_estimado || (tasa.fuente && tasa.fuente !== 'frankfurter')) return true;
  const referencia = Date.parse(`${tasa.fecha}T00:00:00Z`);
  if (Number.isNaN(referencia)) return true;
  const dias = (Date.now() - referencia) / 86400000;
  return dias > diasMax;
}
