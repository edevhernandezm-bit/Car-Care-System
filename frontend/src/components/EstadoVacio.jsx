// Estado vacio compartido por el catalogo y el cuestionario. Antes cada vista
// repetia el mismo marcado con un texto generico ("No se encontraron fallas"),
// que no dice por que la vista esta vacia ni ofrece salida. Este componente
// obliga a que ambas vistas pasen titulo, causa y, cuando aplica, la accion de
// limpiar la busqueda.
export default function EstadoVacio({ titulo, causa, accion }) {
  return (
    <div className="info-card">
      <div className="card-body">
        <div className="empty-state">
          <h4>{titulo}</h4>
          {causa && <p>{causa}</p>}
          {accion && (
            <button className="secondary-btn" onClick={accion.manejar}>
              {accion.etiqueta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
