import { useEffect, useRef, useState } from 'react';
import { consultarCotizacionPublica, decidirCotizacionPublica } from '../lib/api.js';
import { construirCuerpoDecision, formatoMonto, formatoVigencia, leerTokenDeHash, MOTIVOS_RECHAZO } from '../lib/cotizacionPublica.js';

const MENSAJES = {
  invalido: 'Enlace no válido o vencido',
  limite: 'Demasiados intentos. Inténtalo más tarde.',
  datos: 'Revisa tu respuesta e inténtalo de nuevo',
  red: 'No se pudo conectar. Inténtalo de nuevo.',
};

export default function CotizacionPublica({ hashInicial }) {
  const token = useRef(leerTokenDeHash(hashInicial));
  const [cotizacion, setCotizacion] = useState(null);
  const [estado, setEstado] = useState(token.current ? 'cargando' : 'invalido');
  const [error, setError] = useState('');
  const [alDecidir, setAlDecidir] = useState(false);
  const [decision, setDecision] = useState('');
  const [motivo, setMotivo] = useState('');
  const [comentario, setComentario] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [intento, setIntento] = useState(0);
  const errorRef = useRef(null);
  const enviandoRef = useRef(false);

  useEffect(() => {
    const tituloAnterior = document.title;
    document.title = 'Cotización | Car Care System';
    const metas = [['robots', 'noindex, nofollow'], ['referrer', 'no-referrer']].map(([name, content]) => {
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
      return meta;
    });
    window.history.replaceState(null, '', window.location.pathname);
    return () => { metas.forEach((meta) => meta.remove()); document.title = tituloAnterior; };
  }, []);

  useEffect(() => {
    if (!token.current) return undefined;
    const controller = new AbortController();
    consultarCotizacionPublica(token.current, controller.signal).then((resultado) => {
      if (controller.signal.aborted) return;
      if (resultado.tipo === 'ok') { setCotizacion(resultado.datos); setEstado('lista'); }
      else setEstado(resultado.tipo);
    });
    return () => controller.abort();
  }, [intento]);

  useEffect(() => {
    if (error || ['invalido', 'limite', 'datos', 'red'].includes(estado)) errorRef.current?.focus();
  }, [error, estado]);

  async function enviar(evento) {
    evento.preventDefault();
    if (!decision || enviandoRef.current) return;
    enviandoRef.current = true;
    setOcupado(true);
    setError('');
    const resultado = await decidirCotizacionPublica(construirCuerpoDecision(token.current, decision, motivo, comentario));
    enviandoRef.current = false;
    setOcupado(false);
    if (resultado.tipo === 'ok' && ['autorizado', 'rechazado'].includes(resultado.datos?.estado)) {
      setCotizacion(null);
      token.current = null;
      setEstado(resultado.datos.estado);
    } else if (resultado.tipo === 'invalido') {
      setCotizacion(null);
      token.current = null;
      setAlDecidir(true);
      setEstado('invalido');
    } else setError(MENSAJES[resultado.tipo] || MENSAJES.red);
  }

  function reintentarConsulta() {
    setEstado('cargando');
    setIntento((n) => n + 1);
  }

  return <main className="cotizacion-publica">
    <article className="info-card"><div className="card-body">
      <header><p className="card-category">Car Care System</p><h1>Cotización de reparación</h1></header>
      {estado === 'cargando' && <p role="status">Consultando cotización…</p>}
      {['invalido', 'limite', 'datos', 'red'].includes(estado) && <div role="alert" tabIndex={-1} ref={errorRef}>
        <p className="text-danger">{MENSAJES[estado]}</p>
        {estado === 'invalido' && alDecidir && <p>Si ya respondiste, tu respuesta pudo haberse registrado</p>}
        {estado !== 'invalido' && <button className="secondary-btn" type="button" onClick={reintentarConsulta}>Reintentar</button>}
      </div>}
      {estado === 'autorizado' && <p role="status">Tu autorización quedó registrada. El taller se pondrá en contacto contigo.</p>}
      {estado === 'rechazado' && <p role="status">Tu respuesta quedó registrada.</p>}
      {estado === 'lista' && cotizacion && <>
        <p style={{ whiteSpace: 'pre-wrap' }}>Hola {cotizacion.cliente?.nombre}, revisa la propuesta para tu vehículo.</p>
        <section><h2>Vehículo</h2><p style={{ whiteSpace: 'pre-wrap' }}>{[cotizacion.vehiculo?.marca, cotizacion.vehiculo?.modelo, cotizacion.vehiculo?.anio].filter(Boolean).join(' ')}</p>
          <h2>Fallas</h2><ul>{cotizacion.fallas?.map((falla, i) => <li key={`${falla}-${i}`} style={{ whiteSpace: 'pre-wrap' }}>{falla}</li>)}</ul>
        </section>
        <section className="cotizacion-precio"><h2>Precio final</h2><p className="cotizacion-monto">${formatoMonto(cotizacion.precioFinalMXN)} <small>MXN</small></p>
          <p>aprox. ${formatoMonto(cotizacion.precioFinalUSD)} USD</p>
          <p>{cotizacion.leyendaUSD}</p><p>{cotizacion.leyenda}</p>
          <p>Conversión {cotizacion.tasaEstimada ? 'estimada' : ''}: {cotizacion.tipoCambio?.fecha} · {cotizacion.tipoCambio?.fuente}</p>
          <p>Vigente hasta: {formatoVigencia(cotizacion.vigenteHasta)}</p>
        </section>
        <form onSubmit={enviar} className="card-body">
          <fieldset disabled={ocupado} className="cotizacion-opciones"><legend>Tu respuesta</legend>
            <label><input type="radio" name="decision" value="autorizar" checked={decision === 'autorizar'} onChange={(e) => setDecision(e.target.value)} /> Autorizo la reparación</label>
            <label><input type="radio" name="decision" value="rechazar" checked={decision === 'rechazar'} onChange={(e) => setDecision(e.target.value)} /> Rechazo la reparación</label>
            {decision === 'rechazar' && <>
              <div className="form-group input-group"><label className="form-group-label" htmlFor="motivo">Motivo (opcional)</label>
                <select id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}><option value="">Selecciona un motivo</option>{Object.entries(MOTIVOS_RECHAZO).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}</select>
              </div>
              <div className="form-group"><label className="form-group-label" htmlFor="comentario">Comentario (opcional)</label>
                <textarea id="comentario" className="observaciones-input" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={500} rows={4} aria-describedby="contador-comentario" />
                <p id="contador-comentario" className="field-hint" aria-live="polite">{comentario.length}/500 caracteres</p>
              </div>
            </>}
          </fieldset>
          {error && <p ref={errorRef} role="alert" tabIndex={-1} className="text-danger">{error}</p>}
          <button className="primary-btn" type="submit" disabled={!decision || ocupado}>{ocupado ? 'Enviando…' : 'Enviar respuesta'}</button>
        </form>
      </>}
    </div></article>
  </main>;
}
