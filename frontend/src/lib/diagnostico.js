export function etiquetaUrgencia(u) {
  switch (u) {
    case 'critica': return 'Crítica';
    case 'alta': return 'Alta';
    case 'media': return 'Media';
    case 'baja': return 'Baja';
    default: return 'Desconocida';
  }
}

export function urgenciaClase(u) {
  return u === 'Crítica' || u === 'Alta' ? 'high' : u === 'Media' ? 'medium' : 'low';
}

export function mapearProlog(f, catalogoFallas) {
  const base = catalogoFallas.find((x) => x.id === f.id);
  return {
    id: f.id,
    nombre: base ? base.nombre : f.id.replace(/_/g, ' '),
    urgencia: etiquetaUrgencia(f.urgencia || base?.urgencia),
    costo_min: f.costo_min,
    costo_max: f.costo_max,
    reparaciones: f.reparaciones || [],
    certeza: f.certeza,
  };
}
