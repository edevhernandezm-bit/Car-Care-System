import { useRef, useState } from 'react';

import { ANIO_MAXIMO, TRANSMISIONES } from '../lib/fallas.js';

function validar(anioTexto) {
  const anio = Number.parseInt(anioTexto, 10);
  if (anioTexto.trim() === '') return 'Escribe el año del vehículo, o 0 si no lo conoces.';
  if (!Number.isFinite(anio)) return 'El año debe ser un número entero.';
  if (anio < 0 || anio > ANIO_MAXIMO) return `El año debe estar entre 0 y ${ANIO_MAXIMO}.`;
  return null;
}

export default function Paso1Vehiculo({ onRegistrar }) {
  const [anio, setAnio] = useState('');
  const [errorAnio, setErrorAnio] = useState(null);
  const [intento, setIntento] = useState(false);
  const resumenRef = useRef(null);

  function registrar(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const error = validar(fd.get('anio'));
    setErrorAnio(error);
    setIntento(true);

    // Tras un envio fallido el foco pasa al resumen: quien navega con teclado o
    // lector de pantalla debe enterarse del error sin tener que recorrer los
    // campos buscandolo (WCAG 3.3.1 y 3.3.3).
    if (error) {
      requestAnimationFrame(() => resumenRef.current?.focus());
      return;
    }

    onRegistrar({
      marca: fd.get('marca').trim().toLowerCase(),
      modelo: fd.get('modelo').trim().toLowerCase(),
      anio: parseInt(fd.get('anio'), 10) || 0,
      transmision: fd.get('transmision'),
    });
  }

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
            Identifica el vehículo con marca y modelo. Si no conoces el año, escribe 0; si no
            conoces la transmisión, elige "No lo sé". El sistema seguirá funcionando, solo que
            con menos fallas disponibles.
          </p>

          {intento && errorAnio && (
            <div
              className="error-summary"
              role="alert"
              tabIndex={-1}
              ref={resumenRef}
            >
              <p className="error-summary-title">Hay un problema con el formulario</p>
              <ul>
                <li>
                  <a href="#anio" onClick={(e) => { e.preventDefault(); document.getElementById('anio')?.focus(); }}>
                    {errorAnio}
                  </a>
                </li>
              </ul>
            </div>
          )}

          <form id="flujoVehicleForm" className="vehicle-form" onSubmit={registrar} noValidate>
            <div className="form-grid form-grid--vehicle form-grid--flush">
              <label htmlFor="marca">
                <span>Marca (ej: nissan, toyota, gen)</span>
                <input id="marca" name="marca" type="text" required placeholder="nissan" />
              </label>
              <label htmlFor="modelo">
                <span>Modelo (ej: sentra, corolla, gen)</span>
                <input id="modelo" name="modelo" type="text" required placeholder="sentra" />
              </label>
              <label htmlFor="anio">
                <span>Año</span>
                <input
                  id="anio"
                  name="anio"
                  type="number"
                  min="0"
                  max={ANIO_MAXIMO}
                  required
                  placeholder="2015"
                  value={anio}
                  onChange={(e) => setAnio(e.target.value)}
                  onBlur={() => setErrorAnio(validar(anio))}
                  aria-describedby={errorAnio ? 'anio-help anio-error' : 'anio-help'}
                  aria-invalid={errorAnio ? 'true' : undefined}
                />
                {/* El 0 es el centinela de "desconocido": da una salida válida a
                    quien no conoce el año, en vez de dejar el campo en blanco
                    (que el formulario rechazaría) o inventar uno. */}
                <small id="anio-help" className="field-hint">
                  Escribe <strong>0</strong> si no lo conoces: es lo mismo que "no lo sé". El
                  sistema seguirá usando las 19 fallas generales, pero omitirá las 35 que dependen
                  de marca, modelo y año.
                </small>
                {errorAnio && (
                  <p className="field-error" id="anio-error">
                    {errorAnio}
                  </p>
                )}
              </label>
              <label htmlFor="transmision">
                <span>Transmisión</span>
                <select id="transmision" name="transmision" defaultValue="desconocida">
                  {TRANSMISIONES.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>
                <small className="field-hint" id="transmision-help">
                  Algunas fallas dependen de la caja: decir la transmisión es la única forma de
                  detectarlas.
                </small>
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