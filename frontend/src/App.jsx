import { useEffect, useRef, useState } from 'react';

const PROLOG_URL = 'http://localhost:8000/api/diagnostico';
const PROLOG_SINTOMAS_URL = 'http://localhost:8000/api/sintomas';
const PROLOG_FALLAS_URL = 'http://localhost:8000/api/fallas';
const API_DIAGNOSTICOS = '/api/diagnosticos';

const urgenciaClase = (u) =>
  u === 'Crítica' || u === 'Alta' ? 'high' : u === 'Media' ? 'medium' : 'low';

const fechaHoy = new Date().toLocaleDateString('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function etiquetaUrgencia(u) {
  switch (u) {
    case 'critica': return 'Crítica';
    case 'alta': return 'Alta';
    case 'media': return 'Media';
    case 'baja': return 'Baja';
    default: return 'Desconocida';
  }
}

function mapearProlog(f, catalogoFallas) {
  const base = catalogoFallas.find((x) => x.id === f.id);
  return {
    id: f.id,
    nombre: base ? base.nombre : f.id.replace(/_/g, ' '),
    urgencia: etiquetaUrgencia(f.urgencia || base?.urgencia),
    costo_min: f.costo_min,
    costo_max: f.costo_max,
    reparaciones: f.reparaciones || [],
    certeza: f.certeza,
  };
}

export default function App() {
  const [section, setSection] = useState('diagnostico');
  const [searchQuery, setSearchQuery] = useState('');
  const [vehiculoActual, setVehiculoActual] = useState(null);
  const [sintomasConfirmados, setSintomasConfirmados] = useState([]);
  const [resultados, setResultados] = useState(null);
  const [vista, setVista] = useState('cuestionario');
  const peticionRef = useRef(0);
  const [engineStatus, setEngineStatus] = useState('loading');
  const [sintomasCatalogo, setSintomasCatalogo] = useState([]);
  const [fallasCatalogo, setFallasCatalogo] = useState([]);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [sRes, fRes] = await Promise.all([
          fetch(PROLOG_SINTOMAS_URL),
          fetch(PROLOG_FALLAS_URL),
        ]);
        if (!sRes.ok || !fRes.ok) throw new Error('El motor no responde');
        const sData = await sRes.json();
        const fData = await fRes.json();
        if (!activo) return;
        setSintomasCatalogo(sData.sintomas || []);
        setFallasCatalogo(fData.fallas || []);
        setEngineStatus('ok');
      } catch (err) {
        if (!activo) return;
        setEngineStatus('error');
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  const ejecutarAnalisis = async () => {
    if (!vehiculoActual || sintomasConfirmados.length === 0 || resultados?.cargando) return;

    const peticion = ++peticionRef.current;
    const { marca, modelo, anio } = vehiculoActual;
    const vehiculo = { marca, modelo, anio };
    const sintomas = [...sintomasConfirmados];

    setVista('resultados');
    setResultados({ cargando: true, vehiculo, sintomas });

    try {
      const res = await fetch(PROLOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marca, modelo, anio, sintomas }),
      });
      if (!res.ok) throw new Error('Servidor apagado');
      const data = await res.json();
      if (peticion !== peticionRef.current) return;
      const fallas = (data.fallas || []).map((f) => mapearProlog(f, fallasCatalogo));
      setResultados({ fallas, vehiculo, sintomas });

      fetch(API_DIAGNOSTICOS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehiculo,
          sintomas,
          fallas: fallas.map((f) => ({ falla: f.id, certeza: f.certeza ?? 0 })),
        }),
      }).catch(() => {});
    } catch (err) {
      if (peticion !== peticionRef.current) return;
      setResultados({ error: err.message, vehiculo, sintomas });
    }
  };

  const volverAlCuestionario = () => {
    peticionRef.current++;
    setResultados(null);
    setVista('cuestionario');
  };

  const cambiarVehiculo = () => {
    peticionRef.current++;
    setVehiculoActual(null);
    setSintomasConfirmados([]);
    setResultados(null);
    setVista('cuestionario');
  };

  const toggleSintoma = (id) => {
    setSintomasConfirmados((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">🔧</div>
          <div>
            <h1>Administrador</h1>
            <span>Taller Mecánico</span>
          </div>
        </div>
        <nav className="menu">
          <button
            className={`menu-item ${section === 'diagnostico' ? 'active' : ''}`}
            onClick={() => setSection('diagnostico')}
          >
            Análisis de Fallas
          </button>
          <button
            className={`menu-item ${section === 'base-conocimiento' ? 'active' : ''}`}
            onClick={() => setSection('base-conocimiento')}
          >
            Fallas Comunes
          </button>
        </nav>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="topbar-label">Bienvenido de nuevo</p>
            <h1>Sistema Car Care</h1>
          </div>
          <div className="topbar-actions">
            <p className="topbar-date">{fechaHoy}</p>
            <div className="profile-badge">AN</div>
          </div>
        </header>

        <section className="page-intro">
          <div>
            <h2 id="section-title">
              {section === 'diagnostico' ? 'Análisis de Fallas' : 'Fallas Comunes'}
            </h2>
            <p className="section-subtitle">
              {section === 'diagnostico'
                ? 'Sigue los pasos para diagnosticar el vehículo.'
                : 'Consulta la base de conocimientos del sistema experto.'}
            </p>
          </div>
          <div className="search-box">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value.trim().toLowerCase())}
              placeholder="Buscar por falla, categoría o síntoma..."
            />
            <button type="button" aria-label="Buscar">🔎</button>
          </div>
        </section>

        <section id="content-area" className="content-area">
          {renderEngineBanner()}
          {section === 'diagnostico'
            ? !vehiculoActual
              ? renderPaso1Vehiculo()
              : vista === 'resultados'
                ? renderResultados()
                : renderPaso2Sintomas()
            : renderBaseConocimiento()}
        </section>
      </main>
    </div>
  );

  function renderEngineBanner() {
    if (engineStatus === 'ok') return null;
    if (engineStatus === 'loading') {
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

  function renderPaso1Vehiculo() {
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
            <form
              id="flujoVehicleForm"
              className="vehicle-form"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.target);
                setVehiculoActual({
                  marca: fd.get('marca').trim().toLowerCase(),
                  modelo: fd.get('modelo').trim().toLowerCase(),
                  anio: parseInt(fd.get('anio')) || 0,
                });
                setSintomasConfirmados([]);
                setResultados(null);
                setVista('cuestionario');
              }}
            >
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

  function renderPaso2Sintomas() {
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
                  {vehiculoActual.marca.toUpperCase()} {vehiculoActual.modelo.toUpperCase()} ({vehiculoActual.anio})
                </span>
              </h3>
            </div>
            <button className="secondary-btn" id="reiniciarBtn" onClick={cambiarVehiculo}>
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
                        checked={sintomasConfirmados.includes(s.id)}
                        onChange={() => toggleSintoma(s.id)}
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
            {sintomasConfirmados.length}{' '}
            {sintomasConfirmados.length === 1 ? 'síntoma seleccionado' : 'síntomas seleccionados'}
          </p>
          <div className="analysis-bar-actions">
            <button
              className="primary-btn"
              id="ejecutarAnalisisBtn"
              onClick={ejecutarAnalisis}
              disabled={sintomasConfirmados.length === 0}
            >
              Ejecutar análisis
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderResultados() {
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
              <button
                className="secondary-btn"
                id="volverCuestionarioBtn"
                onClick={volverAlCuestionario}
              >
                Volver al cuestionario
              </button>
              <button className="secondary-btn" onClick={cambiarVehiculo}>
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

  function renderBaseConocimiento() {
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
}