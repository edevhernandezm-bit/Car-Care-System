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

// La búsqueda tiene que funcionar con y sin tildes: el taller escribe rápido y
// "perdida" tiene que encontrar "Pérdida de potencia", no devolver una lista
// vacía. normalize('NFD') separa la tilde de la vocal, y al quitar las marcas
// combinantes (\p{M}, la categoría Unicode Mark) queda la vocal desnuda. Se usa
// \p{M} y no un rango literal de diacríticos para que cubra también Ñ y Ü y lo
// que se añada al catálogo después, sin editar la función.
//
// La eñe es el único caso que NFD no resuelve: U+00F1 no tiene descomposición
// canónica, así que "danada" y "dañada" siguen siendo cadenas distintas
// ("Junta homocinética dañada") y hay que igualarlas a mano.
function normalizar(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ñ/g, 'n');
}

// Todos los tokens tienen que aparecer, no solo uno: "pastillas freno" tiene que
// encontrar "Pastillas de freno" sin depender del orden ni de las palabras de en
// medio. Una consulta vacía devuelve true para no dejar la lista en blanco
// mientras el usuario ni ha escrito nada.
export function coincide(haystack, consulta) {
  // Una consulta ausente o nula no es un filtro, es "no se está buscando".
  // Sin esto, normalizar() hace String(null) → "null", el token no queda vacío
  // y la función comparaba el texto contra la palabra "null": cero coincidencias
  // en vez de todas las filas. El mismo razonamiento que tokens.length === 0.
  if (consulta === null || consulta === undefined) return true;
  const tokens = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const h = normalizar(haystack);
  return tokens.every((t) => h.includes(t));
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

// Unico lugar donde el nombre de un corte se decide. etiquetaCerteza lo usa
// para una lectura suelta y distribuirPorCerteza para un bucket, asi que los
// dos caminos pintan exactamente la misma palabra.
export function etiquetaNivel(nivel) {
  if (nivel === 'desconocida') return 'Sin dato';
  if (nivel === 'alta') return 'Alta';
  if (nivel === 'media') return 'Media';
  return 'Baja';
}

export function etiquetaCerteza(c) {
  return etiquetaNivel(certezaNivel(c));
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

// La etiqueta que cae en `default` no es "no hay dato": el motor ya responde
// `no_registrada` por defecto (motor_inferencia.pl:1357) y `procedenciaFalla` lo
// convierte en ''. Las 20 fallas de la base original sí tienen procedencia
// conocida —foros de mecánica, manuales de referencia y códigos OBD-II, no una
// investigación formal— así que se nombra esa situación en vez de dejar la
// tarjeta sin nada que decir. El chip va corto porque no cabe ni en la columna
// de la leyenda ni en una tarjeta de la rejilla; de dónde viene exactamente lo
// cuenta el `detalle` de la leyenda y la nota del desplegable.
export function etiquetaConfianzaDato(c) {
  switch (c) {
    case 'alta': return 'Investigación verificada';
    case 'alta_costo_estimado': return 'Falla verificada, costo estimado';
    case 'media': return 'Investigación parcial';
    case 'baja': return 'Investigación limitada';
    default: return 'Conocimiento de foros de mecánica';
  }
}

// La simbologia que explica la section de Fallas Comunes. Vive en lib y no en
// el componente para que quede bajo node --test, igual que el resto de las
// funciones puras de la vista.
//
// Solo aparecen los tres niveles que el motor declara hoy: `baja` no se lista
// porque no hay ninguna falla con ese valor en el catalogo, y prometerlo en una
// leyenda seria una etiqueta que nadie va a ver. Si se agrega una falla `baja`
// al motor, esta lista es la que hay que actualizar.
export const LEYENDA_CONFIANZA = [
  {
    confianza: 'alta',
    etiqueta: 'Investigación verificada',
    detalle: 'La falla está respaldada por boletines, reportes de propietarios o datos del fabricante.',
  },
  {
    confianza: 'alta_costo_estimado',
    etiqueta: 'Falla verificada, costo estimado',
    detalle: 'La falla está confirmada, pero el costo es un estimado de mercado, no una cifra oficial.',
  },
  {
    confianza: 'media',
    etiqueta: 'Investigación parcial',
    detalle: 'La falla es plausible y hay indicios, pero no está confirmada de forma directa.',
  },
  {
    confianza: '',
    etiqueta: 'Conocimiento de foros de mecánica',
    detalle:
      'Proviene de la base original del sistema: información obtenida de foros de mecánica como iFixit, y de referencias técnicas como los manuales Chilton y Haynes o los códigos de diagnóstico OBD-II. La falla es válida, pero no está respaldada por una investigación formal.',
  },
];

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

// Como se muestra una falla cuando el catalogo la conoce y cuando no. Vive aqui
// porque hay dos consumers (mapearProlog y unirPorFalla) y ya divergieron una vez:
// uno des-eslugificaba el id y el otro lo devolvia crudo, asi que en las graficas
// unas fallas aparecian como "Sistema de frenos con aire" y otras como
// "sistema_frenos_con_aire". Un solo lugar, las dos quedan iguales.
//
// Cuando el catalogo no conoce la falla, los guiones bajos se cambian por
// espacios: no es inventar un nombre, es leer el id. `unirPorFalla` conserva el
// id aparte y marca `enCatalogo: false` para que la vista diga que esa fila no
// tiene nombre propio.
export function nombreDeFalla(id, base) {
  return base ? base.nombre : String(id).replace(/_/g, ' ');
}

export function mapearProlog(f, catalogoFallas) {
  const base = catalogoFallas.find((x) => x.id === f.id);
  return {
    id: f.id,
    nombre: nombreDeFalla(f.id, base),
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
