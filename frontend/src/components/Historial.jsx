import EstadoVacio from './EstadoVacio.jsx';
import { useQuery } from '@tanstack/react-query';
import { useHistorial } from '../hooks/useHistorial.js';
import { obtenerAtencion } from '../lib/api.js';
import { puedeUsarTickets, etiquetaEstado } from '../lib/tickets.js';
import { certezaPorcentaje, etiquetaAnio, etiquetaTransmision } from '../lib/diagnostico.js';

// El nombre de la falla ya viene guardado en el documento; si por lo que sea no
// esta, se cae al id con los guiones bajos cambiados por espacios, igual que en
// el resto de la vista. Nunca se inventa un nombre.
function nombreFalla(falla) {
  return falla.nombre || String(falla.falla).replace(/_/g, ' ');
}

function fechaLegible(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TarjetaDiagnostico({ doc, tickets = [], onAbrirTicket }) {
  const { vehiculo = {}, fallas = [], sintomas = [], observaciones = '' } = doc;
  return (
    <article className="info-card">
      <div className="card-header">
        <div>
          <p className="card-category">{fechaLegible(doc.creado_en)}</p>
          <h3>
            {[vehiculo.marca, vehiculo.modelo].filter(Boolean).join(' ').toUpperCase() ||
              'Vehículo sin datos'}{' '}
            ({etiquetaAnio(vehiculo.anio)})
          </h3>
        </div>
      </div>
      <div className="card-body">
        {tickets.map((ticket) => <p className="text-danger" key={ticket.ticketId}>
          Requiere atención: {etiquetaEstado(ticket.estado)}{' '}
          <button type="button" className="secondary-btn" onClick={() => onAbrirTicket(ticket.ticketId)}>Ver ticket</button>
        </p>)}
        <p className="historial-meta">
          <span>{etiquetaTransmision(vehiculo.transmision)}</span>
          <span>
            {sintomas.length} {sintomas.length === 1 ? 'síntoma' : 'síntomas'} confirmados
          </span>
          <span>
            {fallas.length} {fallas.length === 1 ? 'falla inferida' : 'fallas inferidas'}
          </span>
        </p>

        {fallas.length > 0 && (
          <ul className="historial-fallas">
            {fallas.map((f) => {
              const pct = certezaPorcentaje(f.certeza);
              return (
                <li className="historial-falla" key={f._id || f.falla}>
                  {nombreFalla(f)}
                  {pct !== null ? ` · ${pct}%` : ''}
                </li>
              );
            })}
          </ul>
        )}

        {observaciones.trim() !== '' && (
          <>
            <h4>Observaciones</h4>
            {/* Texto plano, nunca HTML: lo que escribio el mecanico se pinta tal
                cual y se lee como un parrafo, no se interpreta. */}
            <p className="historial-observaciones">{observaciones}</p>
          </>
        )}
      </div>
    </article>
  );
}

export default function Historial({ user, onAbrirTicket }) {
  const { historial, status, error } = useHistorial();
  const atencion = useQuery({ queryKey: ['tickets', 'atencion'], queryFn: ({ signal }) => obtenerAtencion(signal), enabled: puedeUsarTickets(user), staleTime: 0, refetchOnMount: 'always' });

  if (status === 'error') {
    return (
      <div className="info-card">
        <div className="card-body">
          <p className="text-danger" role="alert">
            {error?.message || 'No se pudo consultar el historial'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div className="skeleton-group" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div className="skeleton-card" key={i}>
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line--short" />
          </div>
        ))}
      </div>
    );
  }

  if (historial.length === 0) {
    return (
      <EstadoVacio
        titulo="Todavía no hay diagnósticos guardados"
        causa="Cada análisis que guardes desde el cuestionario aparece aquí, con sus fallas y observaciones."
      />
    );
  }

  return (
    <div className="historial-lista">
      {puedeUsarTickets(user) && atencion.isError && <p role="alert">No se pudo consultar la atención de tickets.</p>}
      {historial.map((doc) => (
        <TarjetaDiagnostico key={doc._id} doc={doc} tickets={puedeUsarTickets(user) ? (atencion.data?.tickets || []).filter((t) => String(t.diagnosticoId) === String(doc._id)) : []} onAbrirTicket={onAbrirTicket} />
      ))}
    </div>
  );
}
