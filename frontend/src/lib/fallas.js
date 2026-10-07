// Las reglas de captura de una falla viven aqui y no dentro del formulario: las
// necesita el alta, la necesita la edicion, y son puras, asi que se prueban sin
// montar React. El backend vuelve a validar lo mismo (server.js, validarFalla):
// estas reglas son para el error inmediato, no la frontera de confianza.

// El motor no admite tildes ni espacios en el functor, asi que el identificador
// sale del nombre normalizado. Se calcula solo para mostrarlo: el backend vuelve
// a derivarlo y es el que decide, porque es el que escribe el indice unico.
export function slugPrologId(nombre) {
  return String(nombre)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const TRANSMISIONES = [
  { valor: 'desconocida', etiqueta: 'No lo sé' },
  { valor: 'manual', etiqueta: 'Manual' },
  { valor: 'automatica', etiqueta: 'Automática' },
  { valor: 'cvt', etiqueta: 'CVT' },
  { valor: 'dct', etiqueta: 'DCT' },
];

export const URGENCIAS = [
  { valor: 'baja', etiqueta: 'Baja' },
  { valor: 'media', etiqueta: 'Media' },
  { valor: 'alta', etiqueta: 'Alta' },
  { valor: 'critica', etiqueta: 'Crítica' },
];

export const CONFIANZAS = [
  { valor: 'alta', etiqueta: 'Alta' },
  { valor: 'media', etiqueta: 'Media' },
  { valor: 'baja', etiqueta: 'Baja' },
  { valor: 'ninguna', etiqueta: 'Sin dato' },
];

// El maximo se calcula al cargar y no como literal: un 2025 fijo envejece y
// empieza a rechazar vehiculos nuevos sin avisar.
export const ANIO_MAXIMO = new Date().getFullYear();

export const FALLA_VACIA = {
  nombre: '',
  sintomas: [],
  // El año va como rango porque así lo declara la base de conocimiento de Prolog:
  // sus fallas por vehículo usan `Anio >= Min, Anio =< Max`. Si no se conoce el
  // rango, se escribe el mismo año en los dos extremos.
  vehiculo: { marca: '', modelo: '', anio: 0, anioDesde: 0, anioHasta: 0, transmision: 'desconocida' },
  causas: [],
  solucion: '',
  procedimiento: [],
  precioMin: '',
  precioMax: '',
  urgencia: 'media',
  confianzaDato: 'media',
  certezaBase: 0.7,
};

// Normaliza el estado del formulario a la forma que viaja por la red: las listas
// dynamicas llegan del formulario como lineas de texto y aqui salen como arrays
// sin entradas vacias, que es lo que el schema y Prolog esperan.
export function fallaAPayload(falla) {
  const limpiarLista = (lista) => (lista || []).map((s) => String(s).trim()).filter(Boolean);
  const v = falla.vehiculo || {};
  const anioDesde = Number(v.anioDesde ?? v.anio ?? 0);
  const anioHasta = Number(v.anioHasta ?? anioDesde);
  return {
    nombre: String(falla.nombre || '').trim(),
    sintomas: limpiarLista(falla.sintomas),
    vehiculo: {
      marca: String(v.marca || '').trim(),
      modelo: String(v.modelo || '').trim(),
      // `anio` se sigue enviando por compatibilidad con lo ya guardado y con el
      // historial; el rango es lo que usa el motor.
      anio: anioDesde,
      // Los extremos viajan TAL COMO se escribieron, sin ordenar: si el payload
      // los normalizara aqui, `validarFalla` nunca veria el rango invertido y el
      // usuario no sabria que lo escribio al reves. Ordenarlos es tarea de la
      // persistencia (`normalizarVehiculo` en server.js).
      anioDesde,
      anioHasta,
      transmision: v.transmision || 'desconocida',
    },
    causas: limpiarLista(falla.causas),
    solucion: String(falla.solucion || '').trim(),
    procedimiento: limpiarLista(falla.procedimiento),
    precioMin: Number(falla.precioMin),
    precioMax: Number(falla.precioMax),
    urgencia: falla.urgencia || 'media',
    confianzaDato: falla.confianzaDato || 'media',
    certezaBase: Number(falla.certezaBase ?? 0.7),
  };
}

// Devuelve { campo: mensaje }. El mapa por campo permite marcar el control
// concreto con aria-invalid y enlazar el texto con aria-describedby, en vez de
// pintar un unico error arriba que no dice qué escribir.
export function validarFalla(falla) {
  const errores = {};
  const p = fallaAPayload(falla);

  if (!p.nombre) {
    errores.nombre = 'Escribe el nombre de la falla.';
  } else if (!slugPrologId(p.nombre)) {
    // Sin letras ni numeros el identificador queda vacio y el motor no tiene
    // forma de nombrar la falla.
    errores.nombre = 'El nombre necesita al menos una letra o un número.';
  }

  if (p.sintomas.length === 0) {
    errores.sintomas = 'Elige al menos un síntoma, o escribe uno nuevo.';
  }

  if (!Number.isFinite(p.precioMin) || String(falla.precioMin).trim() === '') {
    errores.precioMin = 'Escribe el precio mínimo.';
  } else if (p.precioMin < 0) {
    errores.precioMin = 'El precio no puede ser negativo.';
  }

  if (!Number.isFinite(p.precioMax) || String(falla.precioMax).trim() === '') {
    errores.precioMax = 'Escribe el precio máximo.';
  } else if (p.precioMax < 0) {
    errores.precioMax = 'El precio no puede ser negativo.';
  }

  // El rango se comprueba solo si ambos extremos ya son validos: si el minimo
  // esta vacio, decir "el minimo supera al maximo" seria otro error del mismo
  // campo y desorientaria.
  if (
    !errores.precioMin &&
    !errores.precioMax &&
    p.precioMin > p.precioMax
  ) {
    errores.precioMax = 'El máximo no puede ser menor que el mínimo.';
  }

  // Marca y modelo acotan la falla a un vehículo: sin ellos la falla se
  // afirmaría aplicable a cualquiera y saldría en diagnósticos de otros coches.
  if (!p.vehiculo.marca) {
    errores.marca = 'Indica la marca del vehículo.';
  }
  if (!p.vehiculo.modelo) {
    errores.modelo = 'Indica el modelo del vehículo.';
  }

  for (const campo of ['anioDesde', 'anioHasta']) {
    const valor = p.vehiculo[campo];
    if (!Number.isInteger(valor) || valor < 0 || valor > ANIO_MAXIMO) {
      errores[campo] = `El año debe estar entre 0 y ${ANIO_MAXIMO} (0 = no lo sé).`;
    }
  }
  // El orden se comprueba solo si ambos extremos ya son válidos: si uno está
  // vacío, decir "el desde supera al hasta" sería otro error del mismo campo.
  if (!errores.anioDesde && !errores.anioHasta && p.vehiculo.anioDesde > p.vehiculo.anioHasta) {
    errores.anioHasta = 'El año hasta no puede ser menor que el año desde.';
  }

  if (p.causas.length === 0) {
    errores.causas = 'Escribe al menos una causa: el diagnóstico la necesita.';
  }

  if (p.procedimiento.length === 0) {
    errores.procedimiento = 'Escribe al menos un paso del procedimiento.';
  }

  return errores;
}

// Un documento guardado en MongoDB tiene los campos que el backend anade
// (prologId, activo, creadoPor, _id) y no los del formulario. Este helper solo
// conserva lo que el formulario edita: si se copiara el documento entero, un
// campo de solo lectura volveria en el PUT y el backend tendria que filtrarlo.
export function fallaAFormulario(doc) {
  return {
    ...FALLA_VACIA,
    nombre: doc.nombre || '',
    sintomas: [...(doc.sintomas || [])],
    vehiculo: {
      marca: doc.vehiculo?.marca || '',
      modelo: doc.vehiculo?.modelo || '',
      anio: doc.vehiculo?.anio ?? 0,
      // Las filas anteriores al rango solo tienen `anio`: se abre con ese año
      // en los dos extremos, que es la lectura exacta que ya tenian guardada.
      anioDesde: doc.vehiculo?.anioDesde ?? doc.vehiculo?.anio ?? 0,
      anioHasta: doc.vehiculo?.anioHasta ?? doc.vehiculo?.anio ?? 0,
      transmision: doc.vehiculo?.transmision || 'desconocida',
    },
    causas: [...(doc.causas || [])],
    solucion: doc.solucion || '',
    procedimiento: [...(doc.procedimiento || [])],
    precioMin: doc.precioMin ?? '',
    precioMax: doc.precioMax ?? '',
    urgencia: doc.urgencia || 'media',
    confianzaDato: doc.confianzaDato || 'media',
    certezaBase: doc.certezaBase ?? 0.7,
  };
}