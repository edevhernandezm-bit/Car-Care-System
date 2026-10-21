import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import { ROLES, etiquetaRol } from '../lib/roles.js';

const USUARIO_VACIO = {
  username: '',
  password: '',
  password2: '',
  nombre: '',
  role: 'estudiante_mecanica',
};

export default function AdministrarUsuarios() {
  const { user: sesion } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [nuevo, setNuevo] = useState(USUARIO_VACIO);
  const [editando, setEditando] = useState(null);
  const [cambios, setCambios] = useState({});
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await apiFetch('/api/usuarios', { method: 'GET' }));
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

  async function crear(e) {
    e.preventDefault();
    setAviso(null);
    setError(null);
    if (nuevo.password !== nuevo.password2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setOcupado(true);
    try {
      const cuerpo = { ...nuevo };
      delete cuerpo.password2;
      await apiFetch('/api/usuarios', { method: 'POST', body: JSON.stringify(cuerpo) });
      setNuevo(USUARIO_VACIO);
      setAviso({ tipo: 'ok', texto: `Usuario "${nuevo.username}" creado.` });
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  }

  function abrirEdicion(u) {
    setEditando(u._id);
    // La contraseña no viene del backend y no se precarga: si se prefillara con
    // algo, el administrador podria guardar sin querer una contraseña que no es
    // la que cree. El campo arranca vacío y solo se envía si se escribe algo.
    setCambios({ nombre: u.nombre || '', role: u.role, password: '', password2: '' });
    setError(null);
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    setError(null);
    if (cambios.password !== cambios.password2) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setOcupado(true);
    const cuerpo = { nombre: cambios.nombre, role: cambios.role, activo: usuarios.find((u) => u._id === editando)?.activo };
    if (cambios.password) cuerpo.password = cambios.password;

    try {
      await apiFetch(`/api/usuarios/${editando}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
      setEditando(null);
      setCambios({});
      setAviso({ tipo: 'ok', texto: 'Usuario actualizado.' });
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  }

  async function desactivar(u) {
    const ok = window.confirm(
      `¿Desactivar a "${u.username}"?\n\nNo podrá iniciar sesión. La cuenta se conserva y puede volver a activarse editándola.`
    );
    if (!ok) return;

    setOcupado(true);
    try {
      await apiFetch(`/api/usuarios/${u._id}`, { method: 'DELETE' });
      setAviso({ tipo: 'ok', texto: `Usuario "${u.username}" desactivado.` });
      await cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="diagnostico-container">
      <section className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Acceso</p>
            <h3>Administrar usuarios</h3>
          </div>
        </div>
        <div className="card-body">
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {aviso && (
            <p
              className={aviso.tipo === 'ok' ? 'confianza-chip confianza-alta' : 'field-error'}
              role="status"
            >
              {aviso.texto}
            </p>
          )}

          <form className="admin-alta" onSubmit={crear}>
            <h4>Nuevo usuario</h4>
            <div className="form-grid form-grid--vehicle form-grid--flush">
              <label htmlFor="nu-username">
                <span>Usuario</span>
                <input
                  id="nu-username"
                  value={nuevo.username}
                  onChange={(e) => setNuevo({ ...nuevo, username: e.target.value })}
                  placeholder="jperez"
                  required
                />
              </label>
              <label htmlFor="nu-nombre">
                <span>Nombre</span>
                <input
                  id="nu-nombre"
                  value={nuevo.nombre}
                  onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                  placeholder="Juan Pérez"
                />
              </label>
              <label htmlFor="nu-password">
                <span>Contraseña</span>
                <input
                  id="nu-password"
                  type="password"
                  autoComplete="new-password"
                  value={nuevo.password}
                  onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
                  required
                />
              </label>
              <label htmlFor="nu-role">
                <span>Rol</span>
                <select
                  id="nu-role"
                  value={nuevo.role}
                  onChange={(e) => setNuevo({ ...nuevo, role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.etiqueta}
                    </option>
                  ))}
                </select>
                <small className="field-hint" id="nu-role-ayuda">
                  Solo el administrador captura y edita fallas. El estudiante solo diagnostica.
                </small>
              </label>
              <label htmlFor="nu-password2">
                <span>Confirmar contraseña</span>
                <input
                  id="nu-password2"
                  type="password"
                  autoComplete="new-password"
                  value={nuevo.password2}
                  onChange={(e) => setNuevo({ ...nuevo, password2: e.target.value })}
                  aria-invalid={nuevo.password !== nuevo.password2 || undefined}
                  required
                />
              </label>
            </div>
            <div className="form-actions form-actions--start">
              <button
                className="primary-btn"
                type="submit"
                disabled={ocupado || nuevo.password !== nuevo.password2}
              >
                {ocupado ? 'Creando...' : 'Crear usuario'}
              </button>
            </div>
          </form>

          <h4>Cuentas existentes</h4>
          {cargando ? (
            <p className="text-muted">Cargando usuarios...</p>
          ) : (
            <div className="admin-tabla-wrap">
              <table className="admin-tabla">
                <caption className="sr-only">Cuentas de acceso al sistema</caption>
                <thead>
                  <tr>
                    <th scope="col">Usuario</th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Rol</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u._id} className={u.activo ? undefined : 'admin-fila-borrada'}>
                      <th scope="row">
                        {u.username}
                        {sesion?.id === u._id && (
                          <span className="admin-tuú"> (tú)</span>
                        )}
                      </th>
                      {editando === u._id ? (
                        <td colSpan={4}>
                          <form className="admin-edicion" onSubmit={guardarEdicion}>
                            <label htmlFor="ed-nombre">
                              <span>Nombre</span>
                              <input
                                id="ed-nombre"
                                value={cambios.nombre}
                                onChange={(e) => setCambios({ ...cambios, nombre: e.target.value })}
                              />
                            </label>
                            <label htmlFor="ed-role">
                              <span>Rol</span>
                              <select
                                id="ed-role"
                                value={cambios.role}
                                onChange={(e) => setCambios({ ...cambios, role: e.target.value })}
                              >
                                {ROLES.map((r) => (
                                  <option key={r.valor} value={r.valor}>
                                    {r.etiqueta}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label htmlFor="ed-password">
                              <span>Nueva contraseña</span>
                              <input
                                id="ed-password"
                                type="password"
                                autoComplete="new-password"
                                value={cambios.password}
                                onChange={(e) =>
                                  setCambios({ ...cambios, password: e.target.value })
                                }
                              />
                              <small className="field-hint" id="ed-password-ayuda">
                                Déjala vacía para conservarla.
                              </small>
                            </label>
                            <label htmlFor="ed-password2">
                              <span>Confirmar contraseña</span>
                              <input
                                id="ed-password2"
                                type="password"
                                autoComplete="new-password"
                                value={cambios.password2 ?? ''}
                                onChange={(e) =>
                                  setCambios({ ...cambios, password2: e.target.value })
                                }
                                aria-invalid={cambios.password !== cambios.password2 || undefined}
                              />
                            </label>
                            <div className="form-actions form-actions--start">
                              <button
                                className="primary-btn"
                                type="submit"
                                disabled={ocupado || cambios.password !== cambios.password2}
                              >
                                Guardar
                              </button>
                              <button
                                type="button"
                                className="secondary-btn"
                                onClick={() => setEditando(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          </form>
                        </td>
                      ) : (
                        <>
                          <td>{u.nombre || '—'}</td>
                          <td>{etiquetaRol(u.role)}</td>
                          <td>
                            {u.activo ? (
                              <span className="badge medium">Activo</span>
                            ) : (
                              <span className="badge low">Inactivo</span>
                            )}
                          </td>
                          <td className="admin-acciones">
                            <button className="secondary-btn" onClick={() => abrirEdicion(u)}>
                              Editar
                            </button>
                            {u.activo && (
                              <button
                                className="secondary-btn"
                                onClick={() => desactivar(u)}
                                disabled={ocupado}
                              >
                                Desactivar
                              </button>
                            )}
                            {!u.activo && (
                              <button
                                className="secondary-btn"
                                onClick={async () => {
                                  setOcupado(true);
                                  try {
                                    await apiFetch(`/api/usuarios/${u._id}`, {
                                      method: 'PUT',
                                      body: JSON.stringify({ activo: true }),
                                    });
                                    await cargar();
                                  } catch (err) {
                                    setError(err.message);
                                  } finally {
                                    setOcupado(false);
                                  }
                                }}
                                disabled={ocupado}
                              >
                                Reactivar
                              </button>
                            )}
                          </td>
                        </>
                      )}
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