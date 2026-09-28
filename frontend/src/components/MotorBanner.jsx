export default function MotorBanner({ status }) {
  if (status === 'ok') return null;

  if (status === 'loading') {
    return (
      <div className="info-card">
        <div className="card-body">
          <p className="text-muted">
            Conectando con el motor de inferencia de Prolog en http://localhost:8000...
          </p>
        </div>
      </div>
    );
  }

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
          No se pudo conectar con el servidor de Prolog (http://localhost:8000). El sistema
          experto usa el motor de Prolog como única fuente de verdad. Inicia el servidor con:
        </p>
        <pre className="code-block">
          swipl -f Prolog/motor_inferencia.pl -g "server(8000), sleep(3600)" -t halt
        </pre>
      </div>
    </div>
  );
}
