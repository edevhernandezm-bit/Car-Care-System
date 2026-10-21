import { useState } from 'react';

import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';
import { ROLES, etiquetaRol } from '../lib/roles.js';

export default function Perfil() {
  const { user, updateUser } = useAuth();
  const esAdmin = user?.role === 'administrador_mecanico';

  const [username, setUsername] = useState(user?.username ?? '');
  const [nombre, setNombre] = useState(user?.nombre ?? '');
  const [role, setRole] = useState(user?.role ?? 'estudiante_mecanica');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const noCoincide = password !== confirmacion;

  async function guardar(e) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    if (noCoincide) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    // El cuerpo se arma campo a campo: un estudiante nunca manda `username` ni
    // `role`, que el backend ignoraria igual, para que lo que viaja sea
    // exactamente lo que puede editar.
    const cuerpo = { nombre };
    if (esAdmin) {
      cuerpo.username = username;
      cuerpo.role = role;
    }
    if (password) cuerpo.password = password;

    setOcupado(true);
    try {
      const actualizado = await apiFetch('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify(cuerpo),
      });
      updateUser(actualizado);
      setPassword('');
      setConfirmacion('');
      setAviso({ tipo: 'ok', texto: 'Perfil actualizado.' });
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
            <p className="card-category">Cuenta</p>
            <h3>Mi perfil</h3>
          </div>
        </div>
        <div className="card-body">
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {aviso && (
            <p className="confianza-chip confianza-alta" role="status">
              {aviso.texto}
            </p>
          )}

          <form className="admin-alta" onSubmit={guardar}>
            <div className="form-grid form-grid--vehicle form-grid--flush">
              <label htmlFor="perfil-username">
                <span>Usuario</span>
                {esAdmin ? (
                  <input
                    id="perfil-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                ) : (
                  <input id="perfil-username" value={user?.username ?? ''} readOnly />
                )}
              </label>
              <label htmlFor="perfil-nombre">
                <span>Nombre</span>
                <input
                  id="perfil-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Juan Pérez"
                />
              </label>
              <label htmlFor="perfil-role">
                <span>Rol</span>
                {esAdmin ? (
                  <>
                    <select
                      id="perfil-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r.valor} value={r.valor}>
                          {r.etiqueta}
                        </option>
                      ))}
                    </select>
                    <small className="field-hint" id="perfil-role-ayuda">
                      Puedes pasar a estudiante; no podrás volver a administrador por ti mismo.
                    </small>
                  </>
                ) : (
                  <input id="perfil-role" value={etiquetaRol(user?.role)} readOnly />
                )}
              </label>
              <label htmlFor="perfil-password">
                <span>Nueva contraseña</span>
                <input
                  id="perfil-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <small className="field-hint" id="perfil-password-ayuda">
                  Déjala vacía para conservarla.
                </small>
              </label>
              <label htmlFor="perfil-confirmacion">
                <span>Confirmar contraseña</span>
                <input
                  id="perfil-confirmacion"
                  type="password"
                  autoComplete="new-password"
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                  aria-invalid={noCoincide || undefined}
                />
              </label>
            </div>
            <div className="form-actions form-actions--start">
              <button className="primary-btn" type="submit" disabled={ocupado || noCoincide}>
                {ocupado ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
