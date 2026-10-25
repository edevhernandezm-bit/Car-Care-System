const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 horas

function generarToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function calcularVencimiento(ahora = new Date()) {
  return new Date(ahora.getTime() + TOKEN_TTL_MS);
}

function estaVencido(tokenVenceEn, ahora = new Date()) {
  if (!(tokenVenceEn instanceof Date) || Number.isNaN(tokenVenceEn.getTime())) return true;
  return tokenVenceEn.getTime() <= ahora.getTime();
}

// En la base solo vive el hash; el token plano nunca se consulta.
async function buscarPorToken(Ticket, token) {
  if (typeof token !== 'string' || token === '') return null;
  return Ticket.findOne({ tokenHash: hashToken(token) });
}

module.exports = {
  TOKEN_BYTES,
  TOKEN_TTL_MS,
  generarToken,
  hashToken,
  calcularVencimiento,
  estaVencido,
  buscarPorToken,
};
