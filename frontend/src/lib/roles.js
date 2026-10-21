// El mapa valor→etiqueta de los roles vive aqui y no repetido en cada pantalla:
// la lista de opciones del formulario y la traduccion de un rol ya guardado son
// las dos caras del mismo dato, y con dos copias una etiqueta nueva se olvidaba
// en la otra.
export const ROLES = [
  { valor: 'administrador_mecanico', etiqueta: 'Administrador / Mecánico' },
  { valor: 'estudiante_mecanica', etiqueta: 'Estudiante de Mecánica' },
];

export const etiquetaRol = (rol) => ROLES.find((r) => r.valor === rol)?.etiqueta ?? rol;
