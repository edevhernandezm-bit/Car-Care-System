export default function Paso1Vehiculo({ onRegistrar }) {
  function registrar(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    onRegistrar({
      marca: fd.get('marca').trim().toLowerCase(),
      modelo: fd.get('modelo').trim().toLowerCase(),
      anio: parseInt(fd.get('anio')) || 0,
    });
  }

  return (
    <div className="diagnostico-container">
      <div className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Paso 1 de 2</p>
            <h3>Registro obligatorio del vehículo</h3>
          </div>
        </div>
        <div className="card-body">
          <p className="text-muted">
            Identifica el vehículo. Si no conoces el modelo, escribe "gen" y año "0".
          </p>
          <form id="flujoVehicleForm" className="vehicle-form" onSubmit={registrar}>
            <div className="form-grid form-grid--vehicle form-grid--flush">
              <label>
                <span>Marca (ej: nissan, toyota, gen)</span>
                <input name="marca" type="text" required placeholder="nissan" />
              </label>
              <label>
                <span>Modelo (ej: sentra, corolla, gen)</span>
                <input name="modelo" type="text" required placeholder="sentra" />
              </label>
              <label>
                <span>Año</span>
                <input name="anio" type="number" min="1980" max="2026" required placeholder="2015" />
              </label>
            </div>
            <div className="form-actions form-actions--start">
              <button className="primary-btn" type="submit">
                Iniciar Cuestionario
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
