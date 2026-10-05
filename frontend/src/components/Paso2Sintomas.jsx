import { coincide, etiquetaAnio, etiquetaTransmision } from '../lib/diagnostico.js';
import EstadoVacio from './EstadoVacio.jsx';

export default function Paso2Sintomas({
  vehiculo,
  sintomasCatalogo,
  searchQuery,
  seleccionados,
  onToggle,
  onCambiarVehiculo,
  onEjecutar,
  onLimpiarBusqueda,
}) {
  const filtrados = sintomasCatalogo.filter((s) =>
    coincide(`${s.nombre} ${s.categoria}`, searchQuery)
  );

  const categorias = {};
  filtrados.forEach((s) => {
    if (!categorias[s.categoria]) categorias[s.categoria] = [];
    categorias[s.categoria].push(s);
  });

  return (
    <div className="diagnostico-container">
      {/* Cabecera sin marco: antes envolvia a las tarjetas de categoria, y dos
          superficies anidadas se leen como un nivel de mas. */}
      <section className="results-panel">
        <div className="card-header">
          <div>
            <p className="card-category">Paso 2 de 2: Cuestionario</p>
            <h3>
              Analizando:{' '}
              <span className="text-primary">
                {vehiculo.marca.toUpperCase()} {vehiculo.modelo.toUpperCase()} ({etiquetaAnio(vehiculo.anio)}) ·{' '}
                {etiquetaTransmision(vehiculo.transmision)}
              </span>
            </h3>
          </div>
          <button className="secondary-btn" id="reiniciarBtn" onClick={onCambiarVehiculo}>
            Cambiar Vehículo
          </button>
        </div>
      </section>

      {Object.keys(categorias).length === 0 ? (
        <EstadoVacio
          titulo={
            searchQuery
              ? `Ningún síntoma coincide con "${searchQuery}"`
              : 'No hay síntomas disponibles'
          }
          causa={
            searchQuery
              ? 'Prueba con términos más generales como "ruido", "humo" o "freno", o revisa la ortografía.'
              : 'El catálogo de síntomas está vacío. Levanta el servidor de Prolog.'
          }
          accion={
            searchQuery
              ? { etiqueta: 'Limpiar búsqueda', manejar: onLimpiarBusqueda }
              : undefined
          }
        />
      ) : (
        Object.entries(categorias).map(([cat, sList]) => (
          <section className="info-card" key={cat}>
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
          </section>
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
