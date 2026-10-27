const mongoose = require('mongoose');
const { PRECIO_FINAL_MAX } = require('./cotizacion');

const ESTADOS = [
  'diagnosticado',
  'cotizacion_enviada',
  'autorizado',
  'rechazado',
  'vencido',
  'en_reparacion',
  'terminado',
  'cancelado',
];

const CORREO_MAX = 254;
const NOMBRE_MAX = 120;
const TELEFONO_MAX = 30;
const COMENTARIO_MAX = 500;
const MOTIVOS_RECHAZO = ['precio_alto', 'no_deseo_reparar', 'dudo_del_diagnostico', 'otro'];

// Solo codigos fijos: el detalle del proveedor nunca entra en el documento.
const CODIGOS_ERROR = [
  'tiempo_agotado',
  'error_red',
  'sin_proveedor',
  'destinatario_invalido',
  'simulado',
  'desconocido',
];
const PROVEEDOR_RE = /^proveedor_\d{3}$/;

function codigoErrorValido(valor) {
  return CODIGOS_ERROR.includes(valor) || PROVEEDOR_RE.test(String(valor ?? ''));
}

// Formato simple a proposito: evita guardar basura, no decide si el buzon existe.
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clienteSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: NOMBRE_MAX },
    correo: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: CORREO_MAX,
      validate: { validator: (v) => CORREO_RE.test(v), message: 'correo invalido' },
    },
    telefono: { type: String, trim: true, maxlength: TELEFONO_MAX },
  },
  { _id: false }
);

const fallaSchema = new mongoose.Schema(
  {
    falla: { type: String, required: true, trim: true },
    nombre: { type: String, required: true, trim: true },
    precioMinMXN: { type: Number, required: true, min: 0 },
    precioMaxMXN: { type: Number, required: true, min: 0 },
    monedaOrigen: { type: String, enum: ['MXN', 'USD'], required: true },
    costoMinOrigen: { type: Number, required: true, min: 0 },
    costoMaxOrigen: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const historialSchema = new mongoose.Schema(
  {
    de: { type: String, enum: ESTADOS, required: true },
    a: { type: String, enum: ESTADOS, required: true },
    en: { type: Date, required: true },
    por: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

// Append-only: cada decision del cliente deja su propia entrada.
const decisionSchema = new mongoose.Schema(
  {
    resultado: { type: String, enum: ['autorizado', 'rechazado'], required: true },
    motivo: { type: String, enum: MOTIVOS_RECHAZO },
    comentario: { type: String, maxlength: COMENTARIO_MAX },
    precioFinalMXN: { type: Number, min: 0.01, max: PRECIO_FINAL_MAX },
    en: { type: Date, required: true },
  },
  { _id: false }
);

const precioFinalSchema = new mongoose.Schema(
  {
    precioFinalMXN: { type: Number, required: true, min: 0.01, max: PRECIO_FINAL_MAX },
    en: { type: Date, required: true },
    por: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    diagnosticoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Diagnostico', required: true },
    creadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cliente: { type: clienteSchema, required: true },
    vehiculo: {
      marca: { type: String, default: '' },
      modelo: { type: String, default: '' },
      anio: { type: Number, default: 0 },
      transmision: { type: String, default: 'desconocida' },
    },
    fallas: { type: [fallaSchema], default: [] },
    cotizacion: {
      totalMinMXN: { type: Number, required: true, min: 0 },
      totalMaxMXN: { type: Number, required: true, min: 0 },
      totalMinUSD: { type: Number, required: true, min: 0 },
      totalMaxUSD: { type: Number, required: true, min: 0 },
      tipoCambio: {
        usd_mxn: { type: Number, required: true },
        fecha: { type: String, required: true },
        fuente: { type: String, required: true },
      },
      leyenda: { type: String, default: 'No incluye mano de obra' },
      // Solo existen despues de enviar: son el precio final del mecanico y el
      // USD aproximado calculado con la tasa congelada del diagnostico.
      precioFinalMXN: { type: Number, min: 0.01, max: PRECIO_FINAL_MAX },
      precioFinalUSD: { type: Number, min: 0 },
    },
    // Historial append-only de precios finales enviados, para auditar reenvios.
    precios: { type: [precioFinalSchema], default: [] },
    estado: { type: String, enum: ESTADOS, required: true, default: 'diagnosticado' },
    historial: { type: [historialSchema], default: [] },
    decisiones: { type: [decisionSchema], default: [] },
    // Solo se guarda el resultado del ultimo intento: nunca cuerpo ni destinatario.
    envio: {
      enviado: { type: Boolean, default: false },
      intentos: { type: Number, default: 0, min: 0 },
      codigoError: {
        type: String,
        validate: {
          validator: (v) => v === undefined || v === null || codigoErrorValido(v),
          message: 'codigoError invalido',
        },
      },
      ultimoIntentoEn: { type: Date },
    },
    // Nunca null: al salir de cotizacion_enviada se elimina con $unset.
    tokenHash: {
      type: String,
      validate: {
        validator: (v) => typeof v === 'string' && v.length > 0,
        message: 'tokenHash debe ser un hash no vacio',
      },
    },
    tokenVenceEn: { type: Date },
    creadoEn: { type: Date, default: Date.now },
    actualizadoEn: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

ticketSchema.index(
  { tokenHash: 1 },
  { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
);
ticketSchema.index({ estado: 1, creadoEn: -1 });
ticketSchema.index({ diagnosticoId: 1 });
ticketSchema.index({ 'cliente.correo': 1 });

function esClaveDuplicada(error) {
  return error?.code === 11000;
}

const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);

module.exports = {
  ESTADOS,
  Ticket,
  ticketSchema,
  esClaveDuplicada,
  codigoErrorValido,
  CODIGOS_ERROR,
  PROVEEDOR_RE,
  COMENTARIO_MAX,
  MOTIVOS_RECHAZO,
  CORREO_MAX,
  CORREO_RE,
  NOMBRE_MAX,
  TELEFONO_MAX,
};
