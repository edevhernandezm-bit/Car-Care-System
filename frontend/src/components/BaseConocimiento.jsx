import { useQuery } from '@tanstack/react-query';
import { obtenerTipoCambio } from '../lib/api.js';
import EstadoVacio from './EstadoVacio.jsx';
import {
  claseConfianzaDato,
  convertirCosto,
  etiquetaConfianzaDato,
  etiquetaUrgencia,
  procedenciaFalla,
  tasaEsEstimada,
  urgenciaClase,
} from '../lib/diagnostico.js';

export default function BaseConocimiento({ fallasCatalogo, searchQuery, onLimpiarBusqueda }) {
  const { data: tasaVigente } = useQuery({
    queryKey: ['tipoCambio'],
    queryFn: obtenerTipoCambio,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
  const filtradas = fallasCatalogo.filter((f) =>
    `${f.nombre} ${etiquetaUrgencia(f.urgencia)}`.toLowerCase().includes(searchQuery)
  );

  if (filtradas.length === 0) {
    return (
      <EstadoVacio
        titulo={
          searchQuery
            ? `Ninguna falla coincide con "${searchQuery}"`
            : 'La base de conocimiento está vacía'
        }
        causa={
          searchQuery
            ? 'La búsqueda solo revisa el nombre de la falla y su urgencia. Prueba con una sola palabra, como "cvt" o "alternador".'
            : 'No hay fallas registradas. Levanta el servidor de Prolog para cargar el catálogo.'
        }
        accion={
          searchQuery
            ? { etiqueta: 'Limpiar búsqueda', manejar: onLimpiarBusqueda }
            : undefined
        }
      />
    );
  }

  return (
    <div className="knowledge-grid">
      {filtradas.map((f) => {
        const urgencia = etiquetaUrgencia(f.urgencia);
        const proc = procedenciaFalla(f);
        return (
          <article className="info-card common-falla-card" key={f.id}>
            <div className="card-header">
              <div>
                <p className="card-category">Falla</p>
                <h3>{f.nombre}</h3>
              </div>
              <span className={`badge ${urgenciaClase(urgencia)}`}>{urgencia}</span>
            </div>
            <div className="card-body">
              <div className="card-section">
                <h4>Causas/Pasos</h4>
                <ul>
                  {(f.reparaciones || ['Sin datos']).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              {/* Procedencia del dato. Es un eje distinto de la certeza del
                  diagnostico: en el catalogo no hay sintomas que el usuario haya
                  confirmado, asi que se declara el peso de la investigacion. */}
              {proc.confianza && (
                <details className="why why--source">
                  <summary className="why-summary">
                    Procedencia del dato
                    <span className={`confianza-chip ${claseConfianzaDato(proc.confianza)}`}>
                      {etiquetaConfianzaDato(proc.confianza)}
                    </span>
                  </summary>
                  <div className="why-body">
                    {proc.hayFuente ? (
                      <p className="why-note">{proc.fuente}</p>
                    ) : (
                      <p className="why-note">
                        Esta falla viene de la base original del sistema y no tiene fuente
                        registrada.
                      </p>
                    )}
                  </div>
                </details>
              )}
              <div className="card-footer">
                <span>Costo</span>
                <strong>
                  {(() => {
                    const eq = convertirCosto(
                      { costo_min: f.costo_min, costo_max: f.costo_max, moneda: f.moneda },
                      tasaVigente
                    );
                    const esEstimado = tasaEsEstimada(tasaVigente);
                    if (eq) {
                      return (
                        <>
                          ${Math.round(eq.min).toLocaleString('es-MX')} - ${Math.round(eq.max).toLocaleString('es-MX')} MXN
                          <span className="field-hint">
                            ({f.costo_min} - {f.costo_max} {f.moneda?.toUpperCase?.()})
                            {tasaVigente?.fecha ? ` · TC ${tasaVigente.usd_mxn} (${tasaVigente.fecha})` : ''}
                            {esEstimado ? ' · estimado' : ''}
                          </span>
                        </>
                      );
                    }
                    return (
                      <>
                        ${f.costo_min} - ${f.costo_max} {f.moneda && f.moneda.toUpperCase() !== 'MXN' ? f.moneda.toUpperCase() : 'MXN'}
                      </>
                    );
                  })()}
                </strong>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
