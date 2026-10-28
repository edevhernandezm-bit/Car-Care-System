#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { certezaNivel } from '../frontend/src/lib/diagnostico.js';

const ADVERTENCIA = 'La certeza es un factor heurístico de tipo MYCIN, no una probabilidad ni una medida de exactitud.';
const REGLAS = 'Urgencia: minúsculas y espacios recortados y consecutivos unificados. Marca y modelo: además se eliminan tildes.';

export function media(valores) {
  return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
}

export function desviacionMuestral(valores) {
  if (valores.length < 2) return null;
  const promedio = media(valores);
  return Math.sqrt(valores.reduce((suma, valor) => suma + (valor - promedio) ** 2, 0) / (valores.length - 1));
}

export function normalizar(valor, quitarTildes = false) {
  const texto = String(valor ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
  return quitarTildes ? texto.normalize('NFD').replace(/\p{M}/gu, '') : texto;
}

export function validarCorte(corte) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/i.exec(corte || '');
  if (!m) throw new Error('--corte requiere fecha ISO completa con zona horaria explícita.');
  const [, ano, mes, dia, hora, minuto, segundo, zona] = m;
  const dias = new Date(Date.UTC(Number(ano), Number(mes), 0)).getUTCDate();
  if (+mes < 1 || +mes > 12 || +dia < 1 || +dia > dias || +hora > 23 || +minuto > 59 || +segundo > 59 || (zona !== 'Z' && zona !== 'z' && (+zona.slice(1, 3) > 23 || +zona.slice(4, 6) > 59)) || !Number.isFinite(Date.parse(corte))) {
    throw new Error('--corte no es una fecha ISO válida.');
  }
  return new Date(corte);
}

function contar(valores) {
  const mapa = new Map();
  for (const valor of valores) mapa.set(valor, (mapa.get(valor) || 0) + 1);
  return [...mapa].map(([valor, cantidad]) => ({ valor, cantidad })).sort((a, b) => b.cantidad - a.cantidad || a.valor.localeCompare(b.valor));
}

export function calcularGrupo(diagnosticos) {
  const fallas = diagnosticos.flatMap((d) => d.fallas);
  const certezas = fallas.map((f) => f.certeza);
  const orden = [...certezas].sort((a, b) => a - b);
  const centro = Math.floor(orden.length / 2);
  const bandas = Object.fromEntries(['alta', 'media', 'baja'].map((b) => {
    const cantidad = certezas.filter((c) => certezaNivel(c) === b).length;
    return [b, { cantidad, porcentaje: certezas.length ? cantidad * 100 / certezas.length : null }];
  }));
  const porDiagnostico = diagnosticos.map((d) => d.fallas.length);
  const observaciones = diagnosticos.map((d) => (d.observaciones || '').trim().length);
  const conObservacion = observaciones.filter((longitud) => longitud > 0);
  const frecuencias = contar(fallas.map((f) => f.falla));
  return {
    diagnosticos: diagnosticos.length, fallas_inferidas: fallas.length,
    certeza: { media: media(certezas), mediana: orden.length ? (orden.length % 2 ? orden[centro] : (orden[centro - 1] + orden[centro]) / 2) : null, desviacion_muestral: desviacionMuestral(certezas), minimo: orden.length ? orden[0] : null, maximo: orden.length ? orden.at(-1) : null },
    bandas, fallas_distintas: frecuencias.length, fallas_mas_frecuentes: frecuencias.slice(0, 10),
    marcas: contar(diagnosticos.map((d) => normalizar(d.vehiculo?.marca, true) || 'sin dato')),
    urgencias: contar(fallas.map((f) => normalizar(f.urgencia) || 'sin dato')),
    fallas_por_diagnostico: { media: media(porDiagnostico), minimo: porDiagnostico.length ? Math.min(...porDiagnostico) : null, maximo: porDiagnostico.length ? Math.max(...porDiagnostico) : null },
    observaciones: { cantidad: conObservacion.length, porcentaje: diagnosticos.length ? conObservacion.length * 100 / diagnosticos.length : null, longitud_media: media(conObservacion) },
  };
}

export function variantes(diagnosticos) {
  const campos = { marca: new Map(), modelo: new Map(), urgencia: new Map() };
  const agregar = (campo, valor, quitarTildes) => {
    if (typeof valor !== 'string' || !valor.trim()) return;
    const clave = normalizar(valor, quitarTildes);
    if (!campos[campo].has(clave)) campos[campo].set(clave, new Set());
    campos[campo].get(clave).add(valor);
  };
  for (const d of diagnosticos) {
    agregar('marca', d.vehiculo?.marca, true);
    agregar('modelo', d.vehiculo?.modelo, true);
    for (const f of d.fallas) agregar('urgencia', f.urgencia, false);
  }
  return Object.fromEntries(Object.entries(campos).map(([campo, mapa]) => [campo, [...mapa].filter(([, valores]) => valores.size > 1).map(([normalizado, valores]) => ({ normalizado, variantes: [...valores].sort() })).sort((a, b) => a.normalizado.localeCompare(b.normalizado))]));
}

function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.keys(valor).sort().map((clave) => [clave, canonico(valor[clave])]));
  return valor;
}

export function hashCorte(diagnosticos) {
  const datos = diagnosticos.map((d) => {
    const { observaciones, ...resto } = d;
    return { ...resto, longitud_observaciones: typeof observaciones === 'string' ? observaciones.length : 0 };
  }).sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(canonico(datos))).digest('hex');
}

export function prepararDiagnosticos(datos, corte) {
  if (!Array.isArray(datos)) throw new Error('La API no devolvió una lista de diagnósticos.');
  return datos.filter((d) => {
    if (!d || typeof d._id !== 'string' || !Number.isFinite(Date.parse(d.creado_en)) || !Array.isArray(d.fallas) || !['usuario', 'semilla'].includes(d.origen) || (d.observaciones != null && typeof d.observaciones !== 'string')) throw new Error('La API devolvió un diagnóstico inválido.');
    if (d.fallas.some((f) => !f || typeof f.falla !== 'string' || typeof f.certeza !== 'number' || !Number.isFinite(f.certeza) || f.certeza < 0 || f.certeza > 1)) throw new Error('La API devolvió una falla inválida.');
    return Date.parse(d.creado_en) <= corte.getTime();
  });
}

function tabla(titulo, filas) {
  const escapar = (valor) => String(valor ?? 'Sin datos').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  return `### ${titulo}\n\n| Concepto | Valor |\n| --- | --- |\n${filas.map(([a, b]) => `| ${escapar(a)} | ${escapar(b)} |`).join('\n')}\n`;
}

export function markdown(informe) {
  const lineas = ['# Estadísticas del corte', '', `Corte: ${informe.corte}`, `Generado: ${informe.generado_en}`, `SHA-256: ${informe.sha256}`, `Listado potencialmente truncado: ${informe.potencialmente_truncado ? 'Sí, se usó --forzar' : 'No detectado'}`, '', REGLAS, '', ADVERTENCIA, ''];
  for (const [nombre, grupo] of Object.entries(informe.grupos)) {
    lineas.push(`## ${nombre}`, '', tabla('Resumen', [['Diagnósticos', grupo.diagnosticos], ['Fallas inferidas', grupo.fallas_inferidas], ...Object.entries(grupo.certeza).map(([k, v]) => [`Certeza ${k}`, v]), ['Fallas distintas', grupo.fallas_distintas], ...Object.entries(grupo.fallas_por_diagnostico).map(([k, v]) => [`Fallas por diagnóstico ${k}`, v]), ...Object.entries(grupo.observaciones).map(([k, v]) => [`Observaciones ${k}`, v])]), tabla('Bandas', Object.entries(grupo.bandas).map(([k, v]) => [k, `${v.cantidad} (${v.porcentaje == null ? 'Sin datos' : `${v.porcentaje}%`})`])), ...[['Fallas más frecuentes', grupo.fallas_mas_frecuentes], ['Marcas', grupo.marcas], ['Urgencias', grupo.urgencias]].map(([titulo, filas]) => tabla(titulo, filas.map((f) => [f.valor, f.cantidad]))));
  }
  for (const [campo, filas] of Object.entries(informe.variantes)) lineas.push(tabla(`Variantes de ${campo}`, filas.map((f) => [f.normalizado, f.variantes.join(', ')])));
  return `${lineas.join('\n')}\n`;
}

export function argumentos(args) {
  const opciones = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--url', '--corte', '--salida', '--solo-conteo', '--forzar'].includes(flag) || Object.hasOwn(opciones, flag)) throw new Error('Argumento desconocido o repetido.');
    if (flag === '--solo-conteo' || flag === '--forzar') opciones[flag] = true;
    else {
      const valor = args[++i];
      if (!valor || valor.startsWith('--')) throw new Error(`Falta el valor de ${flag}.`);
      opciones[flag] = valor;
    }
  }
  if (!opciones['--url'] || !opciones['--corte'] || !opciones['--salida']) throw new Error('Se requieren --url, --corte y --salida.');
  validarCorte(opciones['--corte']);
  let url;
  try { url = new URL(opciones['--url']); } catch { throw new Error('--url no es válida.'); }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('--url requiere HTTPS, salvo localhost o 127.0.0.1, y no admite credenciales ni parámetros.');
  return { url: url.href.replace(/\/+$/, ''), corte: opciones['--corte'], salida: opciones['--salida'], soloConteo: !!opciones['--solo-conteo'], forzar: !!opciones['--forzar'] };
}

export async function generar(opciones, usuario, clave, solicitar = fetch) {
  if (!usuario || !clave) throw new Error('Define CC_USUARIO y CC_CLAVE en el entorno.');
  const login = await solicitar(`${opciones.url}/api/auth/login`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: usuario, password: clave }) });
  if (!login.ok) throw new Error(`No se pudo iniciar sesión: HTTP ${login.status}.`);
  const sesion = await login.json();
  if (sesion.role !== 'administrador_mecanico') throw new Error('Se requiere una cuenta de administrador.');
  const cookies = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [login.headers.get('set-cookie')].filter(Boolean);
  if (!cookies.length) throw new Error('El inicio de sesión no devolvió una cookie.');
  const cookie = cookies.map((c) => c.split(';')[0].trim()).join('; ');
  const respuesta = await solicitar(`${opciones.url}/api/diagnosticos`, { headers: { cookie }, redirect: 'error' });
  if (!respuesta.ok) throw new Error(`No se pudieron leer los diagnósticos: HTTP ${respuesta.status}.`);
  const datos = await respuesta.json();
  if (!Array.isArray(datos)) throw new Error('La API no devolvió una lista de diagnósticos.');
  const truncado = datos.length === 100;
  if (truncado && !opciones.forzar) throw new Error('El listado contiene 100 filas y puede estar truncado; usa --forzar para continuar con datos incompletos.');
  const filtrados = prepararDiagnosticos(datos, validarCorte(opciones.corte));
  const reales = filtrados.filter((d) => d.origen === 'usuario');
  const semilla = filtrados.filter((d) => d.origen === 'semilla');
  if (opciones.soloConteo) {
    process.stdout.write(`Reales: ${reales.length}\nSemilla: ${semilla.length}\nReales con observación: ${reales.filter((d) => (d.observaciones || '').trim()).length}\nFaltan para 40: ${Math.max(0, 40 - reales.length)}\n`);
    return;
  }
  const informe = { corte: opciones.corte, generado_en: new Date().toISOString(), reglas_normalizacion: REGLAS, sha256: hashCorte(filtrados), potencialmente_truncado: truncado, advertencia: ADVERTENCIA, grupos: { reales: calcularGrupo(reales), semilla: calcularGrupo(semilla), total: calcularGrupo(filtrados) }, variantes: variantes(filtrados) };
  const nombre = `estadisticas-${opciones.corte.replace(/[:]/g, '-')}`;
  const json = path.join(opciones.salida, `${nombre}.json`);
  const md = path.join(opciones.salida, `${nombre}.md`);
  await writeFile(json, `${JSON.stringify(informe, null, 2)}\n`, { flag: 'wx' });
  try { await writeFile(md, markdown(informe), { flag: 'wx' }); } catch { await unlink(json); throw new Error('No se pudo escribir el informe Markdown; no se sobrescribieron archivos.'); }
  process.stdout.write('Informes JSON y Markdown generados en la carpeta indicada.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve().then(() => generar(argumentos(process.argv.slice(2)), process.env.CC_USUARIO, process.env.CC_CLAVE)).catch((error) => {
    const seguro = error instanceof Error && /^(--|Falta |Se requieren |Define |No se pudo iniciar|Se requiere una cuenta|El inicio de sesión|No se pudieron leer|La API |El listado |No se pudo escribir)/.test(error.message) ? error.message : 'No se pudo completar la operación.';
    process.stderr.write(`${seguro}\n`);
    process.exitCode = 1;
  });
}
