// Motor de inferencia en JS — réplica fiel del motor de reglas Prolog
// (proyecto2.pl). Se usa como respaldo local cuando el servidor SWI-Prolog no
// está disponible, produciendo exactamente las mismas fallas y certezas.
// Corresponde a los predicados falla/2, agrupar_max_certeza/2 y ordenar/3 del
// motor Prolog, replicados con la misma semántica (máxima certeza por falla,
// sin redundancias, orden de mayor a menor.

import { modelosManuales, reglasInferencia } from '../data/baseConocimiento.js';

// Réplica de embrague_aplica/4 del Prolog: el embrague solo es aplicable a
// vehículos manuales (marca + modelo dentro de un rango de años) según la
// restricción de transmisión. Todo lo demás aplica a cualquier vehículo.
export function aplica_a(fallaId, marca, modelo, anio) {
  if (fallaId !== 'embrague_desgastado') return true;
  if (marca === 'gen' && modelo === 'gen') return true;
  const modelosDeMarca = modelosManuales[marca];
  const rango = modelosDeMarca ? modelosDeMarca[modelo] : undefined;
  if (!rango) return false;
  return anio === 0 || (anio >= rango[0] && anio <= rango[1]);
}

// Equivalente JS de inyectar_conocimiento/1 (Prolog): marca como "NO" todos los
// síntomas disponibles de la base y como "SÍ" los sintomas confirmados.
export function inyectar_sintomas(confirmados, disponibles) {
  return {
    no_confirmados: disponibles.filter((s) => !confirmados.includes(s)),
    confirmados,
  };
}

// Réplica de inferencia_diagnostico/4 + agrupar_max_certeza/3 del Prolog:
// evalúa las reglas de inferencia contra los síntomas confirmados y devuelve
// una lista de pares "Certeza-Falla" ordenada de mayor a menor, quedándose con
// la certeza máxima por falla (sin duplicados).
export function inferir_fallas(confirmados, marca, modelo, anio) {
  const mejores = {};

  for (const regla of reglasInferencia) {
    // Condición si_antecedente: todos los síntomas requeridos + ninguno excluido
    const todosRequeridos = regla.req.every((s) => confirmados.includes(s));
    if (!todosRequeridos) continue;

    const algunExcluido = regla.excluir && regla.excluir.some((s) => confirmados.includes(s));
    if (algunExcluido) continue;

    // Restricción de transmisión manual
    if (!aplica_a(regla.falla, marca, modelo, anio)) continue;

    // Conservar la mayor certeza por falla
    const actual = mejores[regla.falla] || 0;
    if (regla.certeza > actual) mejores[regla.falla] = regla.certeza;
  }

  return Object.entries(mejores)
    .map(([falla, certeza]) => `${certeza}-${falla}`)
    .sort((a, b) => {
      const certA = parseFloat(a.split('-')[0]);
      const certB = parseFloat(b.split('-')[0]);
      return certB - certA;
    });
}
