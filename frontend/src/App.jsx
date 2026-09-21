import { useEffect, useState } from 'react';
import { sintomas_prolog, fallas_prolog, reparaciones_prolog } from './data/baseConocimiento.js';
import { inferir_fallas } from './motor/inferencia.js';

const PROLOG_URL = 'http://localhost:8000/api/diagnostico';
const API_DIAGNOSTICOS = '/api/diagnosticos';

const urgenciaClase = (u) =>
  u === 'Crítica' || u === 'Alta' ? 'high' : u === 'Media' ? 'medium' : 'low';

const fechaHoy = new Date().toLocaleDateString('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function mapearProlog(f) {
  const base = fallas_prolog.find((x) => x.id === f.id);
  const urg =
    f.urgencia === 'critica'
      ? 'Crítica'
      : f.urgencia === 'alta'
        ? 'Alta'
        : f.urgencia === 'media'
          ? 'Media'
          : f.urgencia === 'baja'
            ? 'Baja'
            : 'Desconocida';
  return {
    id: f.id,
    nombre: base ? base.nombre : f.id.replace(/_/g, ' '),
    urgencia: urg,
    costo_min: f.costo_min,
    costo_max: f.costo_max,
    reparaciones: (f.reparaciones || []).map((r) => String(r).replace(/_/g, ' ')),
  };
}

function mapearInferenciaJS(par) {
  const split = par.split('-');
  const certeza = parseFloat(split[0]);
  const id = split.slice(1).join('-');
  const base = fallas_prolog.find((x) => x.id === id);
  return {
    id: base ? base.id : id,
    nombre: base ? base.nombre : id.replace(/_/g, ' '),
    urgencia: base ? base.urgencia : 'Desconocida',
    costo_min: base ? base.costo_min : 0,
    costo_max: base ? base.costo_max : 0,
    reparaciones: (reparaciones_prolog[id] || []).map((r) => r.replace(/_/g, ' ')),
    certeza,
  };
}

export default function App() {
  const [section, setSection] = useState('diagnostico');
  const [searchQuery, setSearchQuery] = useState('');
  const [vehiculoActual, setVehiculoActual] = useState(null);
  const [sintomasConfirmados, setSintomasConfirmados] = useState([]);
  const [resultados, setResultados] = useState(null);

  useEffect(() => {
    if (!vehiculoActual || sintomasConfirmados.length === 0) {
      setResultados(null);
      return;
    }

    let activo = true;
    setResultados({ cargando: true });

    const { marca, modelo, anio } = vehiculoActual;
    (async () => {
      let fallas = [];
      try {
        const res = await fetch(PROLOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marca, modelo, anio, sintomas: sintomasConfirmados }),
        });
        if (!res.ok) throw new Error('Servidor apagado');
        const data = await res.json();
        fallas = (data.fallas || []).map(mapearProlog);
      } catch (err) {
        console.warn('Servidor Prolog no detectado. Usando inferencia local.');
        fallas = inferir_fallas(sintomasConfirmados, marca, modelo, anio).map(mapearInferenciaJS);
      }

      if (!activo) return;
      setResultados({ fallas });

      fetch(API_DIAGNOSTICOS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehiculo: { marca, modelo, anio },
          sintomas: sintomasConfirmados,
          fallas: fallas.map((f) => ({ falla: f.id, certeza: f.certeza ?? 0 })),
        }),
      }).catch(() => {});
    })();

    return () => {
      activo = false;
    };
  }, [vehiculoActual, sintomasConfirmados]);

  const cambiarVehiculo = () => {
    setVehiculoActual(null);
    setSintomasConfirmados([]);
    setResultados(null);
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
            <p>{fechaHoy}</p>
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
          {section === 'diagnostico'
            ? !vehiculoActual
              ? renderPaso1Vehiculo()
              : renderPaso2Sintomas()
            : renderBaseConocimiento()}
        </section>
      </main>
    </div>
  );

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
            <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
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
              }}
            >
              <div className="form-grid" style={{ padding: 0 }}>
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
              <div className="form-actions" style={{ marginTop: 24, justifyContent: 'flex-start', padding: 0 }}>
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
    const filtrados = sintomas_prolog.filter((s) =>
      `${s.nombre} ${s.categoria}`.toLowerCase().includes(searchQuery)
    );

    const categorias = {};
    filtrados.forEach((s) => {
      if (!categorias[s.categoria]) categorias[s.categoria] = [];
      categorias[s.categoria].push(s);
    });

    return (
      <div className="diagnostico-container">
        <div className="info-card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div>
              <p className="card-category">Paso 2 de 2: Cuestionario</p>
              <h3>
                Analizando:{' '}
                <span style={{ color: 'var(--primary)' }}>
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
              <p style={{ color: 'var(--muted)' }}>
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

        {resultados && <div className="diagnostico-resultados">{renderResultados()}</div>}
      </div>
    );
  }

  function renderResultados() {
    const cargando = resultados.cargando;
    const fallas = resultados.fallas || [];

    return (
      <div className="info-card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div>
            <p className="card-category">Síntomas confirmados: {sintomasConfirmados.length}</p>
            <h3>Posibles fallas detectadas</h3>
          </div>
        </div>
        <div className="card-body">
          {cargando ? (
            <p>Conectando con el motor de Prolog...</p>
          ) : fallas.length === 0 ? (
            <p>No se encontraron fallas asociadas.</p>
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
    );
  }

  function renderBaseConocimiento() {
    const filtradas = fallas_prolog.filter((f) =>
      `${f.nombre} ${f.urgencia}`.toLowerCase().includes(searchQuery)
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
        {filtradas.map((f) => (
          <article className="info-card common-falla-card" key={f.id}>
            <div className="card-header">
              <div>
                <p className="card-category">Falla</p>
                <h3>{f.nombre}</h3>
              </div>
              <span className={`badge ${urgenciaClase(f.urgencia)}`}>{f.urgencia}</span>
            </div>
            <div className="card-body">
              <div className="card-section">
                <h4>Causas/Pasos</h4>
                <ul>
                  {(reparaciones_prolog[f.id] || ['Sin datos']).map((p) => (
                    <li key={p}>{p.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
              </div>
              <div className="card-footer">
                <span>Costo</span>
                <strong>${f.costo_min} - ${f.costo_max}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }
}