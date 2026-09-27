const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PUERTO = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/car_care_system';

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

mongoose
  .connect(MONGO_URI)
  .then(() => console.log(`MongoDB conectado: ${MONGO_URI}`))
  .catch((err) => {
    console.error('Error conectando a MongoDB:', err.message);
    process.exit(1);
  });

const itemSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  creado_en: { type: Date, default: Date.now },
});

const Item = mongoose.model('Item', itemSchema);

app.get('/api/items', async (_req, res) => {
  try {
    const items = await Item.find().sort({ creado_en: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const item = new Item({ nombre: req.body.nombre });
    const guardado = await item.save();
    res.status(201).json(guardado);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Historial de consultas y estadísticas del factor de certeza ---
// Cada consulta al motor de inferencia se guarda para generar las estadísticas
// del factor de certeza (certeza promedio por falla, conteos y promedio global).

const diagnosticoSchema = new mongoose.Schema({
  vehiculo: {
    marca: { type: String, default: '' },
    modelo: { type: String, default: '' },
    anio: { type: Number, default: 0 },
  },
  sintomas: [{ type: String }],
  fallas: [
    {
      falla: { type: String, required: true },
      certeza: { type: Number, required: true },
    },
  ],
  creado_en: { type: Date, default: Date.now },
});

const Diagnostico = mongoose.model('Diagnostico', diagnosticoSchema);

app.get('/api/diagnosticos', async (_req, res) => {
  try {
    const historial = await Diagnostico.find().sort({ creado_en: -1 }).limit(100);
    res.json(historial);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/diagnosticos', async (req, res) => {
  try {
    const diag = new Diagnostico({
      vehiculo: {
        marca: req.body.vehiculo?.marca || '',
        modelo: req.body.vehiculo?.modelo || '',
        anio: req.body.vehiculo?.anio || 0,
      },
      sintomas: req.body.sintomas || [],
      fallas: (req.body.fallas || []).map((f) => ({
        falla: f.falla,
        certeza: f.certeza,
      })),
    });
    const guardado = await diag.save();
    res.status(201).json(guardado);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Estadísticas del factor de certeza: certeza promedio por falla, cantidad de
// veces que se infirió cada falla y el promedio general, basado en el historial
// guardado.
app.get('/api/stats/certeza', async (_req, res) => {
  try {
    const porFalla = await Diagnostico.aggregate([
      { $unwind: '$fallas' },
      {
        $group: {
          _id: '$fallas.falla',
          veces: { $sum: 1 },
          certeza_promedio: { $avg: '$fallas.certeza' },
        },
      },
      { $sort: { veces: -1 } },
    ]);

    const totales = await Diagnostico.aggregate([
      { $unwind: '$fallas' },
      {
        $group: {
          _id: null,
          promedio_global: { $avg: '$fallas.certeza' },
          total_consultas: { $sum: 1 },
          total_fallas_inferidas: { $count: {} },
        },
      },
    ]);

    res.json({
      total_consultas: (totales[0] && totales[0].total_consultas) || 0,
      total_fallas_inferidas: (totales[0] && totales[0].total_fallas_inferidas) || 0,
      certeza_promedio_global: (totales[0] && totales[0].promedio_global) || 0,
      por_falla: porFalla
        .map((f) => ({
          falla: f._id,
          veces: f.veces,
          certeza_promedio: Math.round(f.certeza_promedio * 100) / 100,
        }))
        .sort((a, b) => b.veces - a.veces),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PUERTO, () => {
  console.log(`API escuchando en http://localhost:${PUERTO}`);
});
