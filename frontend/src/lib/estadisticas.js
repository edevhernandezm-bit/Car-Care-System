// Derivaciones puras de las estadísticas. Todo lo de este archivo es
// determinista y sin React a propósito: las funciones se prueban con
// node --test (ver estadisticas.test.js) sin montar nada.
//
// La fuente son los dos endpoints que ya existen y que no se tocan:
//   GET /api/stats/certeza  -> { total_consultas, total_fallas_inferidas,
//                               certeza_promedio_global, por_falla: [...] }
//   GET /api/diagnosticos   -> últimos 100 documentos, del más nuevo al viejo
//
// por_falla trae el id de la falla, no su nombre. Se une contra el catálogo de
// Prolog con la misma lógica que mapearProlog() en diagnostico.js —compartiendo
// su helper nombreDeFalla(), no dos copias—: el catálogo manda, y si no conoce
// la falla se lee el id con los guiones bajos cambiados por espacios en vez de
// inventar un nombre.

import { certezaNivel, coincide, etiquetaNivel, etiquetaUrgencia, nombreDeFalla, urgenciaClase } from './diagnostico.js';

// Sin número no hay promedio que dibujar. El backend agrupa por falla, así que
// un bucket vacío es un dato roto, no un cero real: se marca desconocido para
// que la UI pueda decirlo en vez de pintar "0%" como si fuera una medición.
const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);

// Une por_falla con el catálogo y normaliza los campos que la UI necesita.
// `fallasCatalogo` es catalogos.fallas de useCatalogosIngeniero(). Fallas de más
// a menos veces, como ya las ordena el endpoint; los empates conservan ese orden
// de entrada en vez de reordenarse.
export function unirPorFalla(porFalla, fallasCatalogo = []) {
  if (!Array.isArray(porFalla)) return [];

  return porFalla
    .filter((fila) => fila && typeof fila.falla === 'string')
    .map((fila) => {
      // find y no un Map: el catálogo tiene 54 fallas y se recorre entero por
      // cada fila, pero se evalúa una sola vez al montar, no en cada render.
      const enCatalogo = fallasCatalogo.find((f) => f.id === fila.falla);

      // El catálogo guarda la urgencia como slug ('alta') y urgencyClase()
      // espera la etiqueta ('Alta'): pasarle el slug directo hacía que las 54
      // faltas fueran 'low'. Se compone una vez y se reutiliza, igual que
      // mapearProlog() hace con etiquetaUrgencia().
      const urgencia = enCatalogo ? etiquetaUrgencia(enCatalogo.urgencia) : null;

      return {
        id: fila.falla,
        // Si el catálogo no la conoce, el id es lo único cierto que hay: se
        // des-eslugifica para que se lea, pero no se le inventa un nombre. El
        // helper es el mismo que usa mapearProlog(); antes cada uno hacía su cosa
        // y por eso estas filas salían con guiones bajos y las del catálogo no.
        nombre: nombreDeFalla(fila.falla, enCatalogo),
        enCatalogo: Boolean(enCatalogo),
        urgencia,
        clase: enCatalogo ? urgenciaClase(urgencia) : 'sin-urgencia',
        veces: esNumero(fila.veces) ? fila.veces : 0,
        certeza_promedio: esNumero(fila.certeza_promedio) ? fila.certeza_promedio : null,
      };
    });
}

// Cuenta cuántas fallas caen en cada corte de certeza, usando los mismos cortes
// que el motor (certezaNivel). Devuelve los tres cortes siempre, incluso con
// cero, para que el chart tenga un eje estable en vez de encogerse con los
// datos.
export function distribuirPorCerteza(filas) {
  const conteo = { alta: 0, media: 0, baja: 0, desconocida: 0 };

  for (const fila of filas) {
    if (!esNumero(fila.certeza_promedio)) {
      conteo.desconocida++;
      continue;
    }
    conteo[certezaNivel(fila.certeza_promedio)]++;
  }

  return ['alta', 'media', 'baja', 'desconocida'].map((nivel) => ({
    nivel,
    fallas: conteo[nivel],
    etiqueta: etiquetaNivel(nivel),
  }));
}

// El chart de barras horizontales se vuelve ilegible con 54 filas: cada una
// queda con unos 12px de alto y el nombre ya no cabe. Se recorta al top y se
// declara el total para que el recorte sea visible y no parezca que son todas.
export function topFallas(filas, maximo = 12) {
  const recortadas = filas.slice(0, maximo);
  return {
    filas: recortadas,
    total: filas.length,
    recortadas: filas.length > recortadas.length,
  };
}

// Filtra las filas por la búsqueda global, igual que hace BaseConocimiento con
// el catálogo: coincide() sobre el nombre y la urgencia, con o sin tildes y con
// varias palabras a la vez. Una consulta vacía deja las filas como están.
//
// La urgencia entra como etiqueta ("Crítica") y no como slug ("critica"), que es
// como viene del catálogo: escribir "critica" tiene que encontrar las fallas
// críticas, y el slug con tilde no aparecería en una búsqueda sin tildes.
export function filtrarPorBusqueda(filas, consulta) {
  if (!Array.isArray(filas)) return [];
  return filas.filter((fila) =>
    coincide(`${fila.nombre} ${fila.urgencia ?? ''}`, consulta)
  );
}
