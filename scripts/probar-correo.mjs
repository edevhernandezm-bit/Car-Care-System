import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { crearMailer, construirEnlace } = require('../backend/tickets/correo.js');

const REQUERIDAS = ['MAIL_API_KEY', 'MAIL_FROM', 'PUBLIC_APP_URL', 'PROBAR_DESTINO'];
const TOKEN_FICTICIO = 'token-ficticio-de-prueba';

function faltantes() {
  return REQUERIDAS.filter((nombre) => !String(process.env[nombre] ?? '').trim());
}

function motivoFallo(error) {
  const mensaje = String(error?.message || '');
  const status = /respondio (\d{3})\./.exec(mensaje)?.[1];
  if (status) return status;
  if (mensaje.includes('Destinatario invalido')) return 'destinatario';
  if (mensaje.includes('PUBLIC_APP_URL') || mensaje.includes('Falta MAIL_')) return 'configuracion';
  if (mensaje.includes('No se pudo contactar')) return 'red';
  return 'error';
}

async function main() {
  const sinDefinir = faltantes();
  if (sinDefinir.length > 0) {
    console.error(`Faltan variables: ${sinDefinir.join(', ')}`);
    process.exit(1);
  }

  const mailer = crearMailer({
    mailProvider: 'resend',
    mailApiKey: process.env.MAIL_API_KEY,
    mailFrom: process.env.MAIL_FROM,
  });

  const resumen = {
    vehiculo: 'Toyota Corolla 2020',
    fallas: ['Frenos delanteros', 'Bateria'],
    totales:
      'Total estimado: $1,500.00 - $2,300.00 MXN ($81.97 - $125.68 USD).',
    leyenda: 'No incluye mano de obra',
    tipoCambio: {
      usd_mxn: 18.3,
      fecha: new Date().toISOString().slice(0, 10),
      fuente: 'estimada',
    },
  };

  const datos = {
    para: process.env.PROBAR_DESTINO,
    nombre: 'Cliente de prueba',
    enlace: construirEnlace(process.env.PUBLIC_APP_URL, TOKEN_FICTICIO),
    resumen,
  };

  // El mailer ya registra el fallo del proveedor; aqui se silencia para que la
  // salida del script sea solo el resultado fijo.
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    await mailer.enviarCotizacion(datos);
  } finally {
    console.error = errorOriginal;
  }

  console.log('envio: ok');
}

try {
  await main();
} catch (error) {
  console.log(`envio: fallo (${motivoFallo(error)})`);
  process.exitCode = 1;
}
