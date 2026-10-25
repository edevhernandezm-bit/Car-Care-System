const test = require('node:test');
const assert = require('node:assert/strict');

const {
  escaparHtml,
  validarDestinatario,
  construirEnlace,
  plantillaCotizacion,
  crearMailer,
} = require('./correo');

test('escapa los cinco caracteres peligrosos de HTML', () => {
  assert.equal(escaparHtml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
});

test('la plantilla no deja pasar HTML del cliente', () => {
  const { html, text, subject } = plantillaCotizacion({
    nombre: '<script>alert(1)</script>',
    enlace: 'https://car-care.test/cotizacion#abc',
    resumen: {
      vehiculo: '<img src=x onerror=alert(1)>',
      fallas: ['<b>frenos</b>'],
      totales: '100 - 200 MXN',
    },
  });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<b>frenos'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('https://car-care.test/cotizacion#abc'), true);
  assert.equal(text.includes('<script>'), true); // el texto plano conserva los caracteres, no se interpreta
  assert.equal(subject.includes('\n'), false);
});

test('rotula la tasa estimada e incluye su fecha', () => {
  for (const fuente of ['constante', 'estimada']) {
    const { html, text } = plantillaCotizacion({
      nombre: 'Ana',
      enlace: 'https://car-care.test/cotizacion#abc',
      resumen: {
        vehiculo: 'Toyota',
        fallas: ['Frenos'],
        totales: '100 - 200 MXN',
        tipoCambio: { usd_mxn: 18.3, fecha: '2026-10-25', fuente },
      },
    });
    assert.match(html, /Tipo de cambio estimado/);
    assert.match(html, /2026-10-25/);
    assert.match(text, /Tipo de cambio estimado/);
  }
});

test('no rotula una tasa de mercado', () => {
  const { html } = plantillaCotizacion({
    nombre: 'Ana',
    enlace: 'https://car-care.test/cotizacion#abc',
    resumen: {
      tipoCambio: { usd_mxn: 18.3, fecha: '2026-10-25', fuente: 'frankfurter' },
    },
  });
  assert.doesNotMatch(html, /Tipo de cambio estimado/);
});

test('rechaza un enlace que no sea http(s)', () => {
  assert.throws(
    () => plantillaCotizacion({ nombre: 'Ana', enlace: 'javascript:alert(1)', resumen: {} }),
    /enlace/
  );
});

test('valida el destinatario sin filtrar el correo en el error', () => {
  assert.equal(validarDestinatario('  ana@example.com  '), 'ana@example.com');
  assert.throws(() => validarDestinatario('ana@'), /Destinatario invalido/);
  assert.throws(() => validarDestinatario('a'.repeat(250) + '@x.com'), /Destinatario invalido/);
});

test('construye el enlace con el token en el fragmento', () => {
  assert.equal(construirEnlace('https://car-care.test/', 'abc123'), 'https://car-care.test/cotizacion#abc123');
  assert.throws(() => construirEnlace('car-care.test', 'abc'), /PUBLIC_APP_URL/);
  assert.throws(() => construirEnlace('https://car-care.test', ''), /Token vacio/);
});

test('fake esta prohibido en produccion', () => {
  assert.throws(
    () => crearMailer({ mailProvider: 'fake', nodeEnv: 'production', coleccion: {} }),
    /no esta permitido en produccion/
  );
});

test('fake guarda en la coleccion inyectada', async () => {
  const guardados = [];
  const coleccion = {
    async insertOne(documento) {
      guardados.push(documento);
      return { insertedId: 'correo-1' };
    },
  };
  const mailer = crearMailer({ mailProvider: 'fake', nodeEnv: 'development', coleccion });

  const resultado = await mailer.enviarCotizacion({
    para: 'ana@example.com',
    nombre: 'Ana',
    enlace: 'https://car-care.test/cotizacion#abc',
    resumen: { vehiculo: 'Toyota Corolla', fallas: ['Frenos'], totales: '100 - 200 MXN' },
  });

  assert.deepEqual(resultado, { id: 'correo-1' });
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0].para, 'ana@example.com');
  assert.match(guardados[0].html, /Ana/);
  assert.match(guardados[0].html, /Frenos/);
});

test('ninguno no envia nada', async () => {
  const mailer = crearMailer({ mailProvider: 'ninguno' });
  assert.deepEqual(await mailer.enviarCotizacion({ para: 'ana@example.com' }), { omitido: true });
});

test('rechaza un proveedor desconocido', () => {
  assert.throws(() => crearMailer({ mailProvider: 'otro' }), /MAIL_PROVIDER invalido/);
});

test('resend envia por HTTPS con la clave en el encabezado', async () => {
  const peticiones = [];
  const fetchImpl = async (url, opciones) => {
    peticiones.push({ url, opciones });
    return { ok: true, status: 200, async json() { return { id: 'resend-1' }; } };
  };
  const mailer = crearMailer({
    mailProvider: 'resend',
    mailFrom: 'Car Care <onboarding@resend.dev>',
    mailApiKey: 'clave-secreta',
    fetchImpl,
  });

  const resultado = await mailer.enviarCotizacion({
    para: 'ana@example.com',
    nombre: 'Ana',
    enlace: 'https://car-care.test/cotizacion#abc',
    resumen: { vehiculo: 'Toyota', fallas: ['Frenos'], totales: '100 - 200 MXN' },
  });

  assert.deepEqual(resultado, { id: 'resend-1' });
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].url, 'https://api.resend.com/emails');
  assert.equal(peticiones[0].opciones.method, 'POST');
  assert.equal(peticiones[0].opciones.headers.Authorization, 'Bearer clave-secreta');
  const cuerpo = JSON.parse(peticiones[0].opciones.body);
  assert.deepEqual(cuerpo.to, ['ana@example.com']);
  assert.equal(cuerpo.from, 'Car Care <onboarding@resend.dev>');
});

test('resend falla sin filtrar destinatario ni cuerpo', async () => {
  const errores = [];
  const original = console.error;
  console.error = (...args) => errores.push(args.join(' '));
  try {
    const mailer = crearMailer({
      mailProvider: 'resend',
      mailFrom: 'Car Care <onboarding@resend.dev>',
      mailApiKey: 'clave-secreta',
      async fetchImpl() {
        return { ok: false, status: 500, async json() { return { mensaje: 'detalle interno' }; } };
      },
    });

    await assert.rejects(
      () =>
        mailer.enviarCotizacion({
          para: 'ana@example.com',
          nombre: 'Ana',
          enlace: 'https://car-care.test/cotizacion#abc',
          resumen: {},
        }),
      (error) => {
        assert.match(error.message, /500/);
        assert.equal(error.message.includes('ana@example.com'), false);
        assert.equal(error.message.includes('detalle interno'), false);
        return true;
      }
    );
    assert.ok(errores.length >= 1);
    const registro = errores.join(' ');
    assert.equal(registro.includes('ana@example.com'), false);
    assert.equal(registro.includes('clave-secreta'), false);
    assert.equal(registro.includes('detalle interno'), false);
  } finally {
    console.error = original;
  }
});
