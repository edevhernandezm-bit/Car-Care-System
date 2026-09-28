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
    const { marca, modelo, anio } = vehiculoActual;
    const vehiculo = { marca, modelo, anio };
    const sintomas = [...sintomasConfirmados];

    setVista('resultados');
    setResultados({ cargando: true, vehiculo, sintomas });

    try {
      const inferidas = await diagnosticar(vehiculo, sintomas);
      if (peticion !== peticionRef.current) return;
      const fallas = inferidas.map((f) => mapearProlog(f, catalogos.fallas));
      setResultados({ fallas, vehiculo, sintomas });

      guardarDiagnostico(vehiculo, sintomas, fallas);
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
            <button type="button" aria-label="Buscar">🔎</button>
          </div>
        </section>

        <section id="content-area" className="content-area">
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
                  />
                )
            : (
              <BaseConocimiento
                fallasCatalogo={catalogos.fallas}
                searchQuery={searchQuery}
              />
            )}
        </section>
      </main>
    </div>
  );
}
