import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cambiarEstadoTicket, enviarTicket, listarTickets, obtenerTicket } from '../lib/api.js';
import { envioPendiente, etiquetaEstado, etiquetaMotivoRechazo, formatearMXN, requiereAtencion, textoCodigoEnvio, validarPrecioFinal } from '../lib/tickets.js';

const fecha = (valor) => valor ? new Date(valor).toLocaleString('es-MX') : '';

function Detalle({ id, onCerrar }) {
  const queryClient = useQueryClient();
  const [precio, setPrecio] = useState('');
  const [mensaje, setMensaje] = useState('');
  const detalle = useQuery({ queryKey: ['tickets', 'detalle', id], queryFn: ({ signal }) => obtenerTicket(id, signal), staleTime: 0, refetchOnMount: 'always' });
  const ticket = detalle.data;
  const pendiente = envioPendiente(ticket);
  useEffect(() => {
    setPrecio(pendiente && ticket?.cotizacion?.precioFinalMXN != null ? String(ticket.cotizacion.precioFinalMXN) : '');
  }, [id, ticket?.estado, pendiente]);
  const mutation = useMutation({
    mutationFn: (accion) => accion(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });

  async function actuar(accion, esEnvio = false) {
    setMensaje('');
    try {
      await mutation.mutateAsync(accion);
      setMensaje(esEnvio ? 'Cotización enviada.' : 'Estado actualizado.');
    } catch (error) {
      if (error.status === 409) setMensaje('El ticket cambió. Se actualizó el detalle.');
      else if (esEnvio && error.status === 502) {
        const resultado = await detalle.refetch();
        setMensaje(textoCodigoEnvio(resultado.data?.envio?.codigoError) || 'No se pudo enviar la cotización.');
      } else setMensaje('No se pudo completar la acción. Inténtalo de nuevo.');
    }
  }
  if (detalle.isPending) return <p role="status">Cargando detalle…</p>;
  if (detalle.isError || !ticket) return <p role="alert">No se pudo cargar el detalle.</p>;
  const cot = ticket.cotizacion || {};
  const puedeEnviar = ['diagnosticado', 'rechazado', 'vencido'].includes(ticket.estado) || pendiente;
  const anterior = cot.precioFinalMXN;
  const puedeCancelar = !['terminado', 'cancelado'].includes(ticket.estado);
  return <article className="info-card"><div className="card-body">
    <button type="button" className="secondary-btn" onClick={onCerrar} disabled={mutation.isPending}>Volver a la lista</button>
    <h3>Detalle del ticket</h3>
    <p>{etiquetaEstado(ticket.estado)} {pendiente && '· Envío pendiente'}</p>
    <p>{[ticket.vehiculo?.marca, ticket.vehiculo?.modelo, ticket.vehiculo?.anio, ticket.vehiculo?.transmision].filter(Boolean).join(' ')}</p>
    <p style={{ whiteSpace: 'pre-wrap' }}>Cliente: {ticket.cliente?.nombre}</p>
    <p>Correo: {ticket.cliente?.correo}</p>
    {ticket.cliente?.telefono && <p>Teléfono: {ticket.cliente.telefono}</p>}
    <h4>Referencia de catálogo, sin mano de obra</h4>
    <ul>{ticket.fallas?.map((f) => <li key={f.falla} style={{ whiteSpace: 'pre-wrap' }}>{f.nombre}: ${formatearMXN(f.precioMinMXN)} – ${formatearMXN(f.precioMaxMXN)} MXN</li>)}</ul>
    <p>Total: ${formatearMXN(cot.totalMinMXN)} – ${formatearMXN(cot.totalMaxMXN)} MXN</p>
    {cot.tipoCambio && <p>Tipo de cambio: {cot.tipoCambio.usd_mxn} MXN/USD · {cot.tipoCambio.fecha}</p>}
    {anterior != null && <p>Precio final: ${formatearMXN(anterior)} MXN (aprox. ${formatearMXN(cot.precioFinalUSD)} USD)</p>}
    {ticket.envio?.codigoError && <p>{textoCodigoEnvio(ticket.envio.codigoError)}</p>}
    <h4>Historial de precios</h4>
    {ticket.precios?.length ? <ul>{ticket.precios.map((p, i) => <li key={i}>{fecha(p.en)} · ${formatearMXN(p.precioFinalMXN)} MXN</li>)}</ul> : <p>Sin precios enviados.</p>}
    <h4>Decisiones</h4>
    {ticket.decisiones?.length ? <ul>{ticket.decisiones.map((d, i) => <li key={i} style={{ whiteSpace: 'pre-wrap' }}>{fecha(d.en)} · {etiquetaEstado(d.resultado)}{d.motivo && ` · ${etiquetaMotivoRechazo(d.motivo)}`}{d.comentario && ` · ${d.comentario}`}{d.precioFinalMXN != null && ` · $${formatearMXN(d.precioFinalMXN)} MXN`}</li>)}</ul> : <p>Sin decisiones.</p>}
    {puedeEnviar && <form onSubmit={(e) => { e.preventDefault(); if (!validarPrecioFinal(precio)) { setMensaje('Indica un precio válido, mayor que cero y con máximo dos decimales.'); return; } actuar(() => enviarTicket({ ticketId: id, precioFinalMXN: Number(precio) }), true); }}>
      {['rechazado', 'vencido'].includes(ticket.estado) && anterior != null && <p>Precio anterior: ${formatearMXN(anterior)}</p>}
      <label>Precio final MXN <input type="text" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} disabled={mutation.isPending} /></label>
      {validarPrecioFinal(precio) && Number(precio) < cot.totalMinMXN && <p className="field-hint">El precio es menor al mínimo de referencia del catálogo.</p>}
      <button className="primary-btn" type="submit" disabled={mutation.isPending}>{pendiente ? 'Reintentar' : ticket.estado === 'diagnosticado' ? 'Enviar cotización' : 'Reenviar cotización'}</button>
    </form>}
    {ticket.estado === 'autorizado' && <button className="secondary-btn" disabled={mutation.isPending} onClick={() => actuar(() => cambiarEstadoTicket({ ticketId: id, a: 'en_reparacion' }))}>Iniciar reparación</button>}
    {ticket.estado === 'en_reparacion' && <button className="secondary-btn" disabled={mutation.isPending} onClick={() => actuar(() => cambiarEstadoTicket({ ticketId: id, a: 'terminado' }))}>Marcar terminado</button>}
    {puedeCancelar && <button className="secondary-btn" disabled={mutation.isPending} onClick={() => { if (window.confirm('¿Cancelar este ticket?')) actuar(() => cambiarEstadoTicket({ ticketId: id, a: 'cancelado' })); }}>Cancelar ticket</button>}
    <p role="status" aria-live="polite">{mensaje}</p>
  </div></article>;
}

export default function Tickets({ ticketAbiertoId, onAbrir }) {
  const [offset, setOffset] = useState(0);
  const lista = useQuery({ queryKey: ['tickets', 'lista', offset], queryFn: ({ signal }) => listarTickets(offset, signal), staleTime: 0, refetchOnMount: 'always' });
  if (ticketAbiertoId) return <Detalle key={ticketAbiertoId} id={ticketAbiertoId} onCerrar={() => onAbrir(null)} />;
  if (lista.isPending) return <p role="status">Cargando tickets…</p>;
  if (lista.isError) return <p role="alert">No se pudieron cargar los tickets.</p>;
  const { tickets = [], total = 0, limit = 20 } = lista.data;
  return <div className="historial-lista">
    {tickets.length === 0 && <p>No hay tickets.</p>}
    {tickets.map((ticket) => <article className="info-card" key={ticket._id}><div className="card-body">
      <h3>{[ticket.vehiculo?.marca, ticket.vehiculo?.modelo].filter(Boolean).join(' ') || 'Vehículo'}</h3>
      <p>{etiquetaEstado(ticket.estado)} {envioPendiente(ticket) && '· Envío pendiente'}</p>
      {requiereAtencion(ticket) && <p className="text-danger">Requiere atención</p>}
      <button type="button" className="secondary-btn" onClick={() => onAbrir(ticket._id)}>Ver detalle</button>
    </div></article>)}
    <div><button className="secondary-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Anterior</button> <span>{offset + 1}–{Math.min(offset + limit, total)} de {total}</span> <button className="secondary-btn" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Siguiente</button></div>
  </div>;
}
