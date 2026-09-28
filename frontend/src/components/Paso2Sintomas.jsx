export default function Paso2Sintomas({
  vehiculo,
  sintomasCatalogo,
  searchQuery,
  seleccionados,
  onToggle,
  onCambiarVehiculo,
  onEjecutar,
}) {
  const filtrados = sintomasCatalogo.filter((s) =>
    `${s.nombre} ${s.categoria}`.toLowerCase().includes(searchQuery)
  );

  const categorias = {};
  filtrados.forEach((s) => {
    if (!categorias[s.categoria]) categorias[s.categoria] = [];
    categorias[s.categoria].push(s);
  });

  return (
    <div className="diagnostico-container">
      <div className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Paso 2 de 2: Cuestionario</p>
            <h3>
              Analizando:{' '}
              <span className="text-primary">
                {vehiculo.marca.toUpperCase()} {vehiculo.modelo.toUpperCase()} ({vehiculo.anio})
              </span>
            </h3>
          </div>
          <button className="secondary-btn" id="reiniciarBtn" onClick={onCambiarVehiculo}>
            Cambiar Vehículo
          </button>
        </div>
      </div>

      {Object.keys(categorias).length === 0 ? (
        <div className="info-card">
          <div className="card-body">
            <p className="text-muted">
              No encontramos ese síntoma. Intenta buscar usando términos más generales como
              'ruido', 'humo' o 'freno'.
            </p>
          </div>
        </div>
      ) : (
        Object.entries(categorias).map(([cat, sList]) => (
          <div className="info-card" key={cat}>
            <div className="card-header">
              <h3>{cat}</h3>
            </div>
            <div className="card-body">
              <div className="sintomas-checklist">
                {sList.map((s) => (
                  <label className="checkbox-item" key={s.id}>
                    <input
                      type="checkbox"
                      data-id={s.id}
                      checked={seleccionados.has(s.id)}
                      onChange={() => onToggle(s.id)}
                    />
                    <span>{s.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))
      )}

      <div className="analysis-bar">
        <p className="analysis-bar-count" aria-live="polite">
          {seleccionados.size}{' '}
          {seleccionados.size === 1 ? 'síntoma seleccionado' : 'síntomas seleccionados'}
        </p>
        <div className="analysis-bar-actions">
          <button
            className="primary-btn"
            id="ejecutarAnalisisBtn"
            onClick={onEjecutar}
            disabled={seleccionados.size === 0}
          >
            Ejecutar análisis
          </button>
        </div>
      </div>
    </div>
  );
}
