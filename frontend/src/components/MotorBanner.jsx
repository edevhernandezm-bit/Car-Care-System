// El `status` es el de react-query (v5: 'pending' | 'success' | 'error'), el mismo
// que consume EstadisticasCerteza. Se comparaba contra 'ok' y 'loading', que son
// los nombres de la v4 y que v5 nunca emite: ninguna de las dos salidas tempranas
// se cumplia, asi que la rama de error era la unica alcanzable y el banner pintaba
// "motor no disponible" con los catalogos descargados bien.
export default function MotorBanner({ status }) {
  if (status === 'success') return null;

  if (status === 'pending') {
    return (
      <div className="info-card">
        <div className="card-body">
          <p className="text-muted">Cargando los catálogos de síntomas y fallas...</p>
        </div>
      </div>
    );
  }

  // El navegador no habla con el motor: pide los catalogos al gateway same-origin
  // de Express (/api/prolog/...), que es el unico que habla con Prolog. Por eso el
  // aviso no apunta a un puerto de Prolog sino a la API, que es donde se rompe.
  return (
    <div className="info-card">
      <div className="card-header">
        <div>
          <p className="card-category">Error de conexión</p>
          <h3>Motor de Prolog no disponible</h3>
        </div>
      </div>
      <div className="card-body">
        <p className="text-danger">
          No se pudieron cargar los catálogos de síntomas y fallas. El sistema experto usa el
          motor de Prolog como única fuente de verdad, y el navegador los pide a la API, que
          es la que se encarga de hablar con el motor. Revisa que estén levantados:
        </p>
        <pre className="code-block">
          .\scripts\start-prolog.ps1
        </pre>
        <p className="text-muted">
          Si la API tampoco responde, levántala con <code>.\scripts\start-dev.ps1</code>. El
          detalle del error queda en los logs, no aquí.
        </p>
      </div>
    </div>
  );
}
