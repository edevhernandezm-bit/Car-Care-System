import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Los catálogos son la única fuente de verdad pero no cambian durante la
      // sesión: se descargan una vez y no se reintentan ni refrescan solos, para
      // que el aviso de "motor no disponible" aparezca de inmediato en lugar de
      // dejar al usuario mirando un "conectando..." que no termina.
      staleTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
