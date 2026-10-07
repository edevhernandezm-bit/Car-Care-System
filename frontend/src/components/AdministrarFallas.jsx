import { useCallback, useEffect, useState } from 'react';

import { useCatalogosIngeniero } from '../hooks/useCatalogosIngeniero.js';
import { apiFetch } from '../lib/api.js';
import { etiquetaConfianzaDato, etiquetaUrgencia } from '../lib/diagnostico.js';
import { fallaAFormulario, fallaAPayload, validarFalla } from '../lib/fallas.js';
import FallaForm from './FallaForm.jsx';

const moneda = (valor) =>
  `$${Number(valor).toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`;

export default function AdministrarFallas() {
  const { catalogos } = useCatalogosIngeniero();
  const [fallas, setFallas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [borrando, setBorrando] = useState(null);

  // La edicion vive en tres estados sueltos y no en un objeto "editando" con
  // setters dentro: asi el formulario es siempre el mismo componente con props
  // planas, y abrir y cerrar la edicion no tiene que rearmar la estructura.
  const [editando, setEditando] = useState(null);
  const [valor, setValor] = useState(null);
  const [errores, setErrores] = useState({});
  const [enviado, setEnviado] = useState(false);

  // Se piden las eliminadas tambien: si no, la fila desaparecia del listado y no
  // habia forma de confirmar que el borrado paso, ni de distinguished una falla
  // viva de una que ya no lo esta.
  const cargar = useCallback(async () => {
    try {
      setFallas(await apiFetch('/api/fallas?includeDeleted=true', { method: 'GET' }));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function abrirEdicion(doc) {
    setEditando(doc);
    setValor(fallaAFormulario(doc));
    setErrores({});
    setEnviado(false);
  }

  function cerrarEdicion() {
    setEditando(null);
    setValor(null);
    setErrores({});
    setEnviado(false);
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    setEnviado(true);

    const encontrados = validarFalla(valor);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) return;

    try {
      await apiFetch(`/api/fallas/${editando._id}`, {
        method: 'PUT',
        body: JSON.stringify(fallaAPayload(valor)),
      });
      cerrarEdicion();
      await cargar();
    } catch (err) {
      setErrores({ nombre: `No se pudo guardar: ${err.message}` });
    }
  }

  async function eliminar(doc) {
    // Borrado lógico: el documento y los diagnósticos ya emitidos siguen
    // existiendo, la falla solo deja de ofrecerse. El diálogo lo dice para que
    // nadie espere un "deshacer" que la pantalla no tiene.
    const ok = window.confirm(
      `¿Dejar de ofrecer "${doc.nombre}"?\n\nSe marca como eliminada y sale del motor. ` +
        'Los diagnósticos ya emitidos no cambian.'
    );
    if (!ok) return;

    setBorrando(doc._id);
    try {
      await apiFetch(`/api/fallas/${doc._id}`, { method: 'DELETE' });
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setBorrando(null);
    }
  }

  if (editando) {
    return (
      <div className="diagnostico-container">
        <section className="info-card">
          <div className="card-header">
            <div>
              <p className="card-category">Edición</p>
              <h3>{editando.nombre}</h3>
            </div>
          </div>
          <div className="card-body">
            <p className="text-muted">
              El identificador en el motor no cambia aunque renombres la falla: es con el que ya
              está afirmado en Prolog.
            </p>

            <FallaForm
              valor={valor}
              errores={errores}
              enviado={enviado}
              sintomasCatalogo={catalogos.sintomas}
              onCambio={(siguiente) => {
                setValor(siguiente);
                setErrores({});
                setEnviado(false);
              }}
              onEnviar={guardarEdicion}
              onCancelar={cerrarEdicion}
              textoEnviar="Guardar cambios"
            />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="diagnostico-container">
      <section className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Captura de conocimiento</p>
            <h3>Administrar fallas</h3>
          </div>
        </div>
        <div className="card-body">
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          {cargando ? (
            <p className="text-muted">Cargando fallas registradas...</p>
          ) : fallas.length === 0 ? (
            <p className="text-muted">
              Todavía no hay fallas registradas. Agrégalas desde "Agregar falla".
            </p>
          ) : (
            <div className="admin-tabla-wrap">
              <table className="admin-tabla">
                <caption className="sr-only">Fallas registradas por los administradores</caption>
                <thead>
                  <tr>
                    <th scope="col">Falla</th>
                    <th scope="col">Síntomas</th>
                    <th scope="col">Rango</th>
                    <th scope="col">Urgencia</th>
                    <th scope="col">Confianza</th>
                    <th scope="col">Registrada por</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {fallas.map((f) => (
                    <tr key={f._id} className={f.activo ? undefined : 'admin-fila-borrada'}>
                      <th scope="row">
                        <span className="text-primary">{f.nombre}</span>
                        <code className="admin-prologid">{f.prologId}</code>
                      </th>
                      <td>{(f.sintomas || []).join(', ')}</td>
                      <td className="admin-precios">
                        {moneda(f.precioMin)} – {moneda(f.precioMax)}
                      </td>
                      <td>{etiquetaUrgencia(f.urgencia)}</td>
                      <td>{etiquetaConfianzaDato(f.confianzaDato)}</td>
                      <td>{f.creadoPor?.nombre || f.creadoPor?.username || '—'}</td>
                      <td>
                        {f.activo ? (
                          <span className="badge medium">Activa</span>
                        ) : (
                          <span className="badge low">Eliminada</span>
                        )}
                      </td>
                      <td className="admin-acciones">
                        <button className="secondary-btn" onClick={() => abrirEdicion(f)}>
                          Editar
                        </button>
                        {f.activo && (
                          <button
                            className="secondary-btn"
                            onClick={() => eliminar(f)}
                            disabled={borrando === f._id}
                          >
                            {borrando === f._id ? 'Eliminando...' : 'Eliminar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}