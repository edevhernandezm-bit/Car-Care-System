const mongoose = require('mongoose');

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10000;
const LEYENDA = 'No incluye mano de obra';
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (caracter) => ESCAPES[caracter]);
}

function validarDestinatario(para) {
  const limpio = typeof para === 'string' ? para.trim() : '';
  if (limpio.length > 254 || !CORREO_RE.test(limpio)) {
    throw new Error('Destinatario invalido.');
  }
  return limpio;
}

function construirEnlace(publicAppUrl, token) {
  const base = String(publicAppUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('PUBLIC_APP_URL no es una URL http(s) valida.');
  }
  if (typeof token !== 'string' || token === '') {
    throw new Error('Token vacio.');
  }
  return `${base}/cotizacion#${token}`;
}

function normalizarResumen(resumen) {
  const datos = resumen || {};
  const tipoCambio = datos.tipoCambio && typeof datos.tipoCambio === 'object'
    ? {
        usd_mxn: Number(datos.tipoCambio.usd_mxn),
        fecha: String(datos.tipoCambio.fecha || ''),
        fuente: String(datos.tipoCambio.fuente || ''),
      }
    : null;
  return {
    vehiculo: typeof datos.vehiculo === 'string' ? datos.vehiculo : '',
    fallas: Array.isArray(datos.fallas) ? datos.fallas.map((f) => String(f)) : [],
    totales: typeof datos.totales === 'string' ? datos.totales : '',
    leyenda: typeof datos.leyenda === 'string' ? datos.leyenda : LEYENDA,
    tipoCambio,
  };
}

// La tasa estimada no es un dato de mercado: el correo debe decirlo y mostrar
// la fecha con la que se congelo, no presentarla como una tasa exacta.
function notaTipoCambio(tipoCambio) {
  // 'constante' es la fuente real del respaldo (server.js); 'estimada' se acepta
  // como etiqueta equivalente si el dato llega de otra fuente.
  if (tipoCambio?.fuente !== 'constante' && tipoCambio?.fuente !== 'estimada') return '';
  const fecha = tipoCambio.fecha || 'sin fecha';
  if (Number.isFinite(tipoCambio.usd_mxn) && tipoCambio.usd_mxn > 0) {
    return `Tipo de cambio estimado (${fecha}): 1 USD = ${tipoCambio.usd_mxn} MXN.`;
  }
  return `Tipo de cambio estimado (${fecha}).`;
}

function plantillaCotizacion({ nombre, enlace, resumen } = {}) {
  if (typeof enlace !== 'string' || !/^https?:\/\//i.test(enlace)) {
    throw new Error('El enlace de la cotizacion no es valido.');
  }
  const datos = normalizarResumen(resumen);
  const nombreSeguro = escaparHtml(nombre || '');
  const vehiculoSeguro = escaparHtml(datos.vehiculo);
  const enlaceSeguro = escaparHtml(enlace);
  const fallas = datos.fallas.map((falla) => escaparHtml(falla));
  const totalesSeguro = escaparHtml(datos.totales);
  const leyendaSegura = escaparHtml(datos.leyenda);
  const notaTasa = notaTipoCambio(datos.tipoCambio);
  const notaTasaSegura = escaparHtml(notaTasa);

  const asunto = ['Cotizacion de reparacion', datos.vehiculo]
    .filter(Boolean)
    .join(' - ')
    .replace(/[\r\n]+/g, ' ');

  const html = [
    '<h2>Cotizacion de reparacion</h2>',
    `<p>Hola ${nombreSeguro},</p>`,
    '<p>Este es el resumen de la cotizacion para tu vehiculo:</p>',
    vehiculoSeguro ? `<p><strong>${vehiculoSeguro}</strong></p>` : '',
    fallas.length ? `<ul>${fallas.map((falla) => `<li>${falla}</li>`).join('')}</ul>` : '',
    totalesSeguro ? `<p>${totalesSeguro}</p>` : '',
    notaTasa ? `<p>${notaTasaSegura}</p>` : '',
    `<p>${leyendaSegura}</p>`,
    `<p><a href="${enlaceSeguro}">Revisar y responder la cotizacion</a></p>`,
    '<p>El enlace vence en 72 horas y solo puede usarse una vez.</p>',
  ]
    .filter(Boolean)
    .join('\n');

  const texto = [
    'Cotizacion de reparacion',
    `Hola ${nombre || ''},`,
    datos.vehiculo,
    ...datos.fallas,
    datos.totales,
    notaTasa,
    datos.leyenda,
    `Revisar y responder: ${enlace}`,
    'El enlace vence en 72 horas y solo puede usarse una vez.',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: asunto, html, text: texto };
}

function crearMailer({
  mailProvider = 'ninguno',
  nodeEnv = process.env.NODE_ENV,
  mailFrom = '',
  mailApiKey = '',
  fetchImpl = globalThis.fetch,
  coleccion,
} = {}) {
  if (mailProvider === 'fake') {
    if (nodeEnv === 'production') {
      throw new Error('MAIL_PROVIDER=fake no esta permitido en produccion.');
    }
    const obtenerColeccion = coleccion
      ? () => coleccion
      : () => mongoose.connection.collection('correos_prueba');

    return {
      async enviarCotizacion(datos) {
        const para = validarDestinatario(datos?.para);
        const { subject, html, text } = plantillaCotizacion(datos);
        const resultado = await obtenerColeccion().insertOne({
          para,
          asunto: subject,
          html,
          text,
          creadoEn: new Date(),
        });
        return { id: resultado.insertedId };
      },
    };
  }

  if (mailProvider === 'resend') {
    if (!mailApiKey) throw new Error('Falta MAIL_API_KEY para enviar con Resend.');
    if (!mailFrom) throw new Error('Falta MAIL_FROM para enviar con Resend.');

    return {
      async enviarCotizacion(datos) {
        const para = validarDestinatario(datos?.para);
        const { subject, html, text } = plantillaCotizacion(datos);

        let respuesta;
        try {
          respuesta = await fetchImpl(RESEND_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${mailApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from: mailFrom, to: [para], subject, html, text }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (error) {
          // Solo el tipo de fallo: ni cuerpo, ni destinatario, ni clave.
          const motivo = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'tiempo agotado' : 'error de red';
          console.error(`[correo] ${motivo} al contactar al proveedor.`);
          throw new Error('No se pudo contactar al proveedor de correo.');
        }

        if (!respuesta.ok) {
          console.error(`[correo] el proveedor respondio ${respuesta.status}.`);
          throw new Error(`El proveedor de correo respondio ${respuesta.status}.`);
        }

        const cuerpo = await respuesta.json().catch(() => ({}));
        return { id: cuerpo?.id || null };
      },
    };
  }

  if (mailProvider === 'ninguno') {
    return {
      async enviarCotizacion() {
        return { omitido: true };
      },
    };
  }

  throw new Error('MAIL_PROVIDER invalido: usa fake, resend o ninguno.');
}

module.exports = {
  RESEND_URL,
  TIMEOUT_MS,
  escaparHtml,
  validarDestinatario,
  construirEnlace,
  plantillaCotizacion,
  crearMailer,
};
