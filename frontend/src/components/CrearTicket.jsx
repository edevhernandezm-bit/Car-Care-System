import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crearTicket } from '../lib/api.js';
import { cuerpoCrearTicket, erroresCliente } from '../lib/tickets.js';

export default function CrearTicket({ diagnosticoId, fallas, onCreado }) {
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState([]);
  const [cliente, setCliente] = useState({ nombre: '', correo: '', telefono: '' });
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: crearTicket,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tickets'] }),
  });

  async function guardar(e) {
    e.preventDefault();
    const errores = erroresCliente(cliente);
    if (!seleccion.length) errores.unshift('Selecciona al menos una falla.');
    if (errores.length) {
      setError(errores.join(' '));
      return;
    }
    setError('');
    try {
      const datos = Object.fromEntries(Object.entries(cliente).map(([k, v]) => [k, v.trim()]));
      if (!datos.telefono) delete datos.telefono;
      const ticket = await mutation.mutateAsync(cuerpoCrearTicket({ diagnosticoId, fallasIds: seleccion, cliente: datos }));
      onCreado(ticket._id);
    } catch {
      setError('No se pudo crear el ticket. Inténtalo de nuevo.');
    }
  }

  return <div className="card-section">
    {!abierto ? <button type="button" className="primary-btn" onClick={() => setAbierto(true)}>Crear ticket</button> :
      <form onSubmit={guardar}>
        <fieldset className="ticket-formulario" disabled={mutation.isPending}>
          <legend>Selecciona al menos una falla</legend>
          {fallas.map((f) => <label key={f.id} className="ticket-falla">
            <input type="checkbox" checked={seleccion.includes(f.id)} onChange={() => setSeleccion((prev) => prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id])} /> {f.nombre}
          </label>)}
          <div className="form-grid ticket-cliente">
            <label><span>Nombre</span><input value={cliente.nombre} maxLength={120} required onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} /></label>
            <label><span>Correo</span><input type="email" value={cliente.correo} maxLength={254} required onChange={(e) => setCliente({ ...cliente, correo: e.target.value })} /></label>
            <label><span>Teléfono (opcional)</span><input type="tel" value={cliente.telefono} maxLength={30} onChange={(e) => setCliente({ ...cliente, telefono: e.target.value })} /></label>
          </div>
          <div className="form-actions">
            <button className="primary-btn" type="submit">Crear ticket</button>
            <button className="secondary-btn" type="button" onClick={() => setAbierto(false)}>Volver</button>
          </div>
        </fieldset>
        <p className="text-danger" role="alert">{error}</p>
      </form>}
  </div>;
}
