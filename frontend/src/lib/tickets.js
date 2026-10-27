// Utilidades puras para la sección de Tickets. Sin React, sin fetch.

const CODIGOS_ENVIO = {
  tiempo_agotado: 'El proveedor tardó demasiado en responder.',
  error_red: 'No hubo conexión con el proveedor de correo.',
  sin_proveedor: 'No hay proveedor de correo configurado (modo de pruebas).',
  destinatario_invalido: 'El correo del cliente es inválido.',
  simulado: 'En modo de pruebas solo se entrega a la cuenta registrada.',
  desconocido: 'No se pudo enviar la cotización por un error desconocido.',
};

export function formatearMXN(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatearUSD(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function puedeUsarTickets(user) {
  if (!user) return false;
  if (user.role !== 'administrador_mecanico') return false;
  return user?.features?.tickets === true;
}

export function validarPrecioFinal(valor) {
  if (valor === '' || valor === null || valor === undefined) return false;
  const s = String(valor);
  if (s === '') return false;
  // Solo dígitos con punto y hasta 2 decimales, sin comas
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return false;
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  if (n <= 0) return false;
  if (n > 9999999.99) return false;
  // Evitar notación exponencial rara ya controlada por regex
  return true;
}

export function normalizarPrecioFinal(valor) {
  if (!validarPrecioFinal(valor)) return null;
  const s = String(valor).trim();
  // Devolver como número JSON válido
  const n = Number(s);
  // Redondeo a centavos para evitar flotantes
  const centavos = Math.round(n * 100);
  if (Math.abs(n * 100 - centavos) >= 1e-6) return null;
  return centavos / 100;
}

export function etiquetaEstado(estado) {
  switch (estado) {
    case 'diagnosticado':
      return 'Diagnosticado';
    case 'cotizacion_enviada':
      return 'Cotización enviada';
    case 'autorizado':
      return 'Autorizado';
    case 'rechazado':
      return 'Rechazado';
    case 'vencido':
      return 'Vencido';
    case 'en_reparacion':
      return 'En reparación';
    case 'terminado':
      return 'Terminado';
    case 'cancelado':
      return 'Cancelado';
    default:
      return estado || '';
  }
}

export function etiquetaMotivoRechazo(motivo) {
  switch (motivo) {
    case 'precio_alto':
      return 'Precio alto';
    case 'no_deseo_reparar':
      return 'No deseo reparar';
    case 'dudo_del_diagnostico':
      return 'Dudo del diagnóstico';
    case 'otro':
      return 'Otro';
    default:
      return motivo || '';
  }
}

export function envioPendiente(ticket) {
  if (!ticket) return false;
  return ticket.estado === 'cotizacion_enviada' && ticket.envio?.enviado === false;
}

export function requiereAtencion(ticket) {
  if (!ticket) return false;
  return ticket.estado === 'autorizado' || ticket.estado === 'rechazado' || ticket.estado === 'vencido';
}

export function requiereAtencionPorEstado(estado) {
  return estado === 'autorizado' || estado === 'rechazado' || estado === 'vencido';
}

export function textoCodigoEnvio(codigo) {
  if (!codigo) return '';
  if (CODIGOS_ENVIO[codigo]) return CODIGOS_ENVIO[codigo];
  if (typeof codigo === 'string' && /^proveedor_\d{3}$/.test(codigo)) {
    return `El proveedor rechazó el envío (código ${codigo.replace('proveedor_', '')}).`;
  }
  if (typeof codigo === 'string' && codigo.startsWith('proveedor_')) {
    return `El proveedor rechazó el envío (${codigo}).`;
  }
  return CODIGOS_ENVIO.desconocido;
}

export function formatoPrecioMXN(valor) {
  return formatearMXN(valor);
}

export function formatoPrecioUSD(valor) {
  return formatearUSD(valor);
}

export function cuerpoCrearTicket({ diagnosticoId, fallasIds, cliente }) {
  return {
    diagnosticoId,
    fallasIds: Array.isArray(fallasIds) ? fallasIds : [],
    cliente: cliente || {},
  };
}

export function validarCliente(cliente) {
  const nombre = cliente.nombre.trim();
  const correo = cliente.correo.trim();
  return nombre.length > 0 && nombre.length <= 120 && correo.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) && cliente.telefono.trim().length <= 30;
}

export function precioAnterior(ticket) {
  if (!ticket) return null;
  // Si hay precios[] tomar el último
  const precios = Array.isArray(ticket.precios) ? ticket.precios : [];
  if (precios.length > 0) {
    const ultimo = precios[precios.length - 1];
    if (ultimo && Number.isFinite(Number(ultimo.precioFinalMXN))) {
      return Number(ultimo.precioFinalMXN);
    }
  }
  if (Number.isFinite(Number(ticket.cotizacion?.precioFinalMXN))) {
    return Number(ticket.cotizacion.precioFinalMXN);
  }
  return null;
}
