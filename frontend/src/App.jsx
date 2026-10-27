import { useEffect, useMemo, useRef, useState } from 'react';

import BaseConocimiento from './components/BaseConocimiento.jsx';
import EstadisticasCerteza from './components/EstadisticasCerteza.jsx';
import Historial from './components/Historial.jsx';
import MotorBanner from './components/MotorBanner.jsx';
import Paso1Vehiculo from './components/Paso1Vehiculo.jsx';

import Login from './components/Login.jsx';
import AgregarFalla from './components/AgregarFalla.jsx';
import AdministrarFallas from './components/AdministrarFallas.jsx';
import AdministrarUsuarios from './components/AdministrarUsuarios.jsx';
import Perfil from './components/Perfil.jsx';
import { useAuth } from './context/AuthContext.jsx';
import Paso2Sintomas from './components/Paso2Sintomas.jsx';
import Resultados from './components/Resultados.jsx';
import Tickets from './components/Tickets.jsx';
import { useCatalogosIngeniero } from './hooks/useCatalogosIngeniero.js';
import { diagnosticar, guardarDiagnostico, obtenerTipoCambio } from './lib/api.js';
import { mapearProlog } from './lib/diagnostico.js';
import { etiquetaRol } from './lib/roles.js';
import { puedeUsarTickets } from './lib/tickets.js';

// El menu, el encabezado de la pagina y el cuerpo se leen de la misma lista. Con
// las secciones escritas en tres sitios, agregar una era cambiar tres ramas y
// EasyRender se olvidaba de una: el titulo preguntaba por "Fallas Comunes"
// mientras se mostraban las estadisticas.
const SECCIONES = [
  {
    id: 'diagnostico',
    etiqueta: 'Análisis de Fallas',
    titulo: 'Análisis de Fallas',
    subtitulo: 'Sigue los pasos para diagnosticar el vehículo.',
  },
  {
    id: 'base-conocimiento',
    etiqueta: 'Fallas Comunes',
    titulo: 'Fallas Comunes',
    subtitulo: 'Consulta la base de conocimientos del sistema experto.',
  },
  {
    id: 'estadisticas',
    etiqueta: 'Estadísticas',
    titulo: 'Estadísticas',
    subtitulo: 'Qué tan certeza ha dado el sistema en los diagnósticos emitidos.',
  },
  {
    id: 'historial',
    etiqueta: 'Historial',
    titulo: 'Historial',
    subtitulo: 'Consultas guardadas, con el vehículo, las fallas y tus observaciones.',
  },
  // Las tres de administracion viven en la misma lista y no en un segundo
  // bloque junto al menu: al escribirlas aparte, `seccion` no las encontraba y
  // el encabezado caia en SECCIONES[0], de modo que administering usuarios
  // anunciaba "Analisis de Fallas". `soloAdmin` es la unica diferencia entre
  // ellas y las de lectura, asi que se filtra en un punto en vez de duplicar
  // la lista entera.
  {
    id: 'agregar-falla',
    etiqueta: 'Agregar falla',
    titulo: 'Agregar falla',
    subtitulo: 'Registra una falla nueva y su conocimiento asociado en el motor.',
    soloAdmin: true,
  },
  {
    id: 'administrar-fallas',
    etiqueta: 'Administrar fallas',
    titulo: 'Administrar fallas',
    subtitulo: 'Edita o retira fallas que el sistema experto ofrece al diagnostico.',
    soloAdmin: true,
  },
  {
    id: 'administrar-usuarios',
    etiqueta: 'Administrar usuarios',
    titulo: 'Administrar usuarios',
    subtitulo: 'Crea cuentas y decide quien puede capturar fallas.',
    soloAdmin: true,
  },
  // `oculto` la saca del menu lateral: se llega a ella solo desde el circulo de
  // iniciales de la barra superior, que es su unico punto de entrada.
  {
    id: 'perfil',
    etiqueta: 'Mi perfil',
    titulo: 'Mi perfil',
    subtitulo: 'Actualiza tus datos de acceso y tu contraseña.',
    oculto: true,
  },
  {
    id: 'tickets',
    etiqueta: 'Tickets',
    titulo: 'Tickets',
    subtitulo: 'Tickets de reparación y cotizaciones.',
  },
];

// Dos letras para el circulo de la barra superior: las iniciales del nombre, o
// las del usuario si no hay nombre. Sin esto el badge mostraba siempre "AN".
function inicialesDe(usuario) {
  const base = (usuario?.nombre || usuario?.username || '').trim();
  if (!base) return '?';
  const partes = base.split(/\s+/);
  return (partes.length > 1 ? partes[0][0] + partes[1][0] : base.slice(0, 2)).toUpperCase();
}

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
  const [ticketAbiertoId, setTicketAbiertoId] = useState(null);
  const peticionRef = useRef(0);
  const { catalogos, status } = useCatalogosIngeniero();
  const { user, loading, logout } = useAuth();
  const esAdmin = user?.role === 'administrador_mecanico';
  const seccionesVisibles = useMemo(
    () => SECCIONES.filter((s) => {
      if (s.id === 'tickets') return puedeUsarTickets(user);
      return !s.soloAdmin || esAdmin;
    }),
    [esAdmin, user]
  );
  // El menu lateral no lista las ocultas (`Mi perfil`): su entrada es el badge.
  const seccionesMenu = useMemo(
    () => seccionesVisibles.filter((s) => !s.oculto),
    [seccionesVisibles]
  );
  const seccion = seccionesVisibles.find((s) => s.id === section) ?? seccionesVisibles[0];

  // El logout no necesita ruta: vaciar la sesion deja a `user` en null y el
  // render de abajo ya muestra el formulario de ingreso. Navegar a /login
  // exigiria un router que este proyecto no usa.
  const handleLogout = () => {
    logout();
  };

  // La barra de búsqueda solo se pinta donde de verdad filtra. El buscador es
  // global, pero cada pantalla consume la consulta o no: Fallas Comunes,
  // Síntomas y Estadísticas la reciben como prop, y Registro del vehículo y
  // Resultados no la leen. Mostrarla igual era un control mudo — y un lector de
  // pantalla anunciaba un buscador que no filtraba nada.
  const mostrarBusqueda =
    section === 'base-conocimiento' ||
    section === 'estadisticas' ||
    (section === 'diagnostico' && Boolean(vehiculoActual) && vista === 'cuestionario');

  // Y hay que borrar lo que quedara escrito: sin esto, buscar "cvt" en Fallas
  // Comunes y pasar a Registro del vehículo la deja guardada, y al volver
  // aparece filtrada sin que nadie lo haya escrito ahí. El mismo control mudo,
  // del otro lado.
  useEffect(() => {
    if (!mostrarBusqueda) setSearchQuery('');
  }, [mostrarBusqueda]);

  // Si el usuario navega a Tickets y pierde el permiso (admin quita la feature),
  // vuelve automáticamente al diagnóstico para evitar quedarse en una sección
  // a la que no tiene acceso.
  useEffect(() => {
    if (section === 'tickets' && !puedeUsarTickets(user)) {
      setSection('diagnostico');
      setTicketAbiertoId(null);
    }
  }, [section, user, puedeUsarTickets]);

  // El titulo de la pestaña sigue a la seccion visible. Se reusa `seccion.titulo`
  // en vez de una segunda lista de nombres: el menu, el encabezado y la pestaña
  // ya salen todos de SECCIONES.
  useEffect(() => {
    document.title = `Car Care System | ${seccion.titulo}`;
  }, [seccion.titulo]);

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
      // El diagnostico ya no se guarda solo: el usuario escribe sus
      // observaciones y confirma. La tasa se pide aqui solo para pintar el costo
      // en pesos mientras tanto; al guardar, el documento trae su tasa congelada
      // (la que queda archivada en el historial). Si la tasa no responde, el
      // diagnostico se muestra igual, sin equivalencia.
      const [inferidas, tipoCambio] = await Promise.all([
        diagnosticar(vehiculo, sintomas),
        obtenerTipoCambio().catch(() => null),
      ]);
      if (peticion !== peticionRef.current) return;
      const fallas = inferidas.map((f) => mapearProlog(f, catalogos.fallas));
      setResultados({ fallas, vehiculo, sintomas, tipo_cambio: tipoCambio });
    } catch (err) {
      if (peticion !== peticionRef.current) return;
      setResultados({ error: err.message, vehiculo, sintomas });
    }
  };

  // Guardado explicito, disparado por "Guardar diagnostico". Devuelve true si el
  // documento quedo en el historial, para que la vista marque el boton y no lo
  // deje reenviar. Las fallas van tal cual salen de mapearProlog (forma de vista
  // con `id`): el renombrado a `falla` es de cuerpoDiagnostico, no de aqui.
  const guardarResultado = async (observaciones) => {
    if (!resultados || resultados.guardado) return true;
    const doc = await guardarDiagnostico({
      vehiculo: resultados.vehiculo,
      sintomas: resultados.sintomas,
      fallas: resultados.fallas || [],
      observaciones,
    });
    if (!doc) return false;
    setResultados((prev) => ({
      ...prev,
      guardado: doc,
      tipo_cambio: doc.tipo_cambio || prev.tipo_cambio,
    }));
    return true;
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

  // El cuerpo de la seccion de diagnostico se arma aqui y no en el JSX: encadenar
  // un tercer nivel de ternario para las tres secciones hacia el final ilegible
  // y hacia que cambiar una rama tocara las otras dos.
  const contenidoDiagnostico = !vehiculoActual ? (
    <Paso1Vehiculo onRegistrar={registrarVehiculo} />
  ) : vista === 'resultados' ? (
    <Resultados
      resultados={resultados}
      onVolver={volverAlCuestionario}
      onCambiarVehiculo={cambiarVehiculo}
      onGuardar={guardarResultado}
      user={user}
      onTicketCreado={(id) => { setTicketAbiertoId(id); setSection('tickets'); }}
    />
  ) : (
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
  );

  // Sin sesion no hay nada que mostrar: los catalogos y el diagnostico son
  // de lectura, pero las secciones de administracion escriben en MongoDB, asi
  // que pintar el shell sin usuario solo exponia botones que el backend iba a
  // rechazar con 401.
  if (loading) return <p className="app-loading">Cargando sesion...</p>;
  if (!user) return <Login />;

  return (
    <>
      <a className="skip-link" href="#content-area">
        Saltar al contenido principal
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <div>
              {/* No es un encabezado: el unico h1 de la pagina es el nombre de la
                  aplicacion en la barra superior. Dos h1 romperian el esquema
                  que un lector de pantalla usa para navegar la pagina. */}
              <p className="brand-name">{user.nombre}</p>
              <span>{etiquetaRol(user.role)}</span>
            </div>
          </div>
          <nav className="menu" aria-label="Secciones del sistema">
            {seccionesMenu.map((s) => (
              <button
                key={s.id}
                className={`menu-item ${section === s.id ? 'active' : ''}`}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? 'page' : undefined}
              >
                {s.etiqueta}
              </button>
            ))}
            {user && (
              <button className="menu-item" onClick={handleLogout}>Cerrar sesión</button>
            )}
          </nav>
        </aside>

      <main className="main-content">
          <header className="topbar">
            <div>
              <p className="topbar-label">Bienvenido de nuevo</p>
              <h1>Car Care System</h1>
            </div>
            <div className="topbar-actions">
              <p className="topbar-date">{fechaHoy}</p>
              <button
                type="button"
                className="profile-badge"
                onClick={() => setSection('perfil')}
                aria-label="Mi perfil"
                aria-current={section === 'perfil' ? 'page' : undefined}
                title="Mi perfil"
              >
                {inicialesDe(user)}
              </button>
            </div>
          </header>

          <section className="page-intro">
            <div>
              <h2 id="section-title">{seccion.titulo}</h2>
              <p className="section-subtitle">{seccion.subtitulo}</p>
            </div>
{mostrarBusqueda && (
              <div className="search-box">
                <label className="sr-only" htmlFor="busquedaGlobal">
                  Buscar por falla, categoría o síntoma
                </label>
                <input
                  id="busquedaGlobal"
                  type="search"
                  value={searchQuery}
                  /* Aqui no se normaliza nada. El input es controlado, asi que un
                      trim() en cada tecla se comia el espacio que el usuario acababa
                      de escribir y la siguiente letra se pegaba a la anterior:
                      "pastillas freno" nunca existio. La normalizacion (minusculas,
                      tildes, tokens) vive en coincide(), en lib/diagnostico.js. */
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por falla, categoría o síntoma..."
                />
                {/* El filtro se aplica en cada tecla, asi que un boton "Buscar" no
                    hacia nada: anunciaba una accion que no ocurria. La lupa queda
                    como afordancia visual, no como control. */}
                <span className="search-icon">
                  <IconoLupa />
                </span>
              </div>
            )}
          </section>

          <section id="content-area" className="content-area" tabIndex={-1}>
            <MotorBanner status={status} />
            {section === 'diagnostico' && contenidoDiagnostico}
            {section === 'base-conocimiento' && (
              <BaseConocimiento
                fallasCatalogo={catalogos.fallas}
                searchQuery={searchQuery}
                onLimpiarBusqueda={() => setSearchQuery('')}
              />
            )}
            {section === 'estadisticas' && (
              <EstadisticasCerteza
                fallasCatalogo={catalogos.fallas}
                searchQuery={searchQuery}
                onLimpiarBusqueda={() => setSearchQuery('')}
              />
            )}
            {section === 'historial' && <Historial user={user} onAbrirTicket={(id) => { setTicketAbiertoId(id); setSection('tickets'); }} />}
            {section === 'tickets' && puedeUsarTickets(user) && <Tickets ticketAbiertoId={ticketAbiertoId} onAbrir={setTicketAbiertoId} />}
            {section === 'agregar-falla' && esAdmin && <AgregarFalla />}
            {section === 'administrar-fallas' && esAdmin && <AdministrarFallas />}
            {section === 'administrar-usuarios' && esAdmin && <AdministrarUsuarios />}
            {section === 'perfil' && <Perfil />}
          </section>
        </main>
      </div>
    </>
  );
}
