import { urgenciaClase } from '../lib/diagnostico.js';

export default function Resultados({ resultados, onVolver, onCambiarVehiculo }) {
  if (!resultados) return null;

  const { error, cargando, fallas = [], vehiculo, sintomas } = resultados;

  return (
    <div className="diagnostico-container">
      <div className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">
              {vehiculo.marca.toUpperCase()} {vehiculo.modelo.toUpperCase()} ({vehiculo.anio})
              {' · '}
              {sintomas.length} {sintomas.length === 1 ? 'síntoma confirmado' : 'síntomas confirmados'}
            </p>
            <h3>{error ? 'Fallo al consultar el motor de Prolog' : 'Posibles fallas detectadas'}</h3>
          </div>
          <div className="card-header-actions">
            <button className="secondary-btn" id="volverCuestionarioBtn" onClick={onVolver}>
              Volver al cuestionario
            </button>
            <button className="secondary-btn" onClick={onCambiarVehiculo}>
              Cambiar vehículo
            </button>
          </div>
        </div>
        <div className="card-body" aria-busy={cargando ? 'true' : 'false'}>
          {error ? (
            <p className="text-danger">{error}</p>
          ) : cargando ? (
            <p className="text-muted">Conectando con el motor de Prolog...</p>
          ) : fallas.length === 0 ? (
            <p className="text-muted">No se encontraron fallas asociadas.</p>
          ) : (
            <div className="cards-grid">
              {fallas.map((f) => (
                <article className="info-card" key={f.id}>
                  <div className="card-header">
                    <div>
                      <p className="card-category">Falla Inferida</p>
                      <h3>{f.nombre}</h3>
                    </div>
                    <span className={`badge ${urgenciaClase(f.urgencia)}`}>{f.urgencia}</span>
                  </div>
                  <div className="card-body">
                    <div className="card-section">
                      <h4>Costo estimado</h4>
                      <p>${f.costo_min} - ${f.costo_max} MXN</p>
                    </div>
                    {f.reparaciones.length > 0 && (
                      <div className="card-section">
                        <h4>Pasos de reparación</h4>
                        <ul className="solutions-list">
                          {f.reparaciones.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
