const mongoose = require('mongoose');
const { LEYENDA_PRECIO_FINAL } = require('./cotizacion');

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10000;
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (caracter) => ESCAPES[caracter]);
}

function errorEnvio(codigo, mensaje) {
  return Object.assign(new Error(mensaje), { codigo });
}

function validarDestinatario(para) {
  const limpio = typeof para === 'string' ? para.trim() : '';
  if (limpio.length > 254 || !CORREO_RE.test(limpio)) {
    throw errorEnvio('destinatario_invalido', 'Destinatario invalido.');
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
  const precioFinalMXN = Number(datos.precioFinalMXN);
  const precioFinalUSD = Number(datos.precioFinalUSD);
  if (
    !Number.isFinite(precioFinalMXN) ||
    precioFinalMXN <= 0 ||
    !Number.isFinite(precioFinalUSD) ||
    precioFinalUSD < 0
  ) {
    throw new Error('El resumen no trae un precio final válido.');
  }
  return {
    vehiculo: typeof datos.vehiculo === 'string' ? datos.vehiculo : '',
    fallas: Array.isArray(datos.fallas) ? datos.fallas.map((f) => String(f)) : [],
    precioFinalMXN,
    precioFinalUSD,
    // La leyenda es una regla del precio final, no un dato que pueda mandar el cliente.
    leyenda: LEYENDA_PRECIO_FINAL,
    tipoCambio,
  };
}

// La tasa se congela con el diagnostico y siempre se muestra con su fecha. Si
// es la de respaldo, el correo debe decir que es estimada y no de mercado.
function notaTipoCambio(tipoCambio) {
  if (!tipoCambio) return '';
  // 'constante' es la fuente real del respaldo (server.js); 'estimada' se acepta
  // como etiqueta equivalente si el dato llega de otra fuente.
  const estimada =
    tipoCambio.fuente === 'constante' || tipoCambio.fuente === 'estimada';
  const rotulo = estimada ? 'Tipo de cambio estimado' : 'Tipo de cambio';
  const fecha = tipoCambio.fecha || 'sin fecha';
  if (Number.isFinite(tipoCambio.usd_mxn) && tipoCambio.usd_mxn > 0) {
    return `${rotulo} (${fecha}): 1 USD = ${tipoCambio.usd_mxn} MXN.`;
  }
  return `${rotulo} (${fecha}).`;
}

function formatearMontoMXN(valor) {
  return Number(valor).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatearMontoUSD(valor) {
  return Number(valor).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const precioSeguro = escaparHtml(
    `Precio final: $${formatearMontoMXN(datos.precioFinalMXN)} MXN ` +
      `(aprox. $${formatearMontoUSD(datos.precioFinalUSD)} USD).`
  );
  const avisoUSDSeguro = escaparHtml(
    'El monto a pagar es en MXN. El precio en USD es aproximado, solo referencia.'
  );
  const leyendaSegura = escaparHtml(datos.leyenda);
  const notaTasa = notaTipoCambio(datos.tipoCambio);
  const notaTasaSegura = escaparHtml(notaTasa);

  const asunto = ['Cotización de reparación', datos.vehiculo]
    .filter(Boolean)
    .join(' - ')
    .replace(/[\r\n]+/g, ' ');

  const html = [
    '<!doctype html>',
    '<html>',
    '<head><meta charset="UTF-8"></head>',
    '<body>',
    '<h2>Cotización de reparación</h2>',
    `<p>Hola ${nombreSeguro},</p>`,
    '<p>Este es el resumen de la cotización para tu vehículo:</p>',
    vehiculoSeguro ? `<p><strong>${vehiculoSeguro}</strong></p>` : '',
    fallas.length ? `<ul>${fallas.map((falla) => `<li>${falla}</li>`).join('')}</ul>` : '',
    `<p>${precioSeguro}</p>`,
    `<p>${leyendaSegura}</p>`,
    `<p>${avisoUSDSeguro}</p>`,
    notaTasa ? `<p>${notaTasaSegura}</p>` : '',
    '<p>Puedes autorizar o rechazar la cotización. Si rechazas, puedes indicar un motivo.</p>',
    `<p><a href="${enlaceSeguro}">Revisar y responder la cotización</a></p>`,
    '<p>El enlace vence en 72 horas y solo puede usarse una vez.</p>',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');

  const texto = [
    'Cotización de reparación',
    `Hola ${nombre || ''},`,
    'Resumen de la cotización para tu vehículo:',
    datos.vehiculo,
    ...datos.fallas,
    `Precio final: $${formatearMontoMXN(datos.precioFinalMXN)} MXN ` +
      `(aprox. $${formatearMontoUSD(datos.precioFinalUSD)} USD).`,
    'El monto a pagar es en MXN. El precio en USD es aproximado, solo referencia.',
    datos.leyenda,
    notaTasa,
    'Puedes autorizar o rechazar la cotización. Si rechazas, puedes indicar un motivo.',
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
        // Solo el fake puede simular el fallo: en produccion esta prohibido.
        if (para.slice(para.lastIndexOf('@') + 1).toLowerCase() === 'falla.example') {
          throw errorEnvio('simulado', 'Fallo de envio simulado.');
        }
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
          const agotado = error?.name === 'TimeoutError' || error?.name === 'AbortError';
          const motivo = agotado ? 'tiempo agotado' : 'error de red';
          console.error(`[correo] ${motivo} al contactar al proveedor.`);
          throw errorEnvio(
            agotado ? 'tiempo_agotado' : 'error_red',
            'No se pudo contactar al proveedor de correo.'
          );
        }

        if (!respuesta.ok) {
          console.error(`[correo] el proveedor respondio ${respuesta.status}.`);
          const codigo = /^\d{3}$/.test(String(respuesta.status))
            ? `proveedor_${respuesta.status}`
            : 'desconocido';
          throw errorEnvio(codigo, `El proveedor de correo respondio ${respuesta.status}.`);
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
