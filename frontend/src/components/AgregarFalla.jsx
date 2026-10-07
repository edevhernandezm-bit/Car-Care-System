import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useCatalogosIngeniero } from '../hooks/useCatalogosIngeniero.js';
import { apiFetch } from '../lib/api.js';
import { FALLA_VACIA, fallaAPayload, validarFalla } from '../lib/fallas.js';
import FallaForm from './FallaForm.jsx';

// El alta usa el MISMO formulario que la edicion (FallaForm): dos formularios
// duplicados es como reaparecio el bug de validar solo el cuerpo del PUT. La
// unica diferencia es el POST y el reset al exito.
export default function AgregarFalla() {
  const { catalogos, status } = useCatalogosIngeniero();
  const queryClient = useQueryClient();

  const [valor, setValor] = useState(FALLA_VACIA);
  const [errores, setErrores] = useState({});
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(false);
  const [generalError, setGeneralError] = useState('');

  const motorDisponible = status !== 'error' && catalogos.sintomas.length > 0;

  function cambiarValor(siguiente) {
    setValor(siguiente);
    setErrores({});
    setEnviado(false);
    setExito(false);
    setGeneralError('');
  }

  async function guardarNueva(e) {
    e.preventDefault();
    setExito(false);
    setGeneralError('');
    setEnviando(true);

    const encontrados = validarFalla(valor);
    setErrores(encontrados);
    if (Object.keys(encontrados).length > 0) {
      // FallaForm mueve el foco al resumen de errores cuando `enviado` llega
      // con errores, tambien cuando no sale del formulario por un PUT.
      setEnviado(true);
      setEnviando(false);
      return;
    }

    try {
      await apiFetch('/api/fallas', {
        method: 'POST',
        body: JSON.stringify(fallaAPayload(valor)),
      });
      setValor(FALLA_VACIA);
      setErrores({});
      setExito(true);
      // El sintoma nuevo queda en el catalogo del motor: se invalida la query
      // para que el checklist vuelva a leerlo. El backend sincroniza a Prolog
      // sin esperar, asi que el primer refresco puede no traerlo todavia.
      queryClient.invalidateQueries({ queryKey: ['catalogos', 'ingeniero'] });
    } catch (err) {
      setGeneralError(`No se pudo guardar: ${err.message}`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="diagnostico-container">
      <section className="info-card">
        <div className="card-header">
          <div>
            <p className="card-category">Captura de conocimiento</p>
            <h3>Agregar nueva falla</h3>
          </div>
        </div>
        <div className="card-body">
          {generalError && (
            <p className="field-error" role="alert">
              {generalError}
            </p>
          )}

          {exito && (
            <p className="confianza-chip confianza-alta" role="status">
              Falla registrada exitosamente.
            </p>
          )}

          {status === 'pending' ? (
            <p className="text-muted">Cargando catálogos...</p>
          ) : !motorDisponible ? (
            <p className="text-muted">
              El catálogo de síntomas aún no está disponible. Verifique que el motor
              de Prolog esté corriendo.
            </p>
          ) : (
            <FallaForm
              valor={valor}
              errores={errores}
              enviado={enviado}
              sintomasCatalogo={catalogos.sintomas}
              onCambio={cambiarValor}
              onEnviar={guardarNueva}
              textoEnviar={enviando ? 'Guardando...' : 'Guardar falla'}
            />
          )}
        </div>
      </section>
    </div>
  );
}
