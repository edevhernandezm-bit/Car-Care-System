import { useQuery } from '@tanstack/react-query';

import { cargarCatalogosIngeniero } from '../lib/api.js';

const CATALOGOS_VACIOS = { sintomas: [], fallas: [] };

// react-query owns the request lifecycle: it deduplicates concurrent callers
// (React StrictMode mounts effects twice in development), caches the result,
// and aborts the in-flight fetch when the last consumer unmounts, so the
// download never outlives the component that asked for it.
export function useCatalogosIngeniero() {
  const { data, status } = useQuery({
    queryKey: ['catalogos', 'ingeniero'],
    queryFn: ({ signal }) => cargarCatalogosIngeniero(signal),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { catalogos: data ?? CATALOGOS_VACIOS, status };
}
