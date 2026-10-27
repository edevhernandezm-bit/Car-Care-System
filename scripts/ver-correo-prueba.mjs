// Solo desarrollo: imprime el enlace del ultimo correo que guardo el mailer
// fake en la base local. Nunca se conecta a una base remota ni imprime otra
// cosa que el enlace (ni correo, ni asunto, ni cuerpo).
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const mongoose = require(path.join(HERE, '..', 'backend', 'node_modules', 'mongoose'));

const URI_POR_DEFECTO = 'mongodb://localhost:27017/car_care_system';
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1']);
const COLECCION = 'correos_prueba';

// Comparacion exacta del host: nada de startsWith, que aceptaria
// "localhost.evil.example".
function uriLocal(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'mongodb:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return HOSTS_LOCALES.has(host);
}

function fallar(mensaje) {
  console.error(mensaje);
  process.exitCode = 1;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    return fallar('No se ejecuta con NODE_ENV=production.');
  }

  const uri = String(process.env.MONGO_URI || URI_POR_DEFECTO).trim();
  if (!uriLocal(uri)) {
    return fallar('MONGO_URI debe apuntar a localhost, 127.0.0.1 o ::1.');
  }

  const destino = String(process.env.PROBAR_DESTINO || '').trim();
  if (!destino) return fallar('Falta PROBAR_DESTINO.');

  await mongoose.connect(uri);
  try {
    const correo = await mongoose.connection
      .collection(COLECCION)
      .find({ para: destino })
      .sort({ creadoEn: -1 })
      .next();
    const enlace = correo ? /href="([^"]+)"/.exec(correo.html)?.[1] : null;
    if (!enlace) return fallar('No hay correo guardado para ese destino.');
    console.log(enlace);
  } finally {
    await mongoose.disconnect();
  }
}

try {
  await main();
} catch {
  // Sin mensaje del error: podria arrastrar datos del documento o de la URI.
  fallar('No se pudo leer el correo de prueba.');
}
