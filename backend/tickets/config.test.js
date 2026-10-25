const test = require('node:test');
const assert = require('node:assert/strict');

const { leerConfig } = require('./config');

test('valores por defecto seguros', () => {
  const config = leerConfig({});
  assert.equal(config.ticketsEnabled, false);
  assert.equal(config.mailProvider, 'ninguno');
  assert.equal(config.nodeEnv, 'development');
});

test('fake esta prohibido en produccion', () => {
  assert.throws(
    () => leerConfig({ NODE_ENV: 'production', MAIL_PROVIDER: 'fake' }),
    /fake no esta permitido en produccion/
  );
});

test('ninguno con tickets activos en produccion es error', () => {
  assert.throws(
    () =>
      leerConfig({
        NODE_ENV: 'production',
        TICKETS_ENABLED: 'true',
        MAIL_PROVIDER: 'ninguno',
        PUBLIC_APP_URL: 'https://car-care.test',
      }),
    /no puede ser ninguno/
  );
});

test('ninguno con tickets apagados en produccion es valido', () => {
  const config = leerConfig({ NODE_ENV: 'production', MAIL_PROVIDER: 'ninguno' });
  assert.equal(config.mailProvider, 'ninguno');
  assert.equal(config.ticketsEnabled, false);
});

test('resend exige clave y remitente', () => {
  assert.throws(
    () => leerConfig({ MAIL_PROVIDER: 'resend', MAIL_FROM: 'a@b.com' }),
    /MAIL_API_KEY/
  );
  assert.throws(
    () => leerConfig({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'k' }),
    /MAIL_FROM/
  );
});

test('resend completo es valido y la clave no sale en el resultado impreso', () => {
  const config = leerConfig({
    MAIL_PROVIDER: 'resend',
    MAIL_FROM: 'Car Care <onboarding@resend.dev>',
    MAIL_API_KEY: 'clave-secreta',
    PUBLIC_APP_URL: 'https://car-care.test/',
  });
  assert.equal(config.mailApiKey, 'clave-secreta');
  assert.equal(config.publicAppUrl, 'https://car-care.test');
});

test('tickets activos exigen PUBLIC_APP_URL', () => {
  assert.throws(
    () => leerConfig({ TICKETS_ENABLED: '1', MAIL_PROVIDER: 'ninguno' }),
    /PUBLIC_APP_URL/
  );
  assert.throws(
    () =>
      leerConfig({
        TICKETS_ENABLED: '1',
        MAIL_PROVIDER: 'ninguno',
        PUBLIC_APP_URL: 'car-care.test',
      }),
    /http/
  );
});

test('rechaza un proveedor desconocido', () => {
  assert.throws(() => leerConfig({ MAIL_PROVIDER: 'otro' }), /MAIL_PROVIDER invalido/);
});

test('los mensajes no incluyen valores sensibles', () => {
  const clave = 'clave-ultra-secreta';
  try {
    leerConfig({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: clave });
    assert.fail('debio lanzar');
  } catch (error) {
    assert.equal(error.message.includes(clave), false);
    assert.match(error.message, /MAIL_FROM/);
  }
});
