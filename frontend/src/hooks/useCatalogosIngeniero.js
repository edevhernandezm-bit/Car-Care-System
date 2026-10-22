import { useQuery } from '@tanstack/react-query';

import { cargarCatalogosIngeniero } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const CATALOGOS_VACIOS = { sintomas: [], fallas: [] };

// react-query owns the request lifecycle: it deduplicates concurrent callers
// (React StrictMode mounts effects twice in development), caches the result,
// and aborts the in-flight fetch when the last consumer unmounts, so the
// download never outlives the component that asked for it.
//
// `enabled: Boolean(user)` retrasa la descarga hasta que hay sesion. Los
// catalogos exigen sesion (requireAuth en el gateway), asi que dispararla en el
// primer render —antes de que AuthProvider valide /api/auth/me— la mandaba sin
// cookie, recibia 401, y con retry:false quedaba en error: el banner pintaba
// "Motor de Prolog no disponible" hasta que otra seccion montaba un consumidor
// y forzaba el refetch. Sin usuario la consulta queda en pending, no en error.
export function useCatalogosIngeniero() {
  const { user } = useAuth();
  const { data, status } = useQuery({
    queryKey: ['catalogos', 'ingeniero'],
    queryFn: ({ signal }) => cargarCatalogosIngeniero(signal),
    enabled: Boolean(user),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return { catalogos: data ?? CATALOGOS_VACIOS, status };
}
