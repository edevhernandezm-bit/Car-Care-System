import { useMemo } from 'react';

import EstadoVacio from './EstadoVacio.jsx';
import { useEstadisticasCerteza } from '../hooks/useEstadisticasCerteza.js';
import { certezaNivel, certezaPorcentaje, etiquetaCerteza } from '../lib/diagnostico.js';
import {
  distribuirPorCerteza,
  filtrarPorBusqueda,
  topFallas,
  unirPorFalla,
} from '../lib/estadisticas.js';

// Cifra grande con su etiqueta. El valor se pasa ya formateado para que el
// componente no tenga que decidir entre "0%" y "sin dato" en cada llamada: en
// un agregado, un 0 de relleno se lee como una medición real.
function Cifra({ valor, etiqueta, nivel }) {
  return (
    <div className="stat-tile">
      <p className="stat-label">{etiqueta}</p>
      <p className={`stat-value ${nivel ? `certainty-value--${nivel}` : ''}`.trim()}>{valor}</p>
    </div>
  );
}

// Un nivel del reparto por certeza. La barra es aria-hidden y el numero va en
// texto, igual que en Resultados: el color solo no es información, y el dato
// que decide si fiarse de un diagnóstico es el conteo.
function BarraNivel({ nivel, etiqueta, fallas, maximo }) {
  const vacio = fallas === 0;
  return (
    <li className="stats-row">
      <span className="stats-row-label">{etiqueta}</span>
      <span className={`certainty-value certainty-value--${nivel}`}>
        {fallas}
        {fallas === 1 ? ' falla' : ' fallas'}
      </span>
      <span className="certainty-track" aria-hidden="true">
        <span
          className={`certainty-fill certainty-fill--${nivel}`}
          style={vacio || maximo === 0 ? undefined : { width: `${(fallas / maximo) * 100}%` }}
        />
      </span>
    </li>
  );
}

// Falla mas frecuente. La barra es proporcional a la mas repetida, no al total:
// comparar cada fila contra el total dejaria todas por debajo del 4% y la
// diferencia entre la primera y la decima seria invisible.
function FilaTop({ fila, maximo }) {
  const pct = certezaPorcentaje(fila.certeza_promedio);
  return (
    <li className="stats-top-row">
      <div className="stats-top-head">
        <span className="stats-top-name">
          {fila.nombre}
          {/* El nombre de arriba puede ser el id des-eslugificado, que es lo
              unico cierto cuando el catalogo no conoce la falla. Sin esta
              marca, esa fila se lee igual que una con nombre propio y el
              conteo parece atribuirle al motor un nombre que no dio. */}
          {!fila.enCatalogo && (
            <span
              className="stats-mark"
              title="El historial guarda un id que el catálogo no conoce: se muestra su id, no un nombre inventado."
            >
              Sin nombre
            </span>
          )}
        </span>
        {fila.urgencia && (
          <span className={`badge ${fila.clase}`}>{fila.urgencia}</span>
        )}
      </div>
      <div className="stats-top-meta">
        <span>
          {fila.veces}
          {fila.veces === 1 ? ' vez' : ' veces'}
        </span>
        <span className={`certainty-value certainty-value--${certezaNivel(fila.certeza_promedio)}`}>
          {pct === null ? etiquetaCerteza(fila.certeza_promedio) : `${etiquetaCerteza(fila.certeza_promedio)} · ${pct}%`}
        </span>
      </div>
      <span className="certainty-track" aria-hidden="true">
        <span
          className="certainty-fill stats-fill"
          style={{ width: `${(fila.veces / maximo) * 100}%` }}
        />
      </span>
    </li>
  );
}

export default function EstadisticasCerteza({ fallasCatalogo, searchQuery, onLimpiarBusqueda }) {
  const { stats, status, error } = useEstadisticasCerteza();

  // unirPorFalla necesita el catalogo para resolver el id a nombre y a urgencia,
  // y sin el las 54 filas se verian como ids crudos. Solo se puede unir cuando
  // llego el catalogo, asi que se espera a que exista antes de sacar el total.
  const datos = useMemo(() => {
    if (!stats || !Array.isArray(fallasCatalogo) || fallasCatalogo.length === 0) return null;
    const filas = unirPorFalla(stats.porFalla, fallasCatalogo);
    const coinciden = filtrarPorBusqueda(filas, searchQuery);
    return {
      filas,
      reparto: distribuirPorCerteza(filas),
      // El filtro va ANTES del recorte a 12. Al revés, una falla que sí coincide
      // con la búsqueda se perdería por no haber entrado en el top, y el usuario
      // vería "ninguna coincidencia" sobre una falla que tiene historial.
      top: topFallas(coinciden),
      // Las consultas y el reparto se cuentan sobre las filas sin filtrar: son
      // del historial completo. Si se calcularan sobre el subconjunto que
      // coincidió con la búsqueda, "certeza media" sería un número que no
      // corresponde a nada guardado.
      ocultas: filas.length - coinciden.length,
    };
  }, [stats, fallasCatalogo, searchQuery]);

  const cargando = status === 'pending' || (status === 'success' && !datos);

  if (status === 'error') {
    return (
      <div className="info-card">
        <div className="card-body">
          <p className="text-danger" role="alert">
            {error?.message || 'No se pudieron consultar las estadísticas'}
          </p>
        </div>
      </div>
    );
  }

  // El catalogo todavia no llego y el endpoint ya respondio: se espera en vez de
  // pintar un total al que luego habria que corregirle los nombres.
  if (cargando) {
    return (
      <div className="skeleton-group" aria-busy="true">
        <div className="skeleton-card">
          <div className="skeleton-line skeleton-line--title" />
          <div className="skeleton-line" />
          <div className="skeleton-line skeleton-line--short" />
        </div>
      </div>
    );
  }

  // Un total de cero consultas no es un error ni un estado vicio de la vista: es
  // el estado real de una base recien creada, y se dice en vez de pintar ceros
  // en cuatro graficos que parecen tablas de resultados vacias.
  if (stats.totalConsultas === 0) {
    return (
      <EstadoVacio
        titulo="Todavía no hay diagnósticos guardados"
        causa="Las estadísticas se llenan solas con cada análisis emitido desde el cuestionario."
      />
    );
  }

  const maxNivel = Math.max(...datos.reparto.map((n) => n.fallas), 1);
  const maxTop = Math.max(...datos.top.filas.map((f) => f.veces), 1);
  const pctPromedio = certezaPorcentaje(stats.certezaPromedio);
  const busquedaVacia = Boolean(searchQuery) && datos.top.filas.length === 0;

  return (
    <div className="stats-container">
      <section className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Historial acumulado</p>
            <h3>Confianza del sistema</h3>
          </div>
        </div>
        <div className="card-body">
          <div className="stats-tiles">
            <Cifra
              valor={stats.totalConsultas}
              etiqueta={stats.totalConsultas === 1 ? 'consulta' : 'consultas'}
            />
            <Cifra
              valor={stats.totalFallas}
              etiqueta={stats.totalFallas === 1 ? 'falla inferida' : 'fallas inferidas'}
            />
            <Cifra
              valor={pctPromedio === null ? etiquetaCerteza(stats.certezaPromedio) : `${pctPromedio}%`}
              etiqueta="certeza media"
              nivel={certezaNivel(stats.certezaPromedio)}
            />
          </div>
        </div>
      </section>

      <section className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Reparto por corte</p>
            <h3>Dónde cae la certeza</h3>
          </div>
        </div>
        <div className="card-body">
          <ul className="stats-list">
            {datos.reparto.map((n) => (
              <BarraNivel
                key={n.nivel}
                nivel={n.nivel}
                etiqueta={n.etiqueta}
                fallas={n.fallas}
                maximo={maxNivel}
              />
            ))}
          </ul>
          <p className="card-note">
            Los cortes son los mismos que usa el motor: alta desde 85%, media desde 60%. «Sin
            dato» son fallas agrupadas sin certeza promedio, no fallas con certeza cero.
          </p>
        </div>
      </section>

      <section className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Fallas más frecuentes</p>
            <h3>
              {datos.top.recortadas
                ? `Las ${datos.top.filas.length} más frecuentes de ${datos.top.total}`
                : 'Fallas más frecuentes'}
            </h3>
          </div>
        </div>
        <div className="card-body">
          {/* La búsqueda solo toca esta tarjeta. Los contadores y el reparto de
              arriba se quedan como están a propósito: cuentan el historial
              completo, y taparlos cuando el filtro no encuentra nada haría
              parecer que se perdió el historial. */}
          {busquedaVacia ? (
            <EstadoVacio
              titulo={`Ninguna falla del historial coincide con "${searchQuery}"`}
              causa="La búsqueda revisa el nombre de la falla y su urgencia, con o sin tildes y con varias palabras a la vez. Las cifras de arriba no cambian: cuentan el historial completo."
              accion={{ etiqueta: 'Limpiar búsqueda', manejar: onLimpiarBusqueda }}
            />
          ) : (
            <>
              <ol className="stats-list stats-list--top">
                {datos.top.filas.map((f) => (
                  <FilaTop key={f.id} fila={f} maximo={maxTop} />
                ))}
              </ol>
              {datos.top.filas.some((f) => !f.enCatalogo) && (
                <p className="card-note">
                  Las filas marcadas «Sin nombre» son ids que el catálogo todavía no conoce: se
                  muestran con su id, con los guiones bajos cambiados por espacios, en vez de
                  inventar un nombre.
                </p>
              )}
            </>
          )}
          {datos.ocultas > 0 && (
            <p className="card-note">
              La búsqueda oculta {datos.ocultas} de las {datos.filas.length} fallas del
              historial. Las cifras de arriba no cambian: cuentan el historial completo.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
