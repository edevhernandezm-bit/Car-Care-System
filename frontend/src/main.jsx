import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { AuthProvider } from './context/AuthContext.jsx';
import CotizacionPublica from './components/CotizacionPublica.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Los catálogos son la única fuente de verdad pero no cambian durante la
      // sesión: se descargan una vez y no se reintentan ni refrescan solos, para
      // que un fallo real del motor (no un 401 por falta de sesión: la consulta
      // espera a tenerla, ver useCatalogosIngeniero) se vea de inmediato en vez
      // de dejar al usuario mirando un "conectando..." que no termina.
      staleTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {window.location.pathname === '/cotizacion' ? (
      <CotizacionPublica hashInicial={window.location.hash} />
    ) : (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    )}
  </React.StrictMode>
);
