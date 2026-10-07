import { useRef, useState } from 'react';

import { coincide } from '../lib/diagnostico.js';
import {
  ANIO_MAXIMO,
  CONFIANZAS,
  slugPrologId,
  TRANSMISIONES,
  URGENCIAS,
} from '../lib/fallas.js';

// Un solo formulario para el alta y para la edicion. Duplicarlo hacia que las
// dos versiones dejaran de coincidir es como aparecio el bug de validar solo el
// cuerpo del PUT: el alta acepta, la edicion no.

// Campo con error enlazado por aria-describedby, como en Paso1Vehiculo: el
// texto vive junto al control y el resumen de arriba lleva el foco tras un
// envio fallido.
function Campo({ id, etiqueta, error, ayuda, children }) {
  return (
    <label htmlFor={id}>
      <span>{etiqueta}</span>
      {children}
      {ayuda && (
        <small className="field-hint" id={`${id}-ayuda`}>
          {ayuda}
        </small>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </label>
  );
}

function descritaPor(id, error, conAyuda) {
  const ids = [];
  if (conAyuda) ids.push(`${id}-ayuda`);
  if (error) ids.push(`${id}-error`);
  return ids.length ? ids.join(' ') : undefined;
}

// Lista de lineas de texto (causas, procedimiento). Se edita como textarea con
// una linea por entrada, no como un input por fila: agregar un paso no debe
// empujar el resto del formulario, y con teclado el textarea es un control
// conocido en lugar de un boton que hay que aprender a usar.
function ListaDeLineas({ id, etiqueta, error, ayuda, lineas, placeholder, onChange }) {
  return (
    <Campo id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <textarea
        id={id}
        rows={4}
        placeholder={placeholder}
        value={lineas.join('\n')}
        aria-describedby={descritaPor(id, error, Boolean(ayuda))}
        aria-invalid={error ? 'true' : undefined}
        onChange={(e) => onChange(e.target.value.split('\n'))}
      />
    </Campo>
  );
}

export default function FallaForm({
  valor,
  errores,
  sintomasCatalogo,
  enviado,
  onCambio,
  onEnviar,
  onCancelar,
  textoEnviar,
}) {
  const [sintomaNuevo, setSintomaNuevo] = useState('');
  const [filtroSintomas, setFiltroSintomas] = useState('');
  const resumenRef = useRef(null);

  // Tras un envio fallido el foco va al resumen: quien navega con teclado tiene
  // que enterarse del error sin recorrer los campos buscandolo (WCAG 3.3.1).
  if (enviado && Object.keys(errores).length > 0) {
    if (resumenRef.current && document.activeElement !== resumenRef.current) {
      resumenRef.current.focus();
    }
  }

// Los sintomas que no estan en el catalogo son los que el administrador
  // escribio. Se muestran aparte y sin checkbox: si no, al editar la falla un
  // sintoma propio aparecia marcado como si fuera del catalogo, y desmarcar esa
  // casilla lo borraba de verdad.
  const sintomasMarcados = new Set(valor.sintomas);
  const delCatalogo = (sintomasCatalogo || []).filter((s) => !sintomasMarcados.has(s.nombre));
  const propios = valor.sintomas.filter(
    (s) => !(sintomasCatalogo || []).some((c) => c.nombre === s)
  );
  const filtrados = filtroSintomas
    ? delCatalogo.filter((s) => coincide(`${s.nombre} ${s.categoria}`, filtroSintomas))
    : delCatalogo;

  function alternar(nombre, marcado) {
    onCambio({
      ...valor,
      sintomas: marcado
        ? [...valor.sintomas, nombre]
        : valor.sintomas.filter((s) => s !== nombre),
    });
  }

  function agregarSintomaPropio() {
    const nombre = sintomaNuevo.trim();
    if (!nombre) return;
    if (valor.sintomas.includes(nombre)) {
      setSintomaNuevo('');
      return;
    }
    alternar(nombre, true);
    setSintomaNuevo('');
  }

  return (
    <form onSubmit={onEnviar} noValidate>
      {enviado && Object.keys(errores).length > 0 && (
        <div className="error-summary" role="alert" tabIndex={-1} ref={resumenRef}>
          <p className="error-summary-title">Hay un problema con el formulario</p>
          <ul>
            {Object.entries(errores).map(([campo, texto]) => (
              <li key={campo}>
                <a
                  href={`#${campo}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(campo)?.focus();
                  }}
                >
                  {texto}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="form-grid form-grid--vehicle form-grid--flush">
        <Campo id="nombre" etiqueta="Nombre de la falla" error={errores.nombre}>
          <input
            id="nombre"
            value={valor.nombre}
            aria-describedby={descritaPor('nombre', errores.nombre, false)}
            aria-invalid={errores.nombre ? 'true' : undefined}
            onChange={(e) => onCambio({ ...valor, nombre: e.target.value })}
            placeholder="Fuga de aceite en el diferencial"
          />
        </Campo>

        <div className="admin-sintomas">
          <p className="admin-field-label" id="sintomas-etiqueta">
            Síntomas
          </p>
          <p className="field-hint" id="sintomas-ayuda">
            Marca los del catálogo que correspondan. Un síntoma que no existe todavía se escribe
            abajo: queda registrado con la falla y el motor lo reconoce.
          </p>

          <label htmlFor="filtroSintomasAdmin" className="sr-only">
            Filtrar síntomas del catálogo
          </label>
          <input
            id="filtroSintomasAdmin"
            type="search"
            value={filtroSintomas}
            placeholder="Filtrar síntomas del catálogo..."
            onChange={(e) => setFiltroSintomas(e.target.value)}
          />

          <div className="sintomas-checklist admin-sintomas-lista">
            {filtrados.length === 0 ? (
              <p className="text-muted">
                {filtroSintomas
                  ? 'Ningún síntoma del catálogo coincide con el filtro.'
                  : 'No hay síntomas en el catálogo: escribe los que apliquen abajo.'}
              </p>
            ) : (
              filtrados.map((s) => (
                <label className="checkbox-item" key={s.id ?? s.nombre}>
                  <input
                    type="checkbox"
                    checked={sintomasMarcados.has(s.nombre)}
                    onChange={(e) => alternar(s.nombre, e.target.checked)}
                  />
                  <span>{s.nombre}</span>
                </label>
              ))
            )}
          </div>

          {propios.length > 0 && (
            <>
              <p className="admin-field-label">Síntomas añadidos a esta falla</p>
              <ul className="admin-propios">
                {propios.map((s) => (
                  <li key={s}>
                    <span>{s}</span>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => alternar(s, false)}
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="admin-sintoma-nuevo">
            <label htmlFor="sintomaNuevo">
              <span>Añadir síntoma nuevo</span>
              <input
                id="sintomaNuevo"
                value={sintomaNuevo}
                onChange={(e) => setSintomaNuevo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Sin preventDefault el Enter dentro del formulario envia la
                    // falla entera en vez de añadir el síntoma.
                    e.preventDefault();
                    agregarSintomaPropio();
                  }
                }}
                placeholder="Vibración al frenar"
              />
            </label>
            <button type="button" className="secondary-btn" onClick={agregarSintomaPropio}>
              Añadir
            </button>
          </div>

          {errores.sintomas && (
            <p className="field-error" id="sintomas-error">
              {errores.sintomas}
            </p>
          )}
        </div>

        <ListaDeLineas
          id="causas"
          etiqueta="Causas posibles (una por línea)"
          error={errores.causas}
          ayuda="Cada línea es una causa alternativa. El diagnóstico las muestra como hipótesis."
          lineas={valor.causas}
          placeholder={'Sello de diferencial seco\nNivel de aceite bajo'}
          onChange={(causas) => onCambio({ ...valor, causas })}
        />

        <ListaDeLineas
          id="procedimiento"
          etiqueta="Procedimiento (un paso por línea)"
          error={errores.procedimiento}
          ayuda="El orden importa: es la secuencia que se le da a quien atiende el vehículo."
          lineas={valor.procedimiento}
          placeholder={'Revisar nivel de aceite\nSustituir sello\nVerificar fugas'}
          onChange={(procedimiento) => onCambio({ ...valor, procedimiento })}
        />

        <Campo
          id="solucion"
          etiqueta="Solución recomendada"
          ayuda="Una frase con el resultado esperado de aplicar el procedimiento."
        >
          <textarea
            id="solucion"
            rows={2}
            value={valor.solucion}
            aria-describedby={descritaPor('solucion', null, true)}
            onChange={(e) => onCambio({ ...valor, solucion: e.target.value })}
            placeholder="Dejar el diferencial sin pérdida de aceite."
          />
        </Campo>

        <Campo id="marca" etiqueta="Marca" error={errores.marca}>
          <input
            id="marca"
            value={valor.vehiculo.marca}
            onChange={(e) =>
              onCambio({ ...valor, vehiculo: { ...valor.vehiculo, marca: e.target.value } })
            }
            placeholder="nissan"
          />
        </Campo>

        <Campo id="modelo" etiqueta="Modelo" error={errores.modelo}>
          <input
            id="modelo"
            value={valor.vehiculo.modelo}
            onChange={(e) =>
              onCambio({ ...valor, vehiculo: { ...valor.vehiculo, modelo: e.target.value } })
            }
            placeholder="sentra"
          />
        </Campo>

        {/* El año va como rango porque así lo declara la base de conocimiento:
            las fallas por vehículo usan `Anio >= Min, Anio =< Max`. La leyenda
            dice explícitamente qué hacer cuando no se conoce el rango, porque
            la respuesta obvia ("pongo mi año") es justo la que deja la falla
            dormida si se rellenan mal. */}
        <Campo
          id="anioDesde"
          etiqueta="Año desde"
          error={errores.anioDesde}
          ayuda="Rango de años del vehículo. Si no conoces el rango, escribe el mismo año en los dos campos."
        >
          <input
            id="anioDesde"
            type="number"
            min="0"
            max={ANIO_MAXIMO}
            value={valor.vehiculo.anioDesde === 0 ? '' : valor.vehiculo.anioDesde}
            aria-describedby={descritaPor('anioDesde', errores.anioDesde, true)}
            aria-invalid={errores.anioDesde ? 'true' : undefined}
            onChange={(e) =>
              onCambio({
                ...valor,
                vehiculo: { ...valor.vehiculo, anioDesde: Number(e.target.value || 0) },
              })
            }
            placeholder="2010"
          />
        </Campo>

        <Campo
          id="anioHasta"
          etiqueta="Año hasta"
          error={errores.anioHasta}
          ayuda="Vacío o 0 = la falla aplica a cualquier año."
        >
          <input
            id="anioHasta"
            type="number"
            min="0"
            max={ANIO_MAXIMO}
            value={valor.vehiculo.anioHasta === 0 ? '' : valor.vehiculo.anioHasta}
            aria-describedby={descritaPor('anioHasta', errores.anioHasta, true)}
            aria-invalid={errores.anioHasta ? 'true' : undefined}
            onChange={(e) =>
              onCambio({
                ...valor,
                vehiculo: { ...valor.vehiculo, anioHasta: Number(e.target.value || 0) },
              })
            }
            placeholder="2015"
          />
        </Campo>

        <Campo
          id="transmision"
          etiqueta="Transmisión"
          ayuda="'No lo sé' = aplica a cualquier transmisión."
        >
          <select
            id="transmision"
            value={valor.vehiculo.transmision || 'desconocida'}
            aria-describedby={descritaPor('transmision', null, true)}
            onChange={(e) =>
              onCambio({
                ...valor,
                vehiculo: { ...valor.vehiculo, transmision: e.target.value },
              })
            }
          >
            {TRANSMISIONES.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          id="precioMin"
          etiqueta="Precio mínimo (MXN)"
          error={errores.precioMin}
          ayuda="Extremo inferior del rango estimado."
        >
          <input
            id="precioMin"
            type="number"
            min="0"
            value={valor.precioMin}
            aria-describedby={descritaPor('precioMin', errores.precioMin, true)}
            aria-invalid={errores.precioMin ? 'true' : undefined}
            onChange={(e) => onCambio({ ...valor, precioMin: e.target.value })}
            placeholder="1800"
          />
        </Campo>

        <Campo
          id="precioMax"
          etiqueta="Precio máximo (MXN)"
          error={errores.precioMax}
          ayuda="Extremo superior del rango estimado."
        >
          <input
            id="precioMax"
            type="number"
            min="0"
            value={valor.precioMax}
            aria-describedby={descritaPor('precioMax', errores.precioMax, true)}
            aria-invalid={errores.precioMax ? 'true' : undefined}
            onChange={(e) => onCambio({ ...valor, precioMax: e.target.value })}
            placeholder="4500"
          />
        </Campo>

        <Campo id="urgencia" etiqueta="Urgencia">
          <select
            id="urgencia"
            value={valor.urgencia}
            onChange={(e) => onCambio({ ...valor, urgencia: e.target.value })}
          >
            {URGENCIAS.map((u) => (
              <option key={u.valor} value={u.valor}>
                {u.etiqueta}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          id="confianzaDato"
          etiqueta="Confianza del dato"
          ayuda="Qué tan segura está la información registrada. Se muestra junto al diagnóstico."
        >
          <select
            id="confianzaDato"
            value={valor.confianzaDato}
            aria-describedby={descritaPor('confianzaDato', null, true)}
            onChange={(e) => onCambio({ ...valor, confianzaDato: e.target.value })}
          >
            {CONFIANZAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          id="certezaBase"
          etiqueta="Certeza base (0 a 1)"
          ayuda="Con qué certeza entra esta falla al motor antes de combinarla con los síntomas."
        >
          <input
            id="certezaBase"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={valor.certezaBase}
            aria-describedby={descritaPor('certezaBase', null, true)}
            onChange={(e) => onCambio({ ...valor, certezaBase: e.target.value })}
          />
        </Campo>
      </div>

      {/* El identificador se muestra, no se edita: lo deriva el backend del
          nombre y es con el que la falla vive en Prolog. Mostrarlo evita el
          "no encuentro mi falla en el motor" sin abrir una segunda via para
          escribirlo mal. */}
      {slugPrologId(valor.nombre) && (
        <p className="admin-prologid">
          Identificador en el motor: <code>{slugPrologId(valor.nombre)}</code>
        </p>
      )}

      <div className="form-actions form-actions--start">
        <button className="primary-btn" type="submit">
          {textoEnviar}
        </button>
        {onCancelar && (
          <button type="button" className="secondary-btn" onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}