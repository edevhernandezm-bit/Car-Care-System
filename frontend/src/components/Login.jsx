import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiFetch } from '../lib/api.js';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Mientras no hay sesion la aplicacion no pinta el shell, asi que el titulo de
  // la pestaña se queda aqui: es el de este formulario.
  useEffect(() => {
    document.title = 'Car Care System | Iniciar sesión';
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      // El backend responde 401 con el mismo texto para usuario inexistente y
      // para contrasena incorrecta, a proposito: distinguir los dos casos le
      // dice a quien prueba si ese usuario existe.
      setError(err.message || 'No se pudo iniciar sesion');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>Car Care System</h1>
        <p className="login-subtitle">Bienvenido</p>
        <label htmlFor="login-usuario">Usuario</label>
        <input
          id="login-usuario"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <label htmlFor="login-password">Contrasena</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" className="primary-btn" disabled={loading}>
          {loading ? 'Verificando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}