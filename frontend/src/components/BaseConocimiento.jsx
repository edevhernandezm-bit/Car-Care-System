import { etiquetaUrgencia, urgenciaClase } from '../lib/diagnostico.js';

export default function BaseConocimiento({ fallasCatalogo, searchQuery }) {
  const filtradas = fallasCatalogo.filter((f) =>
    `${f.nombre} ${etiquetaUrgencia(f.urgencia)}`.toLowerCase().includes(searchQuery)
  );

  if (filtradas.length === 0) {
    return (
      <div className="info-card">
        <div className="card-body">
          <p>No se encontraron fallas.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="knowledge-grid">
      {filtradas.map((f) => {
        const urgencia = etiquetaUrgencia(f.urgencia);
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
              <div className="card-footer">
                <span>Costo</span>
                <strong>${f.costo_min} - ${f.costo_max}</strong>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
