import { useQuery } from '@tanstack/react-query';

import { obtenerStatsCerteza } from '../lib/api.js';

// react-query owns the request lifecycle, igual que useCatalogosIngeniero:
// deduplica los montaje dobles de StrictMode, cachea el resultado y aborta el
// fetch si el componente se desmonta antes de que responda.
//
// staleTime corto a proposito, y es lo unico que diferencia esta consulta de la
// de catalogos: los agregados cambian cada vez que se guarda un diagnostico, y
// con staleTime: Infinity el taller veria el conteo congelado para siempre.
// Quince segundos es suficiente para no martillar la base sin que el dato se
// sienta viejo al entrar a la seccion.
export function useEstadisticasCerteza() {
  const { data, status, error } = useQuery({
    queryKey: ['stats', 'certeza'],
    queryFn: ({ signal }) => obtenerStatsCerteza(signal),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { stats: data ?? null, status, error };
}