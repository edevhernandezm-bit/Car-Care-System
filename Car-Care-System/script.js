// Estado de la aplicación y Base de Conocimientos
const state = {
  section: 'diagnostico',
  searchQuery: '',
  vehiculoActual: null,
  
  // Agrupados visualmente por categoría
  sintomas_prolog: [
    // Frenos
    { id: 'chirrido_al_frenar', nombre: 'Chirrido al frenar', categoria: 'Frenos' },
    { id: 'pedal_freno_esponjoso', nombre: 'Pedal de freno esponjoso', categoria: 'Frenos' },
    { id: 'olor_quemado_llantas', nombre: 'Olor a llantas quemadas', categoria: 'Frenos' },
    // Motor & Refrigeración
    { id: 'humo_azul', nombre: 'Humo azul en escape', categoria: 'Motor' },
    { id: 'perdida_potencia', nombre: 'Pérdida de potencia', categoria: 'Motor' },
    { id: 'olor_gasolina_bayeta', nombre: 'Olor a gasolina/bayeta', categoria: 'Motor' },
    { id: 'sobrecalentamiento', nombre: 'Sobrecalentamiento del motor', categoria: 'Refrigeración' },
    { id: 'nivel_bajo_anticongelante', nombre: 'Nivel bajo de anticongelante', categoria: 'Refrigeración' },
    { id: 'luz_check_engine', nombre: 'Luz check engine encendida', categoria: 'Motor' },
    { id: 'consumo_excesivo_combustible', nombre: 'Consumo excesivo de combustible', categoria: 'Motor' },
    { id: 'humo_blanco_escape', nombre: 'Humo blanco en escape', categoria: 'Motor' },
    { id: 'humo_negro_escape', nombre: 'Humo negro en escape', categoria: 'Motor' },
    { id: 'tirones_al_acelerar', nombre: 'Tirones al acelerar', categoria: 'Motor' },
    { id: 'charco_aceite_motor', nombre: 'Charco de aceite bajo motor', categoria: 'Aceite' },
    { id: 'ruido_metalico_motor', nombre: 'Ruido metálico en motor', categoria: 'Motor' },
    // Encendido y Eléctrico
    { id: 'motor_no_gira', nombre: 'Motor no gira', categoria: 'Encendido' },
    { id: 'luces_debiles', nombre: 'Luces débiles', categoria: 'Electricidad' },
    { id: 'falla_encendido', nombre: 'Falla en encendido', categoria: 'Encendido' },
    // Transmisión
    { id: 'marchas_resbalan', nombre: 'Marchas resbalan', categoria: 'Transmisión' },
    { id: 'pedal_embrague_suelto', nombre: 'Pedal de embrague suelto', categoria: 'Transmisión' },
    // Dirección & Suspensión
    { id: 'volante_duro', nombre: 'Volante duro', categoria: 'Dirección' },
    { id: 'fuga_liquido_direccion', nombre: 'Fuga de líquido de dirección', categoria: 'Dirección' },
    { id: 'vibracion_encendido_aire', nombre: 'Vibración al encender con aire', categoria: 'Suspensión' },
    { id: 'ruido_clac_clac_girar', nombre: 'Ruido clac-clac al girar', categoria: 'Suspensión' },
    { id: 'vibracion_volante_alta_vel', nombre: 'Vibración en volante a alta velocidad', categoria: 'Suspensión' },
    // Otros
    { id: 'aire_acondicionado_no_enfria', nombre: 'Aire acondicionado no enfría', categoria: 'Climatización' },
    { id: 'ruido_correa_acelerar', nombre: 'Ruido de correa al acelerar', categoria: 'Accesorios' }
  ],

  // Consistencia 1:1 verificada con Prolog
  fallas_prolog: [
    { id: 'falta_lubricacion_motor', nombre: 'Falta de lubricación del motor', urgencia: 'Crítica', costo_min: 500, costo_max: 1500 },
    { id: 'junta_culata_quemada', nombre: 'Junta de culata quemada', urgencia: 'Crítica', costo_min: 4000, costo_max: 12000 },
    { id: 'bateria_descargada_o_alternador', nombre: 'Batería descargada o alternador', urgencia: 'Alta', costo_min: 800, costo_max: 3500 },
    { id: 'fuga_sistema_refrigeracion', nombre: 'Fuga en sistema de refrigeración', urgencia: 'Alta', costo_min: 600, costo_max: 4000 },
    { id: 'embrague_desgastado', nombre: 'Embrague desgastado', urgencia: 'Alta', costo_min: 2500, costo_max: 6000 },
    { id: 'bomba_direccion_averiada', nombre: 'Bomba de dirección averiada', urgencia: 'Alta', costo_min: 1500, costo_max: 5000 },
    { id: 'sistema_frenos_con_aire', nombre: 'Sistema de frenos con aire', urgencia: 'Alta', costo_min: 300, costo_max: 1200 },
    { id: 'frenos_sobrecalentados', nombre: 'Frenos sobrecalentados', urgencia: 'Alta', costo_min: 400, costo_max: 2000 },
    { id: 'bobina_encendido_defectuosa', nombre: 'Bobina de encendido defectuosa', urgencia: 'Media', costo_min: 800, costo_max: 2500 },
    { id: 'sensor_oxigeno_defectuoso', nombre: 'Sensor de oxígeno defectuoso', urgencia: 'Media', costo_min: 600, costo_max: 2000 },
    { id: 'junta_homocinetica_daniada', nombre: 'Junta homocinética dañada', urgencia: 'Media', costo_min: 1200, costo_max: 3500 },
    { id: 'inyectores_sucios', nombre: 'Inyectores sucios', urgencia: 'Media', costo_min: 500, costo_max: 2000 },
    { id: 'fuga_carter_aceite', nombre: 'Fuga en cárter de aceite', urgencia: 'Media', costo_min: 300, costo_max: 1500 },
    { id: 'sellos_valvula', nombre: 'Sellos de válvula defectuosos', urgencia: 'Media', costo_min: 1000, costo_max: 3000 },
    { id: 'pastillas_freno', nombre: 'Pastillas de freno desgastadas', urgencia: 'Baja', costo_min: 400, costo_max: 1200 },
    { id: 'correa_accesorios_desgastada', nombre: 'Correa de accesorios desgastada', urgencia: 'Baja', costo_min: 400, costo_max: 1200 },
    { id: 'dilucion_aceite', nombre: 'Dilución de aceite', urgencia: 'Baja', costo_min: 300, costo_max: 800 },
    { id: 'aspas_ventilador_radiador', nombre: 'Aspas del ventilador del radiador', urgencia: 'Baja', costo_min: 300, costo_max: 900 },
    { id: 'falta_gas_refrigerante', nombre: 'Falta de gas refrigerante', urgencia: 'Baja', costo_min: 500, costo_max: 1500 },
    { id: 'llantas_desbalanceadas', nombre: 'Llantas desbalanceadas', urgencia: 'Baja', costo_min: 200, costo_max: 600 }
  ],

  reparaciones_prolog: {
    'fuga_sistema_refrigeracion': ['Inspeccionar mangueras', 'Sellar fugas', 'Rellenar anticongelante'],
    'bateria_descargada_o_alternador': ['Verificar voltaje alternador', 'Cargar batería', 'Reemplazar batería si falla'],
    'sistema_frenos_con_aire': ['Purgar líneas de freno', 'Rellenar líquido de frenos', 'Revisar pastillas'],
    'bobina_encendido_defectuosa': ['Escanear código de error', 'Cambiar bujías', 'Reemplazar bobina'],
    'bomba_direccion_averiada': ['Revisar nivel de líquido', 'Inspeccionar mangueras', 'Reemplazar bomba'],
    'sensor_oxigeno_defectuoso': ['Escanear computadora', 'Revisar cableado', 'Reemplazar sensor'],
    'embrague_desgastado': ['Revisar cable embrague', 'Purgar líquido embrague', 'Cambiar kit embrague'],
    'junta_culata_quemada': ['Medir compresión cilindros', 'Rectificar culata', 'Reemplazar junta culata'],
    'junta_homocinetica_daniada': ['Inspeccionar guardapolvos', 'Engrasar junta', 'Reemplazar junta'],
    'inyectores_sucios': ['Agregar aditivo limpiador', 'Limpieza ultrasónica', 'Calibrar inyectores'],
    'pastillas_freno': ['Verificar desgaste', 'Ajustar caliper', 'Cambiar pastillas'],
    'sellos_valvula': ['Verificar compresión', 'Ajustar válvulas', 'Cambiar sellos'],
    'dilucion_aceite': ['Reemplazar unidad control aire', 'Cambiar aceite y filtro'],
    'aspas_ventilador_radiador': ['Verificar conexión eléctrica', 'Cambiar aspas ventilador'],
    'falta_gas_refrigerante': ['Buscar fugas con UV', 'Sellar sistema AC', 'Recargar gas refrigerante'],
    'correa_accesorios_desgastada': ['Inspeccionar tensión', 'Revisar poleas', 'Reemplazar correa serpentina'],
    'llantas_desbalanceadas': ['Inspeccionar desgaste', 'Balancear llantas', 'Alinear dirección'],
    'fuga_carter_aceite': ['Limpiar zona de fuga', 'Apretar tornillos carter', 'Reemplazar empaque'],
    'falta_lubricacion_motor': ['Apagar motor inmediatamente', 'Revisar bomba de aceite'],
    'frenos_sobrecalentados': ['Dejar enfriar frenos', 'Revisar líquido de frenos'],
  },

  sintomas_confirmados: [],
};

const sectionTitle = document.getElementById('section-title');
const contentArea = document.getElementById('content-area');
const menuButtons = document.querySelectorAll('.menu-item');
const searchInput = document.getElementById('searchInput');
const topbarDate = document.getElementById('topbarDate');

topbarDate.textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

menuButtons.forEach((btn) => btn.addEventListener('click', () => setSection(btn.dataset.section)));
searchInput.addEventListener('input', (e) => { state.searchQuery = e.target.value.trim().toLowerCase(); renderSection(); });
document.getElementById('searchButton').addEventListener('click', () => { searchInput.focus(); renderSection(); });

function setSection(section) {
  state.section = section;
  menuButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.section === section));
  sectionTitle.textContent = section === 'diagnostico' ? 'Análisis de Fallas' : 'Fallas Comunes';
  renderSection();
}

function renderSection() {
  contentArea.innerHTML = '';
  if (state.section === 'diagnostico') {
    if (!state.vehiculoActual) renderPaso1Vehiculo(); else renderPaso2Sintomas();
  } else {
    renderBaseConocimiento();
  }
}

// LÓGICA DE FLUJO: VEHÍCULO
function renderPaso1Vehiculo() {
  const container = document.createElement('div');
  container.className = 'diagnostico-container';
  container.innerHTML = `
    <div class="info-card">
      <div class="card-header">
        <div><p class="card-category">Paso 1 de 2</p><h3>Registro obligatorio del vehículo</h3></div>
      </div>
      <div class="card-body">
        <p style="color: var(--muted); margin-bottom: 20px;">Identifica el vehículo. Si no conoces el modelo, escribe "gen" y año "0".</p>
        <form id="flujoVehicleForm" class="vehicle-form">
          <div class="form-grid">
            <label><span>Marca (ej: nissan, toyota, gen)</span><input name="marca" type="text" required placeholder="nissan" /></label>
            <label><span>Modelo (ej: sentra, corolla, gen)</span><input name="modelo" type="text" required placeholder="sentra" /></label>
            <label><span>Año</span><input name="anio" type="number" min="1980" max="2026" required placeholder="2015" /></label>
          </div>
          <div class="form-actions" style="margin-top: 24px; justify-content: flex-start;">
            <button class="primary-btn" type="submit">Iniciar Cuestionario</button>
          </div>
        </form>
      </div>
    </div>
  `;
  contentArea.appendChild(container);

  document.getElementById('flujoVehicleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.vehiculoActual = { marca: fd.get('marca').trim().toLowerCase(), modelo: fd.get('modelo').trim().toLowerCase(), anio: parseInt(fd.get('anio')) || 0 };
    state.sintomas_confirmados = [];
    renderSection();
  });
}

// LÓGICA DE FLUJO: SÍNTOMAS
function renderPaso2Sintomas() {
  const container = document.createElement('div');
  container.className = 'diagnostico-container';

  container.innerHTML = `
    <div class="info-card" style="margin-bottom: 24px;">
      <div class="card-header">
        <div>
          <p class="card-category">Paso 2 de 2: Cuestionario</p>
          <h3>Analizando: <span style="color: var(--primary);">${state.vehiculoActual.marca.toUpperCase()} ${state.vehiculoActual.modelo.toUpperCase()} (${state.vehiculoActual.anio})</span></h3>
        </div>
        <button class="secondary-btn" id="reiniciarBtn">Cambiar Vehículo</button>
      </div>
    </div>
  `;
  contentArea.appendChild(container);

  const query = state.searchQuery;
  const sintomasFiltrados = state.sintomas_prolog.filter(s => `${s.nombre} ${s.categoria}`.toLowerCase().includes(query));

  const categorias = {};
  sintomasFiltrados.forEach(s => { if (!categorias[s.categoria]) categorias[s.categoria] = []; categorias[s.categoria].push(s); });

  const grid = document.createElement('div');
  grid.className = 'content-area';

  if (Object.keys(categorias).length === 0) {
    grid.innerHTML = `<div class="info-card"><div class="card-body"><p style="color:var(--muted)">No encontramos ese síntoma. Intenta buscar usando términos más generales como 'ruido', 'humo' o 'freno'.</p></div></div>`;
  } else {
    Object.entries(categorias).forEach(([cat, sList]) => {
      const section = document.createElement('div');
      section.className = 'info-card';
      section.innerHTML = `
        <div class="card-header"><h3>${cat}</h3></div>
        <div class="card-body"><div class="sintomas-checklist">
          ${sList.map(s => `<label class="checkbox-item"><input type="checkbox" data-id="${s.id}" ${state.sintomas_confirmados.includes(s.id)?'checked':''}><span>${s.nombre}</span></label>`).join('')}
        </div></div>
      `;
      grid.appendChild(section);
    });
  }

  container.appendChild(grid);
  document.getElementById('reiniciarBtn').addEventListener('click', () => { state.vehiculoActual = null; state.sintomas_confirmados = []; renderSection(); });

  setTimeout(() => {
    container.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.id;
        if (chk.checked) state.sintomas_confirmados.push(id);
        else state.sintomas_confirmados = state.sintomas_confirmados.filter(s => s !== id);
        renderResultadosAsync();
      });
    });
  }, 0);

  if (state.sintomas_confirmados.length > 0) renderResultadosAsync();
}

// CONEXIÓN CON EL SERVIDOR PROLOG (MÉTODO 1)
async function renderResultadosAsync() {
  let resDiv = contentArea.querySelector('.diagnostico-resultados');
  if (resDiv) resDiv.remove();
  if (state.sintomas_confirmados.length === 0) return;

  const container = document.createElement('div');
  container.className = 'diagnostico-resultados';
  container.style.marginTop = '24px';
  container.innerHTML = `<div class="info-card"><div class="card-body"><p>Conectando con el motor de Prolog...</p></div></div>`;
  contentArea.appendChild(container);

  let fallasProcesadas = [];
  try {
    // Intentar conectarse al servidor HTTP nativo de SWI-Prolog
    const res = await fetch('http://localhost:8000/api/diagnostico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marca: state.vehiculoActual.marca,
        modelo: state.vehiculoActual.modelo,
        anio: state.vehiculoActual.anio,
        sintomas: state.sintomas_confirmados
      })
    });
    if (!res.ok) throw new Error('Servidor apagado');
    const data = await res.json();
    fallasProcesadas = mapPrologToJS(data.fallas);
  } catch (e) {
    // Si olvidaste escribir 'server.' en Prolog, usa el motor de emergencia en JS
    console.warn("Servidor Prolog no detectado. Usando inferencia local.");
    fallasProcesadas = inferenciaLocalJS(state.sintomas_confirmados);
  }

  // Renderizar las cartas
  container.innerHTML = `
    <div class="info-card"><div class="card-header"><div><p class="card-category">Síntomas confirmados: ${state.sintomas_confirmados.length}</p><h3>Posibles fallas detectadas</h3></div></div>
    <div class="card-body">
      ${fallasProcesadas.length === 0 ? '<p>No se encontraron fallas asociadas.</p>' : `
        <div class="cards-grid">
          ${fallasProcesadas.map(f => `
            <article class="info-card">
              <div class="card-header"><div><p class="card-category">Falla Inferida</p><h3>${f.nombre}</h3></div><span class="badge ${f.urgencia === 'Crítica' || f.urgencia === 'Alta' ? 'high' : f.urgencia === 'Media' ? 'medium' : 'low'}">${f.urgencia}</span></div>
              <div class="card-body">
                <div class="card-section"><h4>Costo estimado</h4><p>$${f.costo_min} - $${f.costo_max} MXN</p></div>
                ${f.reparaciones_prolog.length > 0 ? `<div class="card-section"><h4>Pasos de reparación</h4><ul class="solutions-list">${f.reparaciones_prolog.map(p => `<li>${p}</li>`).join('')}</ul></div>` : ''}
              </div>
            </article>
          `).join('')}
        </div>
      `}
    </div></div>
  `;
}

// Funciones Auxiliares
function mapPrologToJS(fallasDesdeProlog) {
  return fallasDesdeProlog.map(f => {
    let base = state.fallas_prolog.find(x => x.id === f.id);
    let urg = f.urgencia === 'critica' ? 'Crítica' : f.urgencia === 'alta' ? 'Alta' : f.urgencia === 'media' ? 'Media' : f.urgencia === 'baja' ? 'Baja' : 'Desconocida';
    return {
      id: f.id,
      nombre: base ? base.nombre : f.id.replace(/_/g, ' '),
      urgencia: urg,
      costo_min: f.costo_min,
      costo_max: f.costo_max,
      reparaciones_prolog: (f.reparaciones || []).map(r => r.replace(/_/g, ' '))
    };
  });
}

// MOTOR DE EMERGENCIA EN JS: réplica fiel de las reglas del Prolog
// (se usa solo cuando el servidor SWI-Prolog está apagado)

const reglasInferencia = [
  // Reglas complejas (requieren los 2 síntomas)
  { falla: 'fuga_sistema_refrigeracion', req: ['sobrecalentamiento', 'nivel_bajo_anticongelante'], certeza: 0.92 },
  { falla: 'bateria_descargada_o_alternador', req: ['motor_no_gira', 'luces_debiles'], certeza: 0.90 },
  { falla: 'bobina_encendido_defectuosa', req: ['falla_encendido', 'perdida_potencia'], certeza: 0.88 },
  { falla: 'bomba_direccion_averiada', req: ['volante_duro', 'fuga_liquido_direccion'], certeza: 0.90 },
  { falla: 'sensor_oxigeno_defectuoso', req: ['luz_check_engine', 'consumo_excesivo_combustible'], certeza: 0.87 },
  { falla: 'embrague_desgastado', req: ['marchas_resbalan', 'pedal_embrague_suelto'], certeza: 0.88 },
  { falla: 'junta_culata_quemada', req: ['humo_blanco_escape', 'sobrecalentamiento'], certeza: 0.93 },
  { falla: 'junta_homocinetica_daniada', req: ['ruido_clac_clac_girar', 'vibracion_volante_alta_vel'], certeza: 0.89 },
  { falla: 'inyectores_sucios', req: ['humo_negro_escape', 'tirones_al_acelerar'], certeza: 0.86 },
  { falla: 'falta_lubricacion_motor', req: ['ruido_metalico_motor', 'charco_aceite_motor'], certeza: 0.91 },
  // Complementos simples (1 síntoma)
  { falla: 'fuga_sistema_refrigeracion', req: ['sobrecalentamiento'], certeza: 0.60 },
  { falla: 'bateria_descargada_o_alternador', req: ['motor_no_gira'], certeza: 0.55 },
  { falla: 'bobina_encendido_defectuosa', req: ['falla_encendido'], certeza: 0.55 },
  { falla: 'bomba_direccion_averiada', req: ['volante_duro'], certeza: 0.60 },
  { falla: 'sensor_oxigeno_defectuoso', req: ['luz_check_engine'], certeza: 0.55 },
  { falla: 'embrague_desgastado', req: ['marchas_resbalan'], certeza: 0.58 },
  { falla: 'junta_culata_quemada', req: ['humo_blanco_escape'], certeza: 0.62 },
  { falla: 'junta_homocinetica_daniada', req: ['ruido_clac_clac_girar'], certeza: 0.57 },
  { falla: 'inyectores_sucios', req: ['humo_negro_escape'], certeza: 0.55 },
  { falla: 'falta_lubricacion_motor', req: ['ruido_metalico_motor'], certeza: 0.65 },
  // Reglas simples (1 síntoma; frenos con negación para distinguir pastillas vs aire)
  { falla: 'sistema_frenos_con_aire', req: ['chirrido_al_frenar', 'pedal_freno_esponjoso'], certeza: 0.87 },
  { falla: 'pastillas_freno', req: ['chirrido_al_frenar'], excluir: ['pedal_freno_esponjoso'], certeza: 0.72 },
  { falla: 'sellos_valvula', req: ['humo_azul'], certeza: 0.75 },
  { falla: 'dilucion_aceite', req: ['olor_gasolina_bayeta'], certeza: 0.73 },
  { falla: 'aspas_ventilador_radiador', req: ['vibracion_encendido_aire'], certeza: 0.70 },
  { falla: 'falta_gas_refrigerante', req: ['aire_acondicionado_no_enfria'], certeza: 0.78 },
  { falla: 'correa_accesorios_desgastada', req: ['ruido_correa_acelerar'], certeza: 0.76 },
  { falla: 'llantas_desbalanceadas', req: ['vibracion_volante_alta_vel'], certeza: 0.70 },
  { falla: 'fuga_carter_aceite', req: ['charco_aceite_motor'], certeza: 0.80 },
  { falla: 'frenos_sobrecalentados', req: ['olor_quemado_llantas'], certeza: 0.77 },
];

// Mismo criterio apply_a/4 del Prolog: el embrague solo aplica a transmisión manual
// por modelo y rango de año. El resto de fallas aplican a cualquier vehículo.
const modelosManuales = {
  'nissan':     { 'sentra': [1990, 2012] },
  'volkswagen': { 'jetta': [1990, 2025], 'golf': [1990, 2025] },
  'honda':      { 'civic': [1990, 2025], 'accord': [1990, 2025] },
  'toyota':     { 'corolla': [1990, 2020], 'camry': [1990, 2017] },
  'ford':       { 'focus': [2000, 2018], 'fiesta': [2000, 2019] },
  'chevrolet':  { 'aveo': [2004, 2022], 'trax': [2013, 2022] },
  'mazda':      { '3': [2003, 2025], 'mx5': [1990, 2025] },
  'hyundai':    { 'accent': [1995, 2025] },
  'kia':        { 'rio': [2000, 2025] },
  'mitsubishi': { 'lancer': [1990, 2017] },
  'subaru':     { 'impreza': [1992, 2025], 'wrx': [2002, 2025] },
  'seat':       { 'ibiza': [1993, 2025] },
  'renault':    { 'clio': [1990, 2025] },
  'peugeot':    { '206': [1998, 2012], '208': [2012, 2025] },
};

function aplicaFalla(fallaId, marca, modelo, anio) {
  if (fallaId !== 'embrague_desgastado') return true;
  if (marca === 'gen' && modelo === 'gen') return true;
  const rango = modelosManuales[marca] ? modelosManuales[marca][modelo] : undefined;
  if (!rango) return false;
  return anio === 0 || (anio >= rango[0] && anio <= rango[1]);
}

function inferenciaLocalJS(sintomas) {
  const { marca, modelo, anio } = state.vehiculoActual;
  const mejores = {};
  reglasInferencia.forEach((r) => {
    if (!r.req.every((s) => sintomas.includes(s))) return;
    if (r.excluir && r.excluir.some((s) => sintomas.includes(s))) return;
    if (!aplicaFalla(r.falla, marca, modelo, anio)) return;
    if (!(mejores[r.falla] > r.certeza)) mejores[r.falla] = r.certeza;
  });
  return Object.keys(mejores)
    .sort((a, b) => mejores[b] - mejores[a])
    .map((fallaId) => {
      let falla = state.fallas_prolog.find((f) => f.id === fallaId);
      return { ...falla, reparaciones_prolog: (state.reparaciones_prolog[fallaId] || []).map((r) => r.replace(/_/g, ' ')) };
    });
}

function renderBaseConocimiento() {
  const query = state.searchQuery;
  const filtradas = state.fallas_prolog.filter(f => `${f.nombre} ${f.urgencia}`.toLowerCase().includes(query));
  const container = document.createElement('div'); container.className = 'knowledge-grid';
  if (filtradas.length === 0) { container.innerHTML = `<div class="info-card"><div class="card-body"><p>No se encontraron fallas.</p></div></div>`; }
  else {
    filtradas.forEach(f => {
      const urgClass = f.urgencia === 'Crítica' || f.urgencia === 'Alta' ? 'high' : f.urgencia === 'Media' ? 'medium' : 'low';
      const card = document.createElement('article'); card.className = 'info-card common-falla-card';
      card.innerHTML = `<div class="card-header"><div><p class="card-category">Falla</p><h3>${f.nombre}</h3></div><span class="badge ${urgClass}">${f.urgencia}</span></div><div class="card-body"><div class="card-section"><h4>Causas/Pasos</h4><ul>${(state.reparaciones_prolog[f.id]||['Sin datos']).map(p=>`<li>${p.replace(/_/g, ' ')}</li>`).join('')}</ul></div><div class="card-footer"><span>Costo</span><strong>$${f.costo_min} - $${f.costo_max}</strong></div></div>`;
      container.appendChild(card);
    });
  }
  contentArea.appendChild(container);
}

setSection('diagnostico');