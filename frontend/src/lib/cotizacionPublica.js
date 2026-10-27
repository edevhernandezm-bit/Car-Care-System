export const MOTIVOS_RECHAZO = {
  precio_alto: 'El precio me parece alto',
  no_deseo_reparar: 'No deseo realizar la reparación',
  dudo_del_diagnostico: 'Tengo dudas sobre el diagnóstico',
  otro: 'Otro motivo',
};

export function leerTokenDeHash(hash) {
  return typeof hash === 'string' && /^#[A-Za-z0-9_-]{43}$/.test(hash) ? hash.slice(1) : null;
}

export function normalizarComentario(comentario) {
  return comentario.replace(/\r\n/g, '\n').trim().slice(0, 500) || undefined;
}

export function construirCuerpoDecision(token, decision, motivo, comentario) {
  const cuerpo = { token, decision };
  if (decision === 'rechazar') {
    if (motivo) cuerpo.motivo = motivo;
    const limpio = normalizarComentario(comentario || '');
    if (limpio) cuerpo.comentario = limpio;
  }
  return cuerpo;
}

export function formatoMonto(valor) {
  return Number(valor).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatoVigencia(valor) {
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });
}
