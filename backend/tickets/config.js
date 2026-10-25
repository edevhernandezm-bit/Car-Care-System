const PROVEEDORES = ['fake', 'resend', 'ninguno'];

function aBooleano(valor) {
  return ['1', 'true', 'si', 'sí'].includes(String(valor ?? '').trim().toLowerCase());
}

/**
 * Lee y valida la configuracion al arranque. Los mensajes nunca incluyen
 * valores, solo el nombre de la variable que falta o esta mal.
 */
function leerConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development');
  const produccion = nodeEnv === 'production';
  const ticketsEnabled = aBooleano(env.TICKETS_ENABLED);
  const mailProvider = String(env.MAIL_PROVIDER || 'ninguno').trim().toLowerCase();
  const mailFrom = String(env.MAIL_FROM || '').trim();
  const mailApiKey = String(env.MAIL_API_KEY || '').trim();
  const publicAppUrl = String(env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');

  if (!PROVEEDORES.includes(mailProvider)) {
    throw new Error('MAIL_PROVIDER invalido: usa fake, resend o ninguno.');
  }
  if (produccion && mailProvider === 'fake') {
    throw new Error('MAIL_PROVIDER=fake no esta permitido en produccion.');
  }
  if (produccion && ticketsEnabled && mailProvider === 'ninguno') {
    throw new Error('Con TICKETS_ENABLED=true en produccion, MAIL_PROVIDER no puede ser ninguno.');
  }
  if (ticketsEnabled && !publicAppUrl) {
    throw new Error('Falta PUBLIC_APP_URL para construir el enlace de la cotizacion.');
  }
  if (publicAppUrl && !/^https?:\/\//i.test(publicAppUrl)) {
    throw new Error('PUBLIC_APP_URL debe empezar por http:// o https://.');
  }
  if (mailProvider === 'resend') {
    if (!mailApiKey) throw new Error('Falta MAIL_API_KEY para MAIL_PROVIDER=resend.');
    if (!mailFrom) throw new Error('Falta MAIL_FROM para MAIL_PROVIDER=resend.');
  }

  return {
    nodeEnv,
    ticketsEnabled,
    mailProvider,
    mailFrom,
    mailApiKey,
    publicAppUrl,
  };
}

module.exports = { PROVEEDORES, leerConfig };
