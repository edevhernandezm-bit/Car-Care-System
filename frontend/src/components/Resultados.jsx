import { useState } from 'react';
import {
  certezaNivel,
  certezaPorcentaje,
  convertirCosto,
  CORTE_CERTEZA_ALTA,
  CORTE_CERTEZA_MEDIA,
  etiquetaAnio,
  etiquetaCerteza,
  etiquetaTransmision,
  tasaEsEstimada,
  urgenciaClase,
} from '../lib/diagnostico.js';
import { puedeUsarTickets } from '../lib/tickets.js';
import CrearTicket from './CrearTicket.jsx';

// Certeza del diagnostico. El motor ya calcula un factor MYCIN y define sus
// cortes, pero no lo exportaba al JSON. La barra se marca aria-hidden y el
// valor vive en texto: un grafico de color no es accesible por si solo, y el
// numero es lo que un mecanico necesita para decidir si seguir o verificar.
function BarraCerteza({ certeza }) {
  const nivel = certezaNivel(certeza);
  const pct = certezaPorcentaje(certeza);
  return (
    <div className="certainty">
      <div className="certainty-head">
        <span className="certainty-title">Certeza del diagnóstico</span>
        <strong className={`certainty-value certainty-value--${nivel}`}>
          {pct === null ? etiquetaCerteza(certeza) : `${etiquetaCerteza(certeza)} · ${pct}%`}
        </strong>
      </div>
      <div className="certainty-track" aria-hidden="true">
        <span
          className={`certainty-fill certainty-fill--${nivel}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
        <span className="certainty-tick" style={{ left: `${CORTE_CERTEZA_MEDIA * 100}%` }} />
        <span className="certainty-tick" style={{ left: `${CORTE_CERTEZA_ALTA * 100}%` }} />
      </div>
      <p className="certainty-scale">
        <span>Baja</span>
        <span>{CORTE_CERTEZA_MEDIA * 100}%</span>
        <span>{CORTE_CERTEZA_ALTA * 100}% · Alta</span>
      </p>
    </div>
  );
}

// Sintomas que el motorembrozo para disparar la regla. Es la evidencia que
// sostiene el diagnostico; sin ella el porcentaje no es verificable.
function PorQue({ falla }) {
  const sintomas = falla.sintomas_relacionados || [];
  return (
    <details className="why">
      <summary className="why-summary">
        Por qué este diagnóstico
        <span className="why-count">
          {sintomas.length} {sintomas.length === 1 ? 'síntoma' : 'síntomas'}
        </span>
      </summary>
      <div className="why-body">
        <p className="why-note">
          El motor ponderó estos síntomas contra las reglas de su base de conocimiento para llegar a
          este resultado.
        </p>
        {sintomas.length > 0 ? (
          <ul className="why-list">
            {sintomas.map((s) => (
              <li key={s}>{String(s).replace(/_/g, ' ')}</li>
            ))}
          </ul>
        ) : (
          <p className="why-note">
            El motor no devolvió los síntomas de apoyo de esta falla.
          </p>
        )}
      </div>
    </details>
  );
}

// El costo venia metido en el cuerpo de la tarjeta, entre el encabezado y los
// pasos de reparacion, y se mezclaba con la tasa de cambio en el mismo parrafo.
// Ahora es un bloque propio: rango, moneda y nota de conversion separados.
function BloqueCosto({ falla, tasa }) {
  const eq = convertirCosto(
    { costo_min: falla.costo_min, costo_max: falla.costo_max, moneda: falla.moneda },
    tasa
  );
  const esEstimado = tasaEsEstimada(tasa);
  const monedaOriginal =
    falla.moneda && falla.moneda.toUpperCase() !== 'MXN' ? falla.moneda.toUpperCase() : 'MXN';

  return (
    <div className="card-section">
      <h4>Costo estimado</h4>
      <p className="cost-amount">
        ${falla.costo_min} – ${falla.costo_max} {monedaOriginal}
      </p>
      {eq && (
        <>
          <p className="cost-amount">
            ${Math.round(eq.min).toLocaleString('es-MX')} –{' '}
            ${Math.round(eq.max).toLocaleString('es-MX')} MXN
          </p>
          <p className="field-hint">
            Tipo de cambio {tasa.usd_mxn} MXN/USD
            {tasa.fecha ? ` (${tasa.fecha})` : ''}
            {tasa.fuente ? ` · fuente: ${tasa.fuente}` : ''}
            {esEstimado ? ' · estimado' : ''}
          </p>
        </>
      )}
      {!eq && tasa?.fuente && falla.moneda === 'usd' && (
        <p className="field-hint">
          Sin tipo de cambio vigente para convertir a MXN ({tasa.fuente})
        </p>
      )}
    </div>
  );
}

function SkeletonResultados() {
  return (
    <div className="skeleton-group" role="status">
      <span className="sr-only">Consultando al motor de inferencia.</span>
      {[0, 1, 2].map((i) => (
        <div className="skeleton-card" key={i} aria-hidden="true">
          <span className="skeleton-line skeleton-line--title" />
          <span className="skeleton-line skeleton-line--short" />
          <span className="skeleton-line" />
          <span className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

export default function Resultados({ resultados, onVolver, onCambiarVehiculo, onGuardar, user, onTicketCreado }) {
  // El guardado ya no es automatico (2.4): el mecanico escribe sus observaciones
  // y pulsa el boton. El estado vive aqui, que es quien las captura.
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState(null);

  if (!resultados) return null;

  const { error, cargando, fallas = [], vehiculo, sintomas, tipo_cambio } = resultados;
  const tasa = tipo_cambio;
  const guardado = Boolean(resultados.guardado);

  const guardar = async () => {
    setGuardando(true);
    setErrorGuardado(null);
    const ok = await onGuardar(observaciones);
    setGuardando(false);
    if (!ok) setErrorGuardado('No se pudo guardar el diagnóstico. Inténtalo de nuevo.');
  };

  return (
    <div className="diagnostico-container">
      {/* Contenedor sin marco: antes era una .info-card que envolvia a otras
          .info-card, y dos superficies anidadas se leen como un nivel de mas. */}
      <section className="results-panel">
        <div className="card-header">
          <div>
            <p className="card-category">
              {vehiculo.marca.toUpperCase()} {vehiculo.modelo.toUpperCase()} ({etiquetaAnio(vehiculo.anio)}) ·{' '}
              {etiquetaTransmision(vehiculo.transmision)}
              {' · '}
              {sintomas.length} {sintomas.length === 1 ? 'síntoma confirmado' : 'síntomas confirmados'}
            </p>
            <h3>{error ? 'Fallo al consultar el motor de Prolog' : 'Posibles fallas detectadas'}</h3>
          </div>
          <div className="card-header-actions">
            <button className="secondary-btn" id="volverCuestionarioBtn" onClick={onVolver}>
              Volver al cuestionario
            </button>
            <button className="secondary-btn" onClick={onCambiarVehiculo}>
              Cambiar vehículo
            </button>
          </div>
        </div>
        <div className="card-body" aria-busy={cargando ? 'true' : 'false'}>
          {error ? (
            <p className="text-danger">{error}</p>
          ) : cargando ? (
            <SkeletonResultados />
          ) : fallas.length === 0 ? (
            <div className="empty-state">
              <h4>Sin fallas aplicables</h4>
              <p>
                No hay una regla del sistema que coincida con este vehículo y estos síntomas. Esto no descarta una falla.
                Revisa que marca, modelo, año y transmisión estén bien escritos, prueba con otros síntomas o consulta a un mecánico.
              </p>
            </div>
          ) : (
            <div className="cards-grid">
              {fallas.map((f) => (
                <article className="info-card" key={f.id}>
                  <div className="card-header">
                    <div>
                      <p className="card-category">Falla inferida</p>
                      <h3>{f.nombre}</h3>
                    </div>
                    <span className={`badge ${urgenciaClase(f.urgencia)}`}>{f.urgencia}</span>
                  </div>
                  <div className="card-body">
                    <BarraCerteza certeza={f.certeza} />
                    <BloqueCosto falla={f} tasa={tasa} />
                    {/* Las causas las declaran las fallas registradas por el
                        usuario; la base estática no las modela, así que llegan
                        vacías y el bloque no se pinta. La comprobar evita dejar
                        un encabezado sin contenido debajo. */}
                    {f.causas?.length > 0 && (
                      <div className="card-section">
                        <h4>Causas probables</h4>
                        <ul className="solutions-list">
                          {f.causas.map((c, i) => (
                            <li key={`${c}-${i}`}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
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
                    <PorQue falla={f} />
                  </div>
                </article>
              ))}
            </div>
          )}

          {resultados.guardado?._id && puedeUsarTickets(user) && (
            <CrearTicket diagnosticoId={resultados.guardado._id} fallas={fallas} onCreado={onTicketCreado} />
          )}
          {!error && !cargando && (
            <div className="card-section">
              <h4>Observaciones</h4>
              <label className="field-hint" htmlFor="observacionesDiagnostico">
                Notas de este diagnóstico (mediciones, pruebas realizadas). Opcional, máximo 500
                caracteres.
              </label>
              <textarea
                id="observacionesDiagnostico"
                className="observaciones-input"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                maxLength={500}
                rows={4}
                disabled={guardando || guardado}
                aria-describedby="observacionesContador"
              />
              <p id="observacionesContador" className="field-hint">
                {observaciones.length}/500 caracteres
              </p>
              {guardado ? (
                <p className="text-success" role="status">
                  Diagnóstico guardado en el historial.
                </p>
              ) : (
                <button
                  className="primary-btn"
                  type="button"
                  onClick={guardar}
                  disabled={guardando}
                >
                  {guardando ? 'Guardando…' : 'Guardar diagnóstico'}
                </button>
              )}
              {errorGuardado && (
                <p className="text-danger" role="alert">
                  {errorGuardado}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
