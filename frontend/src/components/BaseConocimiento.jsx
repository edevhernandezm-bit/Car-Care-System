import { useQuery } from '@tanstack/react-query';
import { obtenerTipoCambio } from '../lib/api.js';
import EstadoVacio from './EstadoVacio.jsx';
import {
  claseConfianzaDato,
  coincide,
  convertirCosto,
  etiquetaConfianzaDato,
  etiquetaUrgencia,
  LEYENDA_CONFIANZA,
  procedenciaFalla,
  tasaEsEstimada,
  urgenciaClase,
} from '../lib/diagnostico.js';

export default function BaseConocimiento({ fallasCatalogo, searchQuery, onLimpiarBusqueda }) {
  const { data: tasaVigente } = useQuery({
    queryKey: ['tipoCambio'],
    queryFn: obtenerTipoCambio,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
  const filtradas = fallasCatalogo.filter((f) =>
    coincide(`${f.nombre} ${etiquetaUrgencia(f.urgencia)}`, searchQuery)
  );

  if (filtradas.length === 0) {
    return (
      <EstadoVacio
        titulo={
          searchQuery
            ? `Ninguna falla coincide con "${searchQuery}"`
            : 'La base de conocimiento está vacía'
        }
        causa={
          searchQuery
            ? 'La búsqueda revisa el nombre de la falla y su urgencia, con o sin tildes y con varias palabras a la vez. Prueba con "cvt" o "alternador".'
            : 'No hay fallas registradas. Levanta el servidor de Prolog para cargar el catálogo.'
        }
        accion={
          searchQuery
            ? { etiqueta: 'Limpiar búsqueda', manejar: onLimpiarBusqueda }
            : undefined
        }
      />
    );
  }

  // Lo que dice cada chip se cuenta sobre el catalogo que llego, no sobre una
  // constante escrita a mano: si el motor agrega una falla con `baja` o cambia
  // una fuente, el numero de la leyenda sigue siendo el cierto.
  const procedencia = fallasCatalogo.map((f) => procedenciaFalla(f).confianza);
  const sinFuente = procedencia.filter((c) => !c).length;

  return (
    <>
      <section className="info-card confianza-leyenda">
        <div className="card-body">
          <p className="card-category">Cómo leer esta sección</p>
          <h3 className="confianza-leyenda-titulo">Procedencia de cada falla</h3>
          <p className="text-muted">
            La procedencia dice cuánto pesa la investigación que respalda la falla. No es la
            certeza del diagnóstico: esa depende de los síntomas que confirmes y la calcula el
            motor.
          </p>
          <dl className="confianza-leyenda-lista">
            {LEYENDA_CONFIANZA.map((n) => (
              <div className="confianza-leyenda-fila" key={n.etiqueta}>
                <dt>
                  <span className={`confianza-chip ${claseConfianzaDato(n.confianza)}`}>
                    {n.etiqueta}
                  </span>
                </dt>
                <dd>
                  {n.detalle}
                  <span className="confianza-leyenda-conteo">
                    {n.confianza
                      ? `${procedencia.filter((c) => c === n.confianza).length} fallas`
                      : `${sinFuente} fallas`}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <div className="knowledge-grid">
      {filtradas.map((f) => {
        const urgencia = etiquetaUrgencia(f.urgencia);
        const proc = procedenciaFalla(f);
        return (
          <article className="info-card common-falla-card" key={f.id}>
            <div className="card-header">
              <div>
                <p className="card-category">Falla</p>
                <h3>{f.nombre}</h3>
              </div>
              <span className={`badge ${urgenciaClase(urgencia)}`}>{urgencia}</span>
            </div>
            <div className="card-body">
              <div className="card-section">
                <h4>Causas/Pasos</h4>
                <ul>
                  {(f.reparaciones || ['Sin datos']).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              {/* Procedencia del dato. Es un eje distinto de la certeza del
                  diagnostico: en el catalogo no hay sintomas que el usuario haya
                  confirmado, asi que se declara el peso de la investigacion.

                  El bloque se pinta siempre, sin condicion: 20 de las 54 fallas
                  vienen de la base original, sin una fuente de investigacion
                  formal. Antes se ocultaban tras `proc.confianza &&`, y esas
                  20 no mostraban nada, que es justo lo que la leyenda de arriba
                  tiene que explicar. */}
              <details className="why why--source">
                <summary className="why-summary">
                  Procedencia del dato
                  <span className={`confianza-chip ${claseConfianzaDato(proc.confianza)}`}>
                    {etiquetaConfianzaDato(proc.confianza)}
                  </span>
                </summary>
                <div className="why-body">
                  {proc.hayFuente ? (
                    <p className="why-note">{proc.fuente}</p>
                  ) : (
                    <p className="why-note">
                      Proviene de la base original del sistema: información obtenida de foros de
                      mecánica como iFixit, y de referencias técnicas como los manuales Chilton y
                      Haynes o los códigos de diagnóstico OBD-II. La falla es válida, pero no está
                      respaldada por una investigación formal.
                    </p>
                  )}
                </div>
              </details>
              <div className="card-footer">
                <span>Costo</span>
                <strong>
                  {(() => {
                    const eq = convertirCosto(
                      { costo_min: f.costo_min, costo_max: f.costo_max, moneda: f.moneda },
                      tasaVigente
                    );
                    const esEstimado = tasaEsEstimada(tasaVigente);
                    if (eq) {
                      return (
                        <>
                          ${Math.round(eq.min).toLocaleString('es-MX')} - ${Math.round(eq.max).toLocaleString('es-MX')} MXN
                          <span className="field-hint">
                            ({f.costo_min} - {f.costo_max} {f.moneda?.toUpperCase?.()})
                            {tasaVigente?.fecha ? ` · TC ${tasaVigente.usd_mxn} (${tasaVigente.fecha})` : ''}
                            {esEstimado ? ' · estimado' : ''}
                          </span>
                        </>
                      );
                    }
                    return (
                      <>
                        ${f.costo_min} - ${f.costo_max} {f.moneda && f.moneda.toUpperCase() !== 'MXN' ? f.moneda.toUpperCase() : 'MXN'}
                      </>
                    );
                  })()}
                </strong>
              </div>
            </div>
          </article>
        );
      })}
      </div>
    </>
  );
}
