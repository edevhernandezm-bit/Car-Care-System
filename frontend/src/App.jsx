import { useMemo, useRef, useState } from 'react';

import BaseConocimiento from './components/BaseConocimiento.jsx';
import MotorBanner from './components/MotorBanner.jsx';
import Paso1Vehiculo from './components/Paso1Vehiculo.jsx';
import Paso2Sintomas from './components/Paso2Sintomas.jsx';
import Resultados from './components/Resultados.jsx';
import { useCatalogosIngeniero } from './hooks/useCatalogosIngeniero.js';
import { diagnosticar, guardarDiagnostico } from './lib/api.js';
import { mapearProlog } from './lib/diagnostico.js';

const fechaHoy = new Date().toLocaleDateString('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// Iconos en SVG en linea en vez de emoji: un emoji se dibuja con la fuente del
// sistema, asi que el mismo caracter cambia de forma entre Windows, macOS y
// Android, y no se puede controlar con tokens de color. Ademas son texto, no
// graficos, y un lector de pantalla los anuncia en voz alta.
function IconoLlave({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconoLupa({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export default function App() {
  const [section, setSection] = useState('diagnostico');
  const [searchQuery, setSearchQuery] = useState('');
  const [vehiculoActual, setVehiculoActual] = useState(null);
  const [sintomasConfirmados, setSintomasConfirmados] = useState([]);
  // El array conserva el orden de selección para el envío al motor; el Set es
  // la vista de lectura que la lista de checkboxes consulta por cada opción.
  const seleccionados = useMemo(() => new Set(sintomasConfirmados), [sintomasConfirmados]);
  const [resultados, setResultados] = useState(null);
  const [vista, setVista] = useState('cuestionario');
  const peticionRef = useRef(0);
  const { catalogos, status } = useCatalogosIngeniero();

  const registrarVehiculo = (vehiculo) => {
    setVehiculoActual(vehiculo);
    setSintomasConfirmados([]);
    setResultados(null);
    setVista('cuestionario');
  };

  const ejecutarAnalisis = async () => {
    if (!vehiculoActual || sintomasConfirmados.length === 0 || resultados?.cargando) return;

    const peticion = ++peticionRef.current;
    const { marca, modelo, anio, transmision } = vehiculoActual;
    const vehiculo = { marca, modelo, anio, transmision };
    const sintomas = [...sintomasConfirmados];

    setVista('resultados');
    setResultados({ cargando: true, vehiculo, sintomas });

    try {
      const inferidas = await diagnosticar(vehiculo, sintomas);
      if (peticion !== peticionRef.current) return;
      const fallas = inferidas.map((f) => mapearProlog(f, catalogos.fallas));
      setResultados({ fallas, vehiculo, sintomas });

      guardarDiagnostico({ vehiculo, sintomas, fallas: fallas.map((f) => ({
        falla: f.id,
        certeza: f.certeza,
        nombre: f.nombre,
        urgencia: f.urgencia,
        moneda: f.moneda,
      })) })
        .then((docGuardado) => {
          if (peticion !== peticionRef.current) return;
          setResultados((prev) => ({
            ...prev,
            guardado: docGuardado || null,
            tipo_cambio: docGuardado?.tipo_cambio || null,
          }));
        });
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
    <>
      <a className="skip-link" href="#content-area">
        Saltar al contenido principal
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-icon">
              <IconoLlave />
            </span>
            <div>
              {/* No es un encabezado: el unico h1 de la pagina es el nombre de la
                  aplicacion en la barra superior. Dos h1 romperian el esquema
                  que un lector de pantalla usa para navegar la pagina. */}
              <p className="brand-name">Administrador</p>
              <span>Taller Mecánico</span>
            </div>
          </div>
          <nav className="menu" aria-label="Secciones del sistema">
            <button
              className={`menu-item ${section === 'diagnostico' ? 'active' : ''}`}
              onClick={() => setSection('diagnostico')}
              aria-current={section === 'diagnostico' ? 'page' : undefined}
            >
              Análisis de Fallas
            </button>
            <button
              className={`menu-item ${section === 'base-conocimiento' ? 'active' : ''}`}
              onClick={() => setSection('base-conocimiento')}
              aria-current={section === 'base-conocimiento' ? 'page' : undefined}
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
              <div className="profile-badge" aria-hidden="true">AN</div>
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
              <label className="sr-only" htmlFor="busquedaGlobal">
                Buscar por falla, categoría o síntoma
              </label>
              <input
                id="busquedaGlobal"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value.trim().toLowerCase())}
                placeholder="Buscar por falla, categoría o síntoma..."
              />
              {/* El filtro se aplica en cada tecla, asi que un boton "Buscar" no
                  hacia nada: anunciaba una accion que no ocurria. La lupa queda
                  como afordancia visual, no como control. */}
              <span className="search-icon">
                <IconoLupa />
              </span>
            </div>
          </section>

          <section id="content-area" className="content-area" tabIndex={-1}>
            <MotorBanner status={status} />
            {section === 'diagnostico'
              ? !vehiculoActual
                ? <Paso1Vehiculo onRegistrar={registrarVehiculo} />
                : vista === 'resultados'
                  ? (
                    <Resultados
                      resultados={resultados}
                      onVolver={volverAlCuestionario}
                      onCambiarVehiculo={cambiarVehiculo}
                    />
                  )
                  : (
                    <Paso2Sintomas
                      vehiculo={vehiculoActual}
                      sintomasCatalogo={catalogos.sintomas}
                      searchQuery={searchQuery}
                      seleccionados={seleccionados}
                      onToggle={toggleSintoma}
                      onCambiarVehiculo={cambiarVehiculo}
                      onEjecutar={ejecutarAnalisis}
                      onLimpiarBusqueda={() => setSearchQuery('')}
                    />
                  )
              : (
                <BaseConocimiento
                  fallasCatalogo={catalogos.fallas}
                  searchQuery={searchQuery}
                  onLimpiarBusqueda={() => setSearchQuery('')}
                />
              )}
          </section>
        </main>
      </div>
    </>
  );
}
