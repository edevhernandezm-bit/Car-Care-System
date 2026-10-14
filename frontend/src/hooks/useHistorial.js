import { useQuery } from '@tanstack/react-query';

import { obtenerHistorial } from '../lib/api.js';

// Mismo ciclo de vida que useEstadisticasCerteza: react-query deduplica, cachea
// y aborta el fetch al desmontar. staleTime corto porque el historial cambia
// cada vez que se guarda un diagnostico: volver a la seccion debe mostrar el
// ultimo guardado, no una copia congelada.
export function useHistorial() {
  const { data, status, error } = useQuery({
    queryKey: ['diagnosticos', 'historial'],
    queryFn: ({ signal }) => obtenerHistorial(signal),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { historial: data ?? [], status, error };
}
