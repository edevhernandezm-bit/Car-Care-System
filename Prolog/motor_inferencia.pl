:- encoding(utf8).

% ==========================================================================
% SISTEMA EXPERTO - TALLER AUTOMOTRIZ  v3.0
% ==========================================================================
% Version consolidada del motor original (v2.1). Cambios principales:
%   1. Tipo de transmision como parametro real (aplica_a/5, vehiculo_actual/4).
%      Es OPCIONAL en la API: si no llega, vale 'desconocida' y el sistema se
%      comporta como antes (no oculta ninguna falla).
%   2. Se integran 34 fallas documentadas por marca/modelo/anio/transmision
%      (investigacion del Excel base_datos_fallas_automotrices.xlsx), con su
%      fuente y su nivel de confianza del dato (fuente_falla/2, confianza_dato/2).
%   3. Combinacion de evidencia (estilo MYCIN) entre reglas INDEPENDIENTES en
%      lugar de descartar todo salvo el maximo. Las reglas subsumidas (cuyos
%      sintomas ya estan contenidos en otra regla disparada) no se cuentan dos
%      veces.
%   4. Explicacion trazable: cada falla informa que sintomas confirmados la
%      respaldan (sintomas_relacionados) ademas del texto explicativo.
%   5. Moneda explicita en los costos: costo(Min, Max, Moneda) (mxn | usd).
%   6. validar_kb/0: verifica consistencia de la base de conocimiento.
%   7. Historial de diagnosticos en memoria + endpoint GET /api/historial.
%   8. Robustez HTTP: exclusion mutua entre peticiones, normalizacion de
%      marca/modelo/anio/transmision (incluye modelos numericos como 3, 206,
%      1500) y campos faltantes con valores por defecto.
%   9. Se evalua aplica_a ANTES de las reglas: en consola ya no se preguntan
%      sintomas de fallas que no aplican al vehiculo.
%
% Compatibilidad con frontend/backend: se conservan las rutas
% /api/diagnostico (POST), /api/sintomas (GET) y /api/fallas (GET) y todos
% los campos JSON que ya existian. Solo se AGREGAN campos nuevos.
% ==========================================================================

% --- MEMORIA DINÁMICA ---
:- dynamic conocido/3.
:- dynamic vehiculo_actual/4.          % (Marca, Modelo, Anio, Transmision)
:- dynamic sintomas_confirmados/1.
:- dynamic modo_http/0.
:- dynamic historial_diagnostico/1.

% --- CONOCIMIENTO DINÁMICO (Fallas registradas por usuario) ---
:- dynamic falla/2.
:- dynamic nombre_falla/2.
:- dynamic meta_falla/3.
:- dynamic reparacion/2.
:- dynamic nombre_reparacion/2.
:- dynamic fuente_falla/2.
:- dynamic confianza_dato/2.
:- dynamic aplica_a/5.
:- dynamic explicacion/1.
:- dynamic sintoma/1.
:- dynamic nombre_sintoma/2.
:- dynamic categoria_sintoma/2.
% Marcador para fallas dinámicas de usuario (separación sistema/usuario)
:- dynamic falla_usuario/1.
:- dynamic sintoma_usuario/1.
% Causas de una falla dinámica: las declara Mongo pero el motor las necesita para
% devolverlas en el diagnóstico. La base estática no las modela, así que se
% degradan a lista vacía al construir el diccionario.
:- dynamic causa_falla/2.
:- dynamic observaciones_falla/2.

:- use_module(library(lists)).


% ==========================================
% COMPATIBILIDAD DE VEHÍCULOS (aplica_a/5)
% aplica_a(Falla, Marca, Modelo, Anio, TransmisionRequerida)
%   TransmisionRequerida: manual | automatica | cvt | dct | cualquiera
% ==========================================

% Fallas genericas: aplican a cualquier vehiculo y transmision.
aplica_a(pastillas_freno, _, _, _, cualquiera).
aplica_a(sellos_valvula, _, _, _, cualquiera).
aplica_a(bateria_descargada_o_alternador, _, _, _, cualquiera).
aplica_a(fuga_sistema_refrigeracion, _, _, _, cualquiera).
aplica_a(sistema_frenos_con_aire, _, _, _, cualquiera).
aplica_a(bobina_encendido_defectuosa, _, _, _, cualquiera).
aplica_a(bomba_direccion_averiada, _, _, _, cualquiera).
aplica_a(sensor_oxigeno_defectuoso, _, _, _, cualquiera).
aplica_a(junta_culata_quemada, _, _, _, cualquiera).
aplica_a(inyectores_sucios, _, _, _, cualquiera).
aplica_a(dilucion_aceite, _, _, _, cualquiera).
aplica_a(aspas_ventilador_radiador, _, _, _, cualquiera).
aplica_a(falta_gas_refrigerante, _, _, _, cualquiera).
aplica_a(correa_accesorios_desgastada, _, _, _, cualquiera).
aplica_a(llantas_desbalanceadas, _, _, _, cualquiera).
aplica_a(fuga_carter_aceite, _, _, _, cualquiera).
aplica_a(frenos_sobrecalentados, _, _, _, cualquiera).
aplica_a(falta_lubricacion_motor, _, _, _, cualquiera).
aplica_a(junta_homocinetica_daniada, _, _, _, cualquiera).

% Embrague: solo aplica a transmision MANUAL (corrige el caso de Focus/Fiesta
% con caja automatizada PowerShift, que no tienen pedal de embrague).
aplica_a(embrague_desgastado, nissan, sentra, Anio, manual) :- Anio >= 1990, Anio =< 2012.
aplica_a(embrague_desgastado, volkswagen, jetta, Anio, manual) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, volkswagen, golf, Anio, manual) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, honda, civic, Anio, manual) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, honda, accord, Anio, manual) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, toyota, corolla, Anio, manual) :- Anio >= 1990, Anio =< 2020.
aplica_a(embrague_desgastado, toyota, camry, Anio, manual) :- Anio >= 1990, Anio =< 2017.
aplica_a(embrague_desgastado, ford, focus, Anio, manual) :- Anio >= 2000, Anio =< 2018.
aplica_a(embrague_desgastado, ford, fiesta, Anio, manual) :- Anio >= 2000, Anio =< 2019.
aplica_a(embrague_desgastado, chevrolet, aveo, Anio, manual) :- Anio >= 2004, Anio =< 2022.
aplica_a(embrague_desgastado, chevrolet, trax, Anio, manual) :- Anio >= 2013, Anio =< 2022.
aplica_a(embrague_desgastado, mazda, 3, Anio, manual) :- Anio >= 2003, Anio =< 2025.
aplica_a(embrague_desgastado, mazda, mx5, Anio, manual) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, hyundai, accent, Anio, manual) :- Anio >= 1995, Anio =< 2025.
aplica_a(embrague_desgastado, kia, rio, Anio, manual) :- Anio >= 2000, Anio =< 2025.
aplica_a(embrague_desgastado, mitsubishi, lancer, Anio, manual) :- Anio >= 1990, Anio =< 2017.
aplica_a(embrague_desgastado, subaru, impreza, Anio, manual) :- Anio >= 1992, Anio =< 2025.
aplica_a(embrague_desgastado, subaru, wrx, Anio, manual) :- Anio >= 2002, Anio =< 2025.
aplica_a(embrague_desgastado, seat, ibiza, Anio, manual) :- Anio >= 1993, Anio =< 2025.
aplica_a(embrague_desgastado, renault, clio, Anio, manual) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, peugeot, 206, Anio, manual) :- Anio >= 1998, Anio =< 2012.
aplica_a(embrague_desgastado, peugeot, 208, Anio, manual) :- Anio >= 2012, Anio =< 2025.
aplica_a(embrague_desgastado, gen, gen, _, manual).

% Fallas documentadas por modelo (fuente: Excel de investigacion).
% cvt_nissan_altima
aplica_a(cvt_nissan_altima, nissan, altima, Anio, cvt) :- Anio >= 2013, Anio =< 2018.
% cvt_nissan_sentra
aplica_a(cvt_nissan_sentra, nissan, sentra, Anio, cvt) :- Anio >= 2013, Anio =< 2019.
% cvt_nissan_rogue
aplica_a(cvt_nissan_rogue, nissan, rogue, Anio, cvt) :- Anio >= 2014, Anio =< 2018.
% cvt_nissan_pathfinder
aplica_a(cvt_nissan_pathfinder, nissan, pathfinder, Anio, cvt) :- Anio >= 2013, Anio =< 2015.
% cvt_nissan_murano
aplica_a(cvt_nissan_murano, nissan, murano, Anio, cvt) :- Anio >= 2015, Anio =< 2019.
% dct_ford_focus_powershift
aplica_a(dct_ford_focus_powershift, ford, focus, Anio, dct) :- Anio >= 2012, Anio =< 2016.
% dct_ford_fiesta_powershift
aplica_a(dct_ford_fiesta_powershift, ford, fiesta, Anio, dct) :- Anio >= 2011, Anio =< 2016.
% motor_theta2_hyundai_sonata
aplica_a(motor_theta2_hyundai_sonata, hyundai, sonata, Anio, cualquiera) :- Anio >= 2011, Anio =< 2012.
% motor_theta2_hyundai_santafe
aplica_a(motor_theta2_hyundai_santafe, hyundai, santa_fe_sport, Anio, cualquiera) :- Anio >= 2013, Anio =< 2014.
% motor_theta2_kia_optima
aplica_a(motor_theta2_kia_optima, kia, optima, Anio, cualquiera) :- Anio >= 2011, Anio =< 2014.
% motor_theta2_kia_sportage
aplica_a(motor_theta2_kia_sportage, kia, sportage, Anio, cualquiera) :- Anio >= 2011, Anio =< 2013.
% dsg_vw_jetta
aplica_a(dsg_vw_jetta, volkswagen, jetta, Anio, dct) :- Anio >= 2009, Anio =< 2014.
% dsg_vw_golf
aplica_a(dsg_vw_golf, volkswagen, golf, Anio, dct) :- Anio >= 2010, Anio =< 2017.
% dsg_vw_passat
aplica_a(dsg_vw_passat, volkswagen, passat, Anio, dct) :- Anio >= 2006, Anio =< 2015.
% zf8_jeep_grandcherokee
aplica_a(zf8_jeep_grandcherokee, jeep, grand_cherokee, Anio, automatica) :- Anio >= 2014, Anio =< 2015.
% zf9_jeep_cherokee
aplica_a(zf9_jeep_cherokee, jeep, cherokee, Anio, automatica) :- Anio >= 2014, Anio =< 2016.
% zf9_chrysler_200
aplica_a(zf9_chrysler_200, chrysler, 200, Anio, automatica) :- Anio >= 2015, Anio =< 2016.
% cadena_bmw_n20
aplica_a(cadena_bmw_n20, bmw, '328i', Anio, cualquiera) :- Anio >= 2012, Anio =< 2015.
aplica_a(cadena_bmw_n20, bmw, x1, Anio, cualquiera) :- Anio >= 2012, Anio =< 2015.
aplica_a(cadena_bmw_n20, bmw, x3, Anio, cualquiera) :- Anio >= 2012, Anio =< 2015.
% auto_722_mercedes_clasec
aplica_a(auto_722_mercedes_clasec, 'mercedes-benz', clase_c, Anio, automatica) :- Anio >= 2001, Anio =< 2007.
% cvt_subaru_legacy_outback
aplica_a(cvt_subaru_legacy_outback, subaru, legacy, Anio, cvt) :- Anio >= 2010, Anio =< 2014.
aplica_a(cvt_subaru_legacy_outback, subaru, outback, Anio, cvt) :- Anio >= 2010, Anio =< 2014.
% cvt_subaru_forester
aplica_a(cvt_subaru_forester, subaru, forester, Anio, cvt) :- Anio >= 2014, Anio =< 2015.
% culata_subaru_ej25
aplica_a(culata_subaru_ej25, subaru, legacy, Anio, cualquiera) :- Anio >= 1999, Anio =< 2012.
aplica_a(culata_subaru_ej25, subaru, outback, Anio, cualquiera) :- Anio >= 1999, Anio =< 2012.
aplica_a(culata_subaru_ej25, subaru, forester, Anio, cualquiera) :- Anio >= 1999, Anio =< 2012.
% auto_honda_accord_v6
aplica_a(auto_honda_accord_v6, honda, accord, Anio, automatica) :- Anio >= 2003, Anio =< 2007.
% cvt_honda_accord_crv
aplica_a(cvt_honda_accord_crv, honda, accord, Anio, cvt) :- Anio >= 2018, Anio =< 2019.
aplica_a(cvt_honda_accord_crv, honda, 'cr-v', Anio, cvt) :- Anio >= 2018, Anio =< 2019.
% auto6t40_chevrolet_malibu
aplica_a(auto6t40_chevrolet_malibu, chevrolet, malibu, Anio, automatica) :- Anio >= 2013, Anio =< 2015.
% refrigerante_chevrolet_cruze
aplica_a(refrigerante_chevrolet_cruze, chevrolet, cruze, Anio, cualquiera) :- Anio >= 2011, Anio =< 2015.
% cvt_mitsubishi_lancer_outlander
aplica_a(cvt_mitsubishi_lancer_outlander, mitsubishi, lancer, Anio, cvt) :- Anio >= 2014, Anio =< 2017.
aplica_a(cvt_mitsubishi_lancer_outlander, mitsubishi, outlander, Anio, cvt) :- Anio >= 2014, Anio =< 2017.
% multitronic_audi_a4a6
aplica_a(multitronic_audi_a4a6, audi, a4, Anio, cvt) :- Anio >= 2002, Anio =< 2008.
aplica_a(multitronic_audi_a4a6, audi, a6, Anio, cvt) :- Anio >= 2002, Anio =< 2008.
% aceite_toyota_2azfe
aplica_a(aceite_toyota_2azfe, toyota, camry, Anio, cualquiera) :- Anio >= 2007, Anio =< 2009.
aplica_a(aceite_toyota_2azfe, toyota, corolla, Anio, cualquiera) :- Anio >= 2007, Anio =< 2009.
% zf8_ram_1500
aplica_a(zf8_ram_1500, ram, 1500, Anio, automatica) :- Anio >= 2013, Anio =< 2018.
% suspension_landrover_discovery
aplica_a(suspension_landrover_discovery, land_rover, discovery, Anio, cualquiera) :- Anio >= 2005, Anio =< 2016.
aplica_a(suspension_landrover_discovery, land_rover, range_rover_sport, Anio, cualquiera) :- Anio >= 2005, Anio =< 2016.
% zf9_landrover_discoverysport
aplica_a(zf9_landrover_discoverysport, land_rover, discovery_sport, Anio, automatica) :- Anio >= 2015, Anio =< 2019.
aplica_a(zf9_landrover_discoverysport, land_rover, evoque, Anio, automatica) :- Anio >= 2015, Anio =< 2019.
% dct_hyundai_elantra
aplica_a(dct_hyundai_elantra, hyundai, elantra, Anio, dct) :- Anio >= 2013, Anio =< 2016.
aplica_a(dct_hyundai_elantra, hyundai, veloster, Anio, dct) :- Anio >= 2013, Anio =< 2016.
% zf8_chrysler300_dodgecharger
aplica_a(zf8_chrysler300_dodgecharger, chrysler, 300, Anio, automatica) :- Anio >= 2014, Anio =< 2018.
aplica_a(zf8_chrysler300_dodgecharger, dodge, charger, Anio, automatica) :- Anio >= 2014, Anio =< 2018.

% Una transmision es compatible si la falla no la exige (cualquiera), si el
% usuario no la conoce (desconocida => permisivo, no se oculta ninguna falla)
% o si coinciden exactamente.
transmision_compatible(cualquiera, _) :- !.
transmision_compatible(_, desconocida) :- !.
transmision_compatible(T, T).

aplica_vehiculo(Falla, Marca, Modelo, Anio, Transmision) :-
    aplica_a(Falla, Marca, Modelo, Anio, Requerida),
    transmision_compatible(Requerida, Transmision).

% Año desconocido: `normalizar_anio/2` deja 0 cuando el dato no llega, y 0 no
% es un año real, así que sirve de centinela. Sin esta cláusula las fallas con
% rango de año desaparecerían del diagnóstico de quien no conoce su año, que es
% justo lo contrario de la política permisiva de la línea anterior.
%
% Se usa `clause/2` y no una llamada directa porque `clause/2` entrega la
% cabecera SIN ejecutar el cuerpo: así se leen marca, modelo y transmisión de la
% cabeza y se saltan los guards `Anio >= Min, Anio =< Max`. Marca y modelo
% siguen teniendo que coincidir; solo el año se perdona.
aplica_vehiculo(Falla, Marca, Modelo, Anio, Transmision) :-
    Anio == 0,
    !,
    clause(aplica_a(Falla, Marca, Modelo, _, Requerida), _),
    transmision_compatible(Requerida, Transmision).

% --- Normalizacion de datos de entrada (consola y HTTP) ---
normalizar_transmision(Entrada, Trans) :-
    (   ( atom(Entrada) ; string(Entrada) )
    ->  atom_string(Atomo, Entrada),
        downcase_atom(Atomo, Min),
        (   sinonimo_transmision(Min, T) -> Trans = T ; Trans = desconocida )
    ;   Trans = desconocida
    ).

sinonimo_transmision(manual, manual).
sinonimo_transmision(estandar, manual).
sinonimo_transmision('estándar', manual).
sinonimo_transmision(mecanica, manual).
sinonimo_transmision('mecánica', manual).
sinonimo_transmision(automatica, automatica).
sinonimo_transmision('automática', automatica).
sinonimo_transmision(automatico, automatica).
sinonimo_transmision('automático', automatica).
sinonimo_transmision(at, automatica).
sinonimo_transmision(tiptronic, automatica).
sinonimo_transmision(cvt, cvt).
sinonimo_transmision(dct, dct).
sinonimo_transmision(dsg, dct).
sinonimo_transmision(powershift, dct).
sinonimo_transmision(doble_embrague, dct).
sinonimo_transmision(desconocida, desconocida).
sinonimo_transmision(desconocido, desconocida).
sinonimo_transmision(gen, desconocida).
sinonimo_transmision(null, desconocida).
sinonimo_transmision('', desconocida).

% Marca/modelo desde texto (JSON): minusculas, espacios -> '_', y numeros
% puros como entero (para coincidir con modelos como 3, 206, 1500).
normalizar_identificador(In, Id) :-
    (   number(In)
    ->  Id = In
    ;   atom_string(A0, In),
        downcase_atom(A0, A1),
        atomic_list_concat(Partes, ' ', A1),
        atomic_list_concat(Partes, '_', A2),
        (   atom_number(A2, N), integer(N) -> Id = N ; Id = A2 )
    ).

normalizar_anio(A, N) :-
    (   number(A)
    ->  N = A
    ;   ( atom(A) ; string(A) ),
        atom_string(At, A),
        atom_number(At, N0),
        number(N0)
    ->  N = N0
    ;   N = 0
    ).



% MOTOR DE PREGUNTAS
preguntar(Atributo, Valor) :- conocido(s, Atributo, Valor), !.
preguntar(Atributo, Valor) :- conocido(n, Atributo, Valor), !, fail.
preguntar(_, _) :- modo_http, !, fail. % En el servidor web no se pregunta: síntoma no confirmado => falso
preguntar(Atributo, Valor) :-
    format('¿El vehiculo presenta: ~w? (s/n): ', [Valor]),
    leer_seguro(Respuesta, [s, n]),
    asserta(conocido(Respuesta, Atributo, Valor)),
    (Respuesta == s -> registrar_sintoma(Valor) ; true),
    Respuesta == s.

% Validación
leer_seguro(Val, Validos) :-
    read(R),
    (es_miembro(R, Validos) ->
        Val = R
    ;
        format('  [!] Entrada no valida. Ingrese uno de: ~w~n', [Validos]),
        leer_seguro(Val, Validos)
    ).

es_miembro(X, [X|_]) :- !.
es_miembro(X, [_|T]) :- es_miembro(X, T).

registrar_sintoma(S) :-
    retract(sintomas_confirmados(Lista)),
    (es_miembro(S, Lista) ->
        asserta(sintomas_confirmados(Lista))
    ;
        asserta(sintomas_confirmados([S|Lista]))
    ).


% SÍNTOMAS
sintoma(chirrido_al_frenar)          :- preguntar(sintoma, chirrido_al_frenar).
sintoma(humo_azul)                   :- preguntar(sintoma, humo_azul).
sintoma(motor_no_gira)               :- preguntar(sintoma, motor_no_gira).
sintoma(luces_debiles)               :- preguntar(sintoma, luces_debiles).
sintoma(falla_encendido)             :- preguntar(sintoma, falla_encendido).
sintoma(perdida_potencia)            :- preguntar(sintoma, perdida_potencia).
sintoma(olor_gasolina_bayeta)        :- preguntar(sintoma, olor_gasolina_bayeta).
sintoma(vibracion_encendido_aire)    :- preguntar(sintoma, vibracion_encendido_aire).
sintoma(sobrecalentamiento)          :- preguntar(sintoma, sobrecalentamiento).
sintoma(nivel_bajo_anticongelante)   :- preguntar(sintoma, nivel_bajo_anticongelante).
sintoma(pedal_freno_esponjoso)       :- preguntar(sintoma, pedal_freno_esponjoso).
sintoma(volante_duro)                :- preguntar(sintoma, volante_duro).
sintoma(fuga_liquido_direccion)      :- preguntar(sintoma, fuga_liquido_direccion).
sintoma(luz_check_engine)            :- preguntar(sintoma, luz_check_engine).
sintoma(consumo_excesivo_combustible):- preguntar(sintoma, consumo_excesivo_combustible).
sintoma(marchas_resbalan)            :- preguntar(sintoma, marchas_resbalan).
sintoma(pedal_embrague_suelto)       :- preguntar(sintoma, pedal_embrague_suelto).
sintoma(humo_blanco_escape)          :- preguntar(sintoma, humo_blanco_escape).
sintoma(ruido_clac_clac_girar)       :- preguntar(sintoma, ruido_clac_clac_girar).
sintoma(humo_negro_escape)           :- preguntar(sintoma, humo_negro_escape).
sintoma(tirones_al_acelerar)         :- preguntar(sintoma, tirones_al_acelerar).
sintoma(aire_acondicionado_no_enfria):- preguntar(sintoma, aire_acondicionado_no_enfria).
sintoma(ruido_correa_acelerar)       :- preguntar(sintoma, ruido_correa_acelerar).
sintoma(vibracion_volante_alta_vel)  :- preguntar(sintoma, vibracion_volante_alta_vel).
sintoma(charco_aceite_motor)         :- preguntar(sintoma, charco_aceite_motor).
sintoma(olor_quemado_llantas)        :- preguntar(sintoma, olor_quemado_llantas).
sintoma(ruido_metalico_motor)        :- preguntar(sintoma, ruido_metalico_motor).
% --- Síntomas agregados por la investigación de fallas documentadas ---
sintoma(vibracion_transmision_baja_vel) :- preguntar(sintoma, vibracion_transmision_baja_vel).
sintoma(transmision_modo_emergencia) :- preguntar(sintoma, transmision_modo_emergencia).
sintoma(transmision_cae_neutro_inesperado) :- preguntar(sintoma, transmision_cae_neutro_inesperado).
sintoma(cambios_bruscos_automatica) :- preguntar(sintoma, cambios_bruscos_automatica).
sintoma(golpeteo_motor_ralenti) :- preguntar(sintoma, golpeteo_motor_ralenti).
sintoma(consumo_excesivo_aceite_motor) :- preguntar(sintoma, consumo_excesivo_aceite_motor).
sintoma(silbido_agudo_motor_frio) :- preguntar(sintoma, silbido_agudo_motor_frio).
sintoma(luz_falla_suspension_tablero) :- preguntar(sintoma, luz_falla_suspension_tablero).
sintoma(vehiculo_se_hunde_en_reposo) :- preguntar(sintoma, vehiculo_se_hunde_en_reposo).
sintoma(fuga_visible_refrigerante_bajo_auto) :- preguntar(sintoma, fuga_visible_refrigerante_bajo_auto).
sintoma(retraso_enganche_marcha) :- preguntar(sintoma, retraso_enganche_marcha).

% NOMBRES Y CATEGORÍAS DE SÍNTOMAS PARA EL UI (fuente única en Prolog)
nombre_sintoma(chirrido_al_frenar, 'Chirrido al frenar').
nombre_sintoma(pedal_freno_esponjoso, 'Pedal de freno esponjoso').
nombre_sintoma(olor_quemado_llantas, 'Olor a llantas quemadas').
nombre_sintoma(humo_azul, 'Humo azul en escape').
nombre_sintoma(perdida_potencia, 'Pérdida de potencia').
nombre_sintoma(olor_gasolina_bayeta, 'Olor a gasolina/bayeta').
nombre_sintoma(sobrecalentamiento, 'Sobrecalentamiento del motor').
nombre_sintoma(nivel_bajo_anticongelante, 'Nivel bajo de anticongelante').
nombre_sintoma(luz_check_engine, 'Luz check engine encendida').
nombre_sintoma(consumo_excesivo_combustible, 'Consumo excesivo de combustible').
nombre_sintoma(humo_blanco_escape, 'Humo blanco en escape').
nombre_sintoma(humo_negro_escape, 'Humo negro en escape').
nombre_sintoma(tirones_al_acelerar, 'Tirones al acelerar').
nombre_sintoma(charco_aceite_motor, 'Charco de aceite bajo motor').
nombre_sintoma(ruido_metalico_motor, 'Ruido metálico en motor').
nombre_sintoma(motor_no_gira, 'Motor no gira').
nombre_sintoma(luces_debiles, 'Luces débiles').
nombre_sintoma(falla_encendido, 'Falla en encendido').
nombre_sintoma(marchas_resbalan, 'Marchas resbalan').
nombre_sintoma(pedal_embrague_suelto, 'Pedal de embrague suelto').
nombre_sintoma(volante_duro, 'Volante duro').
nombre_sintoma(fuga_liquido_direccion, 'Fuga de líquido de dirección').
nombre_sintoma(vibracion_encendido_aire, 'Vibración al encender con aire').
nombre_sintoma(ruido_clac_clac_girar, 'Ruido clac-clac al girar').
nombre_sintoma(vibracion_volante_alta_vel, 'Vibración en volante a alta velocidad').
nombre_sintoma(aire_acondicionado_no_enfria, 'Aire acondicionado no enfría').
nombre_sintoma(ruido_correa_acelerar, 'Ruido de correa al acelerar').
nombre_sintoma(vibracion_transmision_baja_vel, 'Vibración/tirón de la transmisión en aceleración suave a baja velocidad').
nombre_sintoma(transmision_modo_emergencia, 'Transmisión entra en modo de emergencia (limp mode)').
nombre_sintoma(transmision_cae_neutro_inesperado, 'La transmisión cae a neutro de forma inesperada').
nombre_sintoma(cambios_bruscos_automatica, 'Cambios bruscos o inconsistentes en la transmisión automática').
nombre_sintoma(golpeteo_motor_ralenti, 'Golpeteo metálico del motor en ralentí (rod knock)').
nombre_sintoma(consumo_excesivo_aceite_motor, 'Consumo excesivo de aceite de motor').
nombre_sintoma(silbido_agudo_motor_frio, 'Silbido o traqueteo agudo del motor en frío').
nombre_sintoma(luz_falla_suspension_tablero, 'Luz de falla de suspensión encendida en el tablero').
nombre_sintoma(vehiculo_se_hunde_en_reposo, 'El vehículo se hunde visiblemente de un lado al quedar reposando').
nombre_sintoma(fuga_visible_refrigerante_bajo_auto, 'Charco o fuga visible de refrigerante bajo el vehículo').
nombre_sintoma(retraso_enganche_marcha, 'Retraso notable al pasar de Park/Neutral a Drive').

categoria_sintoma(chirrido_al_frenar, 'Frenos').
categoria_sintoma(pedal_freno_esponjoso, 'Frenos').
categoria_sintoma(olor_quemado_llantas, 'Frenos').
categoria_sintoma(humo_azul, 'Motor').
categoria_sintoma(perdida_potencia, 'Motor').
categoria_sintoma(olor_gasolina_bayeta, 'Motor').
categoria_sintoma(sobrecalentamiento, 'Refrigeración').
categoria_sintoma(nivel_bajo_anticongelante, 'Refrigeración').
categoria_sintoma(luz_check_engine, 'Motor').
categoria_sintoma(consumo_excesivo_combustible, 'Motor').
categoria_sintoma(humo_blanco_escape, 'Motor').
categoria_sintoma(humo_negro_escape, 'Motor').
categoria_sintoma(tirones_al_acelerar, 'Motor').
categoria_sintoma(charco_aceite_motor, 'Aceite').
categoria_sintoma(ruido_metalico_motor, 'Motor').
categoria_sintoma(motor_no_gira, 'Encendido').
categoria_sintoma(luces_debiles, 'Electricidad').
categoria_sintoma(falla_encendido, 'Encendido').
categoria_sintoma(marchas_resbalan, 'Transmisión').
categoria_sintoma(pedal_embrague_suelto, 'Transmisión').
categoria_sintoma(volante_duro, 'Dirección').
categoria_sintoma(fuga_liquido_direccion, 'Dirección').
categoria_sintoma(vibracion_encendido_aire, 'Suspensión').
categoria_sintoma(ruido_clac_clac_girar, 'Suspensión').
categoria_sintoma(vibracion_volante_alta_vel, 'Suspensión').
categoria_sintoma(aire_acondicionado_no_enfria, 'Climatización').
categoria_sintoma(ruido_correa_acelerar, 'Accesorios').
categoria_sintoma(vibracion_transmision_baja_vel, 'Transmisión').
categoria_sintoma(transmision_modo_emergencia, 'Transmisión').
categoria_sintoma(transmision_cae_neutro_inesperado, 'Transmisión').
categoria_sintoma(cambios_bruscos_automatica, 'Transmisión').
categoria_sintoma(golpeteo_motor_ralenti, 'Motor').
categoria_sintoma(consumo_excesivo_aceite_motor, 'Aceite').
categoria_sintoma(silbido_agudo_motor_frio, 'Motor').
categoria_sintoma(luz_falla_suspension_tablero, 'Suspensión').
categoria_sintoma(vehiculo_se_hunde_en_reposo, 'Suspensión').
categoria_sintoma(fuga_visible_refrigerante_bajo_auto, 'Refrigeración').
categoria_sintoma(retraso_enganche_marcha, 'Transmisión').

% FALLAS
% (Cada regla tiene forma falla(Id, Certeza) :- sintomas...)

% --- COMPLEJAS ---
falla(fuga_sistema_refrigeracion,      0.92) :- sintoma(sobrecalentamiento),          sintoma(nivel_bajo_anticongelante).
falla(bateria_descargada_o_alternador, 0.90) :- sintoma(motor_no_gira),               sintoma(luces_debiles).
falla(bobina_encendido_defectuosa,     0.88) :- sintoma(falla_encendido),             sintoma(perdida_potencia).
falla(bomba_direccion_averiada,        0.90) :- sintoma(volante_duro),                sintoma(fuga_liquido_direccion).
falla(sensor_oxigeno_defectuoso,       0.87) :- sintoma(luz_check_engine),            sintoma(consumo_excesivo_combustible).
falla(embrague_desgastado,             0.88) :- sintoma(marchas_resbalan),            sintoma(pedal_embrague_suelto).
falla(junta_culata_quemada,            0.93) :- sintoma(humo_blanco_escape),          sintoma(sobrecalentamiento).
falla(junta_homocinetica_daniada,      0.89) :- sintoma(ruido_clac_clac_girar),       sintoma(vibracion_volante_alta_vel).
falla(inyectores_sucios,               0.86) :- sintoma(humo_negro_escape),           sintoma(tirones_al_acelerar).
falla(falta_lubricacion_motor,         0.91) :- sintoma(ruido_metalico_motor),        sintoma(charco_aceite_motor).

falla(fuga_sistema_refrigeracion,      0.60) :- sintoma(sobrecalentamiento).
falla(bateria_descargada_o_alternador, 0.55) :- sintoma(motor_no_gira).
falla(bobina_encendido_defectuosa,     0.55) :- sintoma(falla_encendido).
falla(bomba_direccion_averiada,        0.60) :- sintoma(volante_duro).
falla(sensor_oxigeno_defectuoso,       0.55) :- sintoma(luz_check_engine).
falla(embrague_desgastado,             0.58) :- sintoma(marchas_resbalan).
falla(junta_culata_quemada,            0.62) :- sintoma(humo_blanco_escape).
falla(junta_homocinetica_daniada,      0.57) :- sintoma(ruido_clac_clac_girar).
falla(inyectores_sucios,               0.55) :- sintoma(humo_negro_escape).
falla(falta_lubricacion_motor,         0.65) :- sintoma(ruido_metalico_motor).

% --- SIMPLES ---
falla(sistema_frenos_con_aire,         0.87) :- sintoma(chirrido_al_frenar),          sintoma(pedal_freno_esponjoso).
falla(pastillas_freno,                 0.72) :- sintoma(chirrido_al_frenar),          \+ sintoma(pedal_freno_esponjoso).
falla(sellos_valvula,                  0.75) :- sintoma(humo_azul).
falla(dilucion_aceite,                 0.73) :- sintoma(olor_gasolina_bayeta).
falla(aspas_ventilador_radiador,       0.70) :- sintoma(vibracion_encendido_aire).
falla(falta_gas_refrigerante,          0.78) :- sintoma(aire_acondicionado_no_enfria).
falla(correa_accesorios_desgastada,    0.76) :- sintoma(ruido_correa_acelerar).
falla(llantas_desbalanceadas,          0.70) :- sintoma(vibracion_volante_alta_vel).
falla(fuga_carter_aceite,              0.80) :- sintoma(charco_aceite_motor).
falla(frenos_sobrecalentados,          0.77) :- sintoma(olor_quemado_llantas).

% --- Evidencia INDEPENDIENTE agregada (criterio de ingenieria propio: validar con un mecanico).
% Un charco visible de refrigerante es un indicio distinto a sobrecalentamiento + nivel bajo;
% al dispararse ambos, el motor combina la evidencia en vez de descartar una.
falla(fuga_sistema_refrigeracion,      0.65) :- sintoma(fuga_visible_refrigerante_bajo_auto).

% --- FALLAS DOCUMENTADAS POR MODELO (Excel): regla compleja + regla simple ---
falla(cvt_nissan_altima, 0.9) :- sintoma(vibracion_transmision_baja_vel), sintoma(marchas_resbalan).
falla(cvt_nissan_altima, 0.7) :- sintoma(vibracion_transmision_baja_vel).
falla(cvt_nissan_sentra, 0.9) :- sintoma(vibracion_transmision_baja_vel), sintoma(marchas_resbalan).
falla(cvt_nissan_sentra, 0.7) :- sintoma(vibracion_transmision_baja_vel).
falla(cvt_nissan_rogue, 0.9) :- sintoma(vibracion_transmision_baja_vel), sintoma(ruido_metalico_motor).
falla(cvt_nissan_rogue, 0.7) :- sintoma(vibracion_transmision_baja_vel).
falla(cvt_nissan_pathfinder, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(sobrecalentamiento).
falla(cvt_nissan_pathfinder, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(cvt_nissan_murano, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(marchas_resbalan).
falla(cvt_nissan_murano, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(dct_ford_focus_powershift, 0.9) :- sintoma(vibracion_transmision_baja_vel), sintoma(tirones_al_acelerar).
falla(dct_ford_focus_powershift, 0.7) :- sintoma(vibracion_transmision_baja_vel).
falla(dct_ford_fiesta_powershift, 0.9) :- sintoma(vibracion_transmision_baja_vel), sintoma(tirones_al_acelerar).
falla(dct_ford_fiesta_powershift, 0.7) :- sintoma(vibracion_transmision_baja_vel).
falla(motor_theta2_hyundai_sonata, 0.8) :- sintoma(golpeteo_motor_ralenti), sintoma(consumo_excesivo_aceite_motor).
falla(motor_theta2_hyundai_sonata, 0.6) :- sintoma(golpeteo_motor_ralenti).
falla(motor_theta2_hyundai_santafe, 0.8) :- sintoma(golpeteo_motor_ralenti), sintoma(consumo_excesivo_aceite_motor).
falla(motor_theta2_hyundai_santafe, 0.6) :- sintoma(golpeteo_motor_ralenti).
falla(motor_theta2_kia_optima, 0.8) :- sintoma(golpeteo_motor_ralenti), sintoma(consumo_excesivo_aceite_motor).
falla(motor_theta2_kia_optima, 0.6) :- sintoma(golpeteo_motor_ralenti).
falla(motor_theta2_kia_sportage, 0.8) :- sintoma(golpeteo_motor_ralenti), sintoma(consumo_excesivo_aceite_motor).
falla(motor_theta2_kia_sportage, 0.6) :- sintoma(golpeteo_motor_ralenti).
falla(dsg_vw_jetta, 0.9) :- sintoma(transmision_modo_emergencia), sintoma(cambios_bruscos_automatica).
falla(dsg_vw_jetta, 0.7) :- sintoma(transmision_modo_emergencia).
falla(dsg_vw_golf, 0.9) :- sintoma(transmision_modo_emergencia), sintoma(cambios_bruscos_automatica).
falla(dsg_vw_golf, 0.7) :- sintoma(transmision_modo_emergencia).
falla(dsg_vw_passat, 0.9) :- sintoma(cambios_bruscos_automatica), sintoma(vibracion_transmision_baja_vel).
falla(dsg_vw_passat, 0.7) :- sintoma(cambios_bruscos_automatica).
falla(zf8_jeep_grandcherokee, 0.9) :- sintoma(cambios_bruscos_automatica), sintoma(tirones_al_acelerar).
falla(zf8_jeep_grandcherokee, 0.7) :- sintoma(cambios_bruscos_automatica).
falla(zf9_jeep_cherokee, 0.9) :- sintoma(transmision_cae_neutro_inesperado), sintoma(cambios_bruscos_automatica).
falla(zf9_jeep_cherokee, 0.7) :- sintoma(transmision_cae_neutro_inesperado).
falla(zf9_chrysler_200, 0.65) :- sintoma(transmision_cae_neutro_inesperado), sintoma(cambios_bruscos_automatica).
falla(zf9_chrysler_200, 0.45) :- sintoma(transmision_cae_neutro_inesperado).
falla(cadena_bmw_n20, 0.9) :- sintoma(silbido_agudo_motor_frio), sintoma(ruido_metalico_motor).
falla(cadena_bmw_n20, 0.7) :- sintoma(silbido_agudo_motor_frio).
falla(auto_722_mercedes_clasec, 0.65) :- sintoma(cambios_bruscos_automatica), sintoma(luz_check_engine).
falla(auto_722_mercedes_clasec, 0.45) :- sintoma(cambios_bruscos_automatica).
falla(cvt_subaru_legacy_outback, 0.9) :- sintoma(vibracion_transmision_baja_vel), sintoma(marchas_resbalan).
falla(cvt_subaru_legacy_outback, 0.7) :- sintoma(vibracion_transmision_baja_vel).
falla(cvt_subaru_forester, 0.9) :- sintoma(vibracion_transmision_baja_vel), sintoma(marchas_resbalan).
falla(cvt_subaru_forester, 0.7) :- sintoma(vibracion_transmision_baja_vel).
falla(culata_subaru_ej25, 0.9) :- sintoma(charco_aceite_motor), sintoma(sobrecalentamiento).
falla(culata_subaru_ej25, 0.7) :- sintoma(charco_aceite_motor).
falla(auto_honda_accord_v6, 0.65) :- sintoma(marchas_resbalan), sintoma(tirones_al_acelerar).
falla(auto_honda_accord_v6, 0.45) :- sintoma(marchas_resbalan).
falla(cvt_honda_accord_crv, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(tirones_al_acelerar).
falla(cvt_honda_accord_crv, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(auto6t40_chevrolet_malibu, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(tirones_al_acelerar).
falla(auto6t40_chevrolet_malibu, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(refrigerante_chevrolet_cruze, 0.65) :- sintoma(fuga_visible_refrigerante_bajo_auto), sintoma(sobrecalentamiento).
falla(refrigerante_chevrolet_cruze, 0.45) :- sintoma(fuga_visible_refrigerante_bajo_auto).
falla(cvt_mitsubishi_lancer_outlander, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(marchas_resbalan).
falla(cvt_mitsubishi_lancer_outlander, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(multitronic_audi_a4a6, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(perdida_potencia).
falla(multitronic_audi_a4a6, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(aceite_toyota_2azfe, 0.65) :- sintoma(consumo_excesivo_aceite_motor), sintoma(humo_azul).
falla(aceite_toyota_2azfe, 0.45) :- sintoma(consumo_excesivo_aceite_motor).
falla(zf8_ram_1500, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(cambios_bruscos_automatica).
falla(zf8_ram_1500, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(suspension_landrover_discovery, 0.9) :- sintoma(luz_falla_suspension_tablero), sintoma(vehiculo_se_hunde_en_reposo).
falla(suspension_landrover_discovery, 0.7) :- sintoma(luz_falla_suspension_tablero).
falla(zf9_landrover_discoverysport, 0.65) :- sintoma(cambios_bruscos_automatica), sintoma(tirones_al_acelerar).
falla(zf9_landrover_discoverysport, 0.45) :- sintoma(cambios_bruscos_automatica).
falla(dct_hyundai_elantra, 0.65) :- sintoma(vibracion_transmision_baja_vel), sintoma(tirones_al_acelerar).
falla(dct_hyundai_elantra, 0.45) :- sintoma(vibracion_transmision_baja_vel).
falla(zf8_chrysler300_dodgecharger, 0.65) :- sintoma(retraso_enganche_marcha), sintoma(cambios_bruscos_automatica).
falla(zf8_chrysler300_dodgecharger, 0.45) :- sintoma(retraso_enganche_marcha).

% NOMBRES DE FALLA PARA EL UI (fuente única en Prolog)
nombre_falla(falta_lubricacion_motor, 'Falta de lubricación del motor').
nombre_falla(junta_culata_quemada, 'Junta de culata quemada').
nombre_falla(bateria_descargada_o_alternador, 'Batería descargada o alternador').
nombre_falla(fuga_sistema_refrigeracion, 'Fuga en sistema de refrigeración').
nombre_falla(embrague_desgastado, 'Embrague desgastado').
nombre_falla(bomba_direccion_averiada, 'Bomba de dirección averiada').
nombre_falla(sistema_frenos_con_aire, 'Sistema de frenos con aire').
nombre_falla(frenos_sobrecalentados, 'Frenos sobrecalentados').
nombre_falla(bobina_encendido_defectuosa, 'Bobina de encendido defectuosa').
nombre_falla(sensor_oxigeno_defectuoso, 'Sensor de oxígeno defectuoso').
nombre_falla(junta_homocinetica_daniada, 'Junta homocinética dañada').
nombre_falla(inyectores_sucios, 'Inyectores sucios').
nombre_falla(fuga_carter_aceite, 'Fuga en cárter de aceite').
nombre_falla(sellos_valvula, 'Sellos de válvula defectuosos').
nombre_falla(pastillas_freno, 'Pastillas de freno desgastadas').
nombre_falla(correa_accesorios_desgastada, 'Correa de accesorios desgastada').
nombre_falla(dilucion_aceite, 'Dilución de aceite').
nombre_falla(aspas_ventilador_radiador, 'Aspas del ventilador del radiador').
nombre_falla(falta_gas_refrigerante, 'Falta de gas refrigerante').
nombre_falla(llantas_desbalanceadas, 'Llantas desbalanceadas').
nombre_falla(cvt_nissan_altima, 'CVT Nissan Altima - vibración/falla').
nombre_falla(cvt_nissan_sentra, 'CVT Nissan Sentra - falla').
nombre_falla(cvt_nissan_rogue, 'CVT Nissan Rogue - falla de rodamiento').
nombre_falla(cvt_nissan_pathfinder, 'CVT Nissan Pathfinder - falla').
nombre_falla(cvt_nissan_murano, 'CVT Nissan Murano - falla').
nombre_falla(dct_ford_focus_powershift, 'Ford Focus PowerShift - falla de embrague doble').
nombre_falla(dct_ford_fiesta_powershift, 'Ford Fiesta PowerShift - falla de embrague doble').
nombre_falla(motor_theta2_hyundai_sonata, 'Motor Theta II Hyundai Sonata - golpeteo/falla').
nombre_falla(motor_theta2_hyundai_santafe, 'Motor Theta II Hyundai Santa Fe Sport - golpeteo/falla').
nombre_falla(motor_theta2_kia_optima, 'Motor Theta II Kia Optima - golpeteo/falla').
nombre_falla(motor_theta2_kia_sportage, 'Motor Theta II Kia Sportage - golpeteo/falla').
nombre_falla(dsg_vw_jetta, 'VW Jetta DSG (DQ200) - falla de mecatronica').
nombre_falla(dsg_vw_golf, 'VW Golf DSG (DQ200) - falla de mecatronica').
nombre_falla(dsg_vw_passat, 'VW Passat DSG (DQ250) - falla de embrague/mecatronica').
nombre_falla(zf8_jeep_grandcherokee, 'Jeep Grand Cherokee ZF8HP70 - cambios bruscos').
nombre_falla(zf9_jeep_cherokee, 'Jeep Cherokee ZF9HP48 - cambios duros/neutro').
nombre_falla(zf9_chrysler_200, 'Chrysler 200 ZF9HP48 - cambios erraticos').
nombre_falla(cadena_bmw_n20, 'BMW N20 - falla de cadena de distribucion').
nombre_falla(auto_722_mercedes_clasec, 'Mercedes Clase C (W203) - cambios bruscos 722.6/722.9').
nombre_falla(cvt_subaru_legacy_outback, 'Subaru Legacy/Outback CVT (Lineartronic) - falla').
nombre_falla(cvt_subaru_forester, 'Subaru Forester CVT (Lineartronic) - falla').
nombre_falla(culata_subaru_ej25, 'Subaru EJ25 - fuga externa por junta de culata').
nombre_falla(auto_honda_accord_v6, 'Honda Accord V6 - falla de transmision automatica 5 vel.').
nombre_falla(cvt_honda_accord_crv, 'Honda Accord/CR-V 1.5T - judder de CVT').
nombre_falla(auto6t40_chevrolet_malibu, 'Chevrolet Malibu 6T40 - vibracion de convertidor de par').
nombre_falla(refrigerante_chevrolet_cruze, 'Chevrolet Cruze 1.4T - fuga de refrigerante').
nombre_falla(cvt_mitsubishi_lancer_outlander, 'Mitsubishi Lancer/Outlander CVT - falla').
nombre_falla(multitronic_audi_a4a6, 'Audi A4/A6 Multitronic - falla de CVT').
nombre_falla(aceite_toyota_2azfe, 'Toyota 2AZ-FE - consumo excesivo de aceite').
nombre_falla(zf8_ram_1500, 'Ram 1500 ZF8HP70 - vibracion de convertidor de par').
nombre_falla(suspension_landrover_discovery, 'Land Rover Discovery/Range Rover Sport - falla de suspension neumatica').
nombre_falla(zf9_landrover_discoverysport, 'Land Rover Discovery Sport/Evoque ZF9HP - cambios bruscos').
nombre_falla(dct_hyundai_elantra, 'Hyundai Elantra/Veloster DCT - vibracion a baja velocidad').
nombre_falla(zf8_chrysler300_dodgecharger, 'Chrysler 300/Dodge Charger ZF8HP - retraso de enganche').

% REPARACIONES, EXPLICACIONES, URGENCIA Y COSTOS
% meta_falla(Falla, urgencia(U), costo(Min, Max, Moneda))
% Las fallas originales estan en MXN; las documentadas conservan su moneda de
% investigacion (USD, mercado EE.UU.). No se inventa ninguna conversion.
meta_falla(falta_lubricacion_motor,         urgencia(critica),  costo(500, 1500, mxn)).
meta_falla(junta_culata_quemada,            urgencia(critica),  costo(4000, 12000, mxn)).
meta_falla(bateria_descargada_o_alternador, urgencia(alta),     costo(800, 3500, mxn)).
meta_falla(fuga_sistema_refrigeracion,      urgencia(alta),     costo(600, 4000, mxn)).
meta_falla(embrague_desgastado,             urgencia(alta),     costo(2500, 6000, mxn)).
meta_falla(bomba_direccion_averiada,        urgencia(alta),     costo(1500, 5000, mxn)).
meta_falla(sistema_frenos_con_aire,         urgencia(alta),     costo(300, 1200, mxn)).
meta_falla(frenos_sobrecalentados,          urgencia(alta),     costo(400, 2000, mxn)).
meta_falla(bobina_encendido_defectuosa,     urgencia(media),    costo(800, 2500, mxn)).
meta_falla(sensor_oxigeno_defectuoso,       urgencia(media),    costo(600, 2000, mxn)).
meta_falla(junta_homocinetica_daniada,      urgencia(media),    costo(1200, 3500, mxn)).
meta_falla(inyectores_sucios,               urgencia(media),    costo(500, 2000, mxn)).
meta_falla(fuga_carter_aceite,              urgencia(media),    costo(300, 1500, mxn)).
meta_falla(sellos_valvula,                  urgencia(media),    costo(1000, 3000, mxn)).
meta_falla(pastillas_freno,                 urgencia(baja),     costo(400, 1200, mxn)).
meta_falla(correa_accesorios_desgastada,    urgencia(baja),     costo(400, 1200, mxn)).
meta_falla(dilucion_aceite,                 urgencia(baja),     costo(300, 800, mxn)).
meta_falla(aspas_ventilador_radiador,       urgencia(baja),     costo(300, 900, mxn)).
meta_falla(falta_gas_refrigerante,          urgencia(baja),     costo(500, 1500, mxn)).
meta_falla(llantas_desbalanceadas,          urgencia(baja),     costo(200, 600, mxn)).
meta_falla(cvt_nissan_altima, urgencia(critica), costo(3000, 4700, usd)).
meta_falla(cvt_nissan_sentra, urgencia(critica), costo(3590, 4000, usd)).
meta_falla(cvt_nissan_rogue, urgencia(alta), costo(3500, 4500, usd)).
meta_falla(cvt_nissan_pathfinder, urgencia(alta), costo(3000, 4500, usd)).
meta_falla(cvt_nissan_murano, urgencia(alta), costo(3000, 4500, usd)).
meta_falla(dct_ford_focus_powershift, urgencia(alta), costo(700, 4000, usd)).
meta_falla(dct_ford_fiesta_powershift, urgencia(alta), costo(600, 3500, usd)).
meta_falla(motor_theta2_hyundai_sonata, urgencia(critica), costo(4000, 6000, usd)).
meta_falla(motor_theta2_hyundai_santafe, urgencia(critica), costo(4000, 6000, usd)).
meta_falla(motor_theta2_kia_optima, urgencia(critica), costo(4000, 6000, usd)).
meta_falla(motor_theta2_kia_sportage, urgencia(critica), costo(4000, 6000, usd)).
meta_falla(dsg_vw_jetta, urgencia(alta), costo(500, 3500, usd)).
meta_falla(dsg_vw_golf, urgencia(alta), costo(500, 3500, usd)).
meta_falla(dsg_vw_passat, urgencia(alta), costo(2000, 3500, usd)).
meta_falla(zf8_jeep_grandcherokee, urgencia(media), costo(150, 300, usd)).
meta_falla(zf9_jeep_cherokee, urgencia(alta), costo(800, 2500, usd)).
meta_falla(zf9_chrysler_200, urgencia(alta), costo(800, 2500, usd)).
meta_falla(cadena_bmw_n20, urgencia(critica), costo(1500, 15000, usd)).
meta_falla(auto_722_mercedes_clasec, urgencia(media), costo(800, 4500, usd)).
meta_falla(cvt_subaru_legacy_outback, urgencia(alta), costo(4000, 8000, usd)).
meta_falla(cvt_subaru_forester, urgencia(alta), costo(4000, 8000, usd)).
meta_falla(culata_subaru_ej25, urgencia(media), costo(1500, 3500, usd)).
meta_falla(auto_honda_accord_v6, urgencia(alta), costo(2500, 4000, usd)).
meta_falla(cvt_honda_accord_crv, urgencia(media), costo(150, 3000, usd)).
meta_falla(auto6t40_chevrolet_malibu, urgencia(media), costo(300, 3500, usd)).
meta_falla(refrigerante_chevrolet_cruze, urgencia(alta), costo(500, 1200, usd)).
meta_falla(cvt_mitsubishi_lancer_outlander, urgencia(alta), costo(3500, 5000, usd)).
meta_falla(multitronic_audi_a4a6, urgencia(alta), costo(6000, 9000, usd)).
meta_falla(aceite_toyota_2azfe, urgencia(alta), costo(3000, 6000, usd)).
meta_falla(zf8_ram_1500, urgencia(media), costo(1500, 2500, usd)).
meta_falla(suspension_landrover_discovery, urgencia(media), costo(1000, 5000, usd)).
meta_falla(zf9_landrover_discoverysport, urgencia(media), costo(800, 2500, usd)).
meta_falla(dct_hyundai_elantra, urgencia(media), costo(1500, 3000, usd)).
meta_falla(zf8_chrysler300_dodgecharger, urgencia(media), costo(150, 2000, usd)).

% TRAZABILIDAD DEL DATO (solo fallas documentadas; las originales no tienen fuente registrada)
% confianza_dato: alta | alta_costo_estimado | media | baja  (nivel de confianza de la investigacion,
% distinto de la certeza diagnostica que calcula el motor a partir de los sintomas)
confianza_dato(cvt_nissan_altima, alta).
confianza_dato(cvt_nissan_sentra, alta).
confianza_dato(cvt_nissan_rogue, alta).
confianza_dato(cvt_nissan_pathfinder, media).
confianza_dato(cvt_nissan_murano, media).
confianza_dato(dct_ford_focus_powershift, alta).
confianza_dato(dct_ford_fiesta_powershift, alta).
confianza_dato(motor_theta2_hyundai_sonata, alta_costo_estimado).
confianza_dato(motor_theta2_hyundai_santafe, alta_costo_estimado).
confianza_dato(motor_theta2_kia_optima, alta_costo_estimado).
confianza_dato(motor_theta2_kia_sportage, alta_costo_estimado).
confianza_dato(dsg_vw_jetta, alta).
confianza_dato(dsg_vw_golf, alta).
confianza_dato(dsg_vw_passat, alta).
confianza_dato(zf8_jeep_grandcherokee, alta).
confianza_dato(zf9_jeep_cherokee, alta).
confianza_dato(zf9_chrysler_200, media).
confianza_dato(cadena_bmw_n20, alta).
confianza_dato(auto_722_mercedes_clasec, media).
confianza_dato(cvt_subaru_legacy_outback, alta).
confianza_dato(cvt_subaru_forester, alta).
confianza_dato(culata_subaru_ej25, alta).
confianza_dato(auto_honda_accord_v6, media).
confianza_dato(cvt_honda_accord_crv, media).
confianza_dato(auto6t40_chevrolet_malibu, media).
confianza_dato(refrigerante_chevrolet_cruze, media).
confianza_dato(cvt_mitsubishi_lancer_outlander, media).
confianza_dato(multitronic_audi_a4a6, media).
confianza_dato(aceite_toyota_2azfe, media).
confianza_dato(zf8_ram_1500, media).
confianza_dato(suspension_landrover_discovery, alta).
confianza_dato(zf9_landrover_discoverysport, media).
confianza_dato(dct_hyundai_elantra, media).
confianza_dato(zf8_chrysler300_dodgecharger, media).
fuente_falla(cvt_nissan_altima, 'CarComplaints.com, TrueDelta, Edmunds forums (verificado)').
fuente_falla(cvt_nissan_sentra, 'CarComplaints.com (verificado)').
fuente_falla(cvt_nissan_rogue, 'TrueDelta, reporte real de propietario (verificado)').
fuente_falla(cvt_nissan_pathfinder, 'Jalopnik - listado de CVT Nissan poco confiables (existencia verificada; costo estimado)').
fuente_falla(cvt_nissan_murano, 'Jalopnik (existencia verificada; costo estimado)').
fuente_falla(dct_ford_focus_powershift, 'getjerry.com, TrueDelta, Automotive News (verificado)').
fuente_falla(dct_ford_fiesta_powershift, 'TrueDelta, Automotive News (verificado)').
fuente_falla(motor_theta2_hyundai_sonata, 'Jalopnik, The Drive, NHTSA (recall verificado; costo fuera de garantia estimado)').
fuente_falla(motor_theta2_hyundai_santafe, 'The Drive, NHTSA (recall verificado; costo estimado)').
fuente_falla(motor_theta2_kia_optima, 'Jalopnik, Reuters/kiastinger.org, NHTSA (recall verificado; costo estimado)').
fuente_falla(motor_theta2_kia_sportage, 'The Drive, NHTSA (recall verificado; costo estimado)').
fuente_falla(dsg_vw_jetta, 'au7o.io, ecutesting.com, TrueDelta (verificado)').
fuente_falla(dsg_vw_golf, 'ecutesting.com, au7o.io (verificado)').
fuente_falla(dsg_vw_passat, 'foreignautomotive.ca (verificado)').
fuente_falla(zf8_jeep_grandcherokee, 'Boletin NHTSA SB-10069301-0335, TrueDelta (verificado)').
fuente_falla(zf9_jeep_cherokee, 'service4service.co.uk, offroadingpro.com, carcomplaints.com (verificado)').
fuente_falla(zf9_chrysler_200, 'expeditionportal.com (mencion de plataforma compartida, verificado; costo por analogia)').
fuente_falla(cadena_bmw_n20, 'bmwtuning.co, au7o.io, bimmerforums.com, carcomplaints.com (verificado)').
fuente_falla(auto_722_mercedes_clasec, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(cvt_subaru_legacy_outback, 'CarComplaints.com, RepairPal, NHTSA TSB (verificado)').
fuente_falla(cvt_subaru_forester, 'ricksfreeautorepairadvice.com, NHTSA TSB (verificado)').
fuente_falla(culata_subaru_ej25, 'coveragex.com (verificado)').
fuente_falla(auto_honda_accord_v6, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(cvt_honda_accord_crv, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(auto6t40_chevrolet_malibu, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(refrigerante_chevrolet_cruze, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(cvt_mitsubishi_lancer_outlander, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(multitronic_audi_a4a6, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(aceite_toyota_2azfe, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(zf8_ram_1500, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(suspension_landrover_discovery, 'au7o.io, foreignautomotive.ca (verificado)').
fuente_falla(zf9_landrover_discoverysport, 'Defecto de plataforma verificado para Jeep/Chrysler; no verificado especificamente para Land Rover en esta sesion').
fuente_falla(dct_hyundai_elantra, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').
fuente_falla(zf8_chrysler300_dodgecharger, 'Conocimiento general de la industria (no verificado con busqueda especifica en esta sesion)').

reparacion(fuga_sistema_refrigeracion,      [inspeccionar_mangueras, sellar_fugas, rellenar_anticongelante]).
reparacion(bateria_descargada_o_alternador, [verificar_voltaje_alternador, cargar_bateria, reemplazar_bateria_si_falla]).
reparacion(sistema_frenos_con_aire,         [purgar_lineas_freno, rellenar_liquido_frenos, revisar_pastillas]).
reparacion(bobina_encendido_defectuosa,     [escanear_codigo_error, cambiar_bujias, reemplazar_bobina]).
reparacion(bomba_direccion_averiada,        [revisar_nivel_liquido, inspeccionar_mangueras_direccion, reemplazar_bomba]).
reparacion(sensor_oxigeno_defectuoso,       [escanear_computadora, revisar_cableado_sensor, reemplazar_sensor_oxigeno]).
reparacion(embrague_desgastado,             [revisar_cable_embrague, purgar_liquido_embrague, cambiar_kit_embrague]).
reparacion(junta_culata_quemada,            [medir_compresion_cilindros, rectificar_culata, reemplazar_junta_culata]).
reparacion(junta_homocinetica_daniada,      [inspeccionar_guardapolvos, engrasar_junta, reemplazar_junta_homocinetica]).
reparacion(inyectores_sucios,               [agregar_aditivo_limpiador, realizar_limpieza_ultrasonido, calibrar_inyectores]).
reparacion(pastillas_freno,                 [verificar_desgaste, ajustar_caliper, cambiar_pastillas]).
reparacion(sellos_valvula,                  [verificar_compresion, ajustar_valvulas, cambiar_sellos]).
reparacion(dilucion_aceite,                 [reemplazar_unidad_control_aire, cambiar_aceite_y_filtro]).
reparacion(aspas_ventilador_radiador,       [verificar_conexion_electrica, cambiar_aspas_ventilador]).
reparacion(falta_gas_refrigerante,          [buscar_fugas_con_uv, sellar_sistema_ac, recargar_gas_refrigerante]).
reparacion(correa_accesorios_desgastada,    [inspeccionar_tension, revisar_poleas, reemplazar_correa_serpentina]).
reparacion(llantas_desbalanceadas,          [inspeccionar_desgaste_llantas, balancear_llantas, alinear_direccion]).
reparacion(fuga_carter_aceite,              [limpiar_zona_fuga, apretar_tornillos_carter, reemplazar_empaque_carter]).
reparacion(frenos_sobrecalentados,          [dejar_enfriar_frenos, revisar_liquido_frenos, purgar_sistema]).
reparacion(falta_lubricacion_motor,         [apagar_motor_inmediatamente, medir_nivel_aceite, revisar_bomba_aceite]).
reparacion(cvt_nissan_altima, [escanear_codigos_obd, prueba_manejo_baja_velocidad, verificar_software_tcm, revisar_fluido_transmision, verificar_garantia_extendida]).
reparacion(cvt_nissan_sentra, [escanear_codigos_obd, prueba_manejo_baja_velocidad, confirmar_recall_nhtsa, inspeccionar_fugas_fluido]).
reparacion(cvt_nissan_rogue, [escuchar_golpeteo_motor, escanear_codigos_obd, prueba_manejo_baja_velocidad, verificar_boletin_tsb]).
reparacion(cvt_nissan_pathfinder, [escanear_codigos_obd, prueba_manejo_baja_velocidad, verificar_garantia_extendida]).
reparacion(cvt_nissan_murano, [escanear_codigos_obd, prueba_manejo_baja_velocidad, verificar_garantia_extendida]).
reparacion(dct_ford_focus_powershift, [prueba_manejo_baja_velocidad, escanear_codigos_obd, verificar_software_tcm, verificar_garantia_extendida]).
reparacion(dct_ford_fiesta_powershift, [prueba_manejo_baja_velocidad, escanear_codigos_obd, verificar_software_tcm, verificar_garantia_extendida]).
reparacion(motor_theta2_hyundai_sonata, [escuchar_golpeteo_motor, verificar_consumo_aceite, confirmar_recall_nhtsa]).
reparacion(motor_theta2_hyundai_santafe, [escuchar_golpeteo_motor, verificar_consumo_aceite, confirmar_recall_nhtsa]).
reparacion(motor_theta2_kia_optima, [escuchar_golpeteo_motor, verificar_consumo_aceite, confirmar_recall_nhtsa]).
reparacion(motor_theta2_kia_sportage, [escuchar_golpeteo_motor, verificar_consumo_aceite, confirmar_recall_nhtsa]).
reparacion(dsg_vw_jetta, [escanear_codigos_obd, prueba_manejo_baja_velocidad, revisar_actualizacion_tcu, revisar_fluido_transmision]).
reparacion(dsg_vw_golf, [escanear_codigos_obd, prueba_manejo_baja_velocidad, revisar_actualizacion_tcu, revisar_fluido_transmision]).
reparacion(dsg_vw_passat, [escanear_codigos_obd, prueba_manejo_baja_velocidad, revisar_fluido_transmision, revisar_actualizacion_tcu]).
reparacion(zf8_jeep_grandcherokee, [escanear_codigos_obd, verificar_boletin_tsb, verificar_software_tcm]).
reparacion(zf9_jeep_cherokee, [escanear_codigos_obd, verificar_recall_arnes, verificar_software_tcm]).
reparacion(zf9_chrysler_200, [escanear_codigos_obd, verificar_software_tcm, verificar_boletin_tsb]).
reparacion(cadena_bmw_n20, [escuchar_golpeteo_motor, inspeccionar_cadena_boroscopio, verificar_garantia_extendida, escanear_codigos_obd]).
reparacion(auto_722_mercedes_clasec, [escanear_codigos_obd, prueba_manejo_baja_velocidad, inspeccionar_fugas_fluido]).
reparacion(cvt_subaru_legacy_outback, [escanear_codigos_obd, prueba_manejo_baja_velocidad, verificar_garantia_extendida, inspeccionar_fugas_fluido]).
reparacion(cvt_subaru_forester, [escanear_codigos_obd, prueba_manejo_baja_velocidad, verificar_garantia_extendida, inspeccionar_fugas_fluido]).
reparacion(culata_subaru_ej25, [revisar_fugas_culata, prueba_compresion_cilindros]).
reparacion(auto_honda_accord_v6, [prueba_manejo_baja_velocidad, escanear_codigos_obd, verificar_garantia_extendida]).
reparacion(cvt_honda_accord_crv, [prueba_manejo_baja_velocidad, verificar_boletin_tsb, revisar_fluido_transmision]).
reparacion(auto6t40_chevrolet_malibu, [prueba_manejo_baja_velocidad, escanear_codigos_obd, revisar_fluido_transmision]).
reparacion(refrigerante_chevrolet_cruze, [revisar_bomba_agua, inspeccionar_fugas_fluido, escanear_codigos_obd]).
reparacion(cvt_mitsubishi_lancer_outlander, [escanear_codigos_obd, prueba_manejo_baja_velocidad, revisar_fluido_transmision]).
reparacion(multitronic_audi_a4a6, [prueba_manejo_baja_velocidad, escanear_codigos_obd, verificar_disponibilidad_reconstruccion]).
reparacion(aceite_toyota_2azfe, [verificar_consumo_aceite, prueba_compresion_cilindros, verificar_garantia_extendida]).
reparacion(zf8_ram_1500, [prueba_manejo_baja_velocidad, verificar_boletin_tsb, verificar_software_tcm]).
reparacion(suspension_landrover_discovery, [verificar_luz_suspension, inspeccionar_fuelles_aire]).
reparacion(zf9_landrover_discoverysport, [escanear_codigos_obd, verificar_software_tcm, verificar_boletin_tsb]).
reparacion(dct_hyundai_elantra, [prueba_manejo_baja_velocidad, escanear_codigos_obd, revisar_actualizacion_tcu]).
reparacion(zf8_chrysler300_dodgecharger, [verificar_arranque_frio, escanear_codigos_obd, verificar_software_tcm]).

% NOMBRES DE PASOS DE REPARACIÓN PARA EL UI (fuente única en Prolog)
nombre_reparacion(inspeccionar_mangueras, 'Inspeccionar mangueras').
nombre_reparacion(sellar_fugas, 'Sellar fugas').
nombre_reparacion(rellenar_anticongelante, 'Rellenar anticongelante').
nombre_reparacion(verificar_voltaje_alternador, 'Verificar voltaje alternador').
nombre_reparacion(cargar_bateria, 'Cargar batería').
nombre_reparacion(reemplazar_bateria_si_falla, 'Reemplazar batería si falla').
nombre_reparacion(purgar_lineas_freno, 'Purgar líneas de freno').
nombre_reparacion(rellenar_liquido_frenos, 'Rellenar líquido de frenos').
nombre_reparacion(revisar_pastillas, 'Revisar pastillas').
nombre_reparacion(escanear_codigo_error, 'Escanear código de error').
nombre_reparacion(cambiar_bujias, 'Cambiar bujías').
nombre_reparacion(reemplazar_bobina, 'Reemplazar bobina').
nombre_reparacion(revisar_nivel_liquido, 'Revisar nivel de líquido').
nombre_reparacion(inspeccionar_mangueras_direccion, 'Inspeccionar mangueras').
nombre_reparacion(reemplazar_bomba, 'Reemplazar bomba').
nombre_reparacion(escanear_computadora, 'Escanear computadora').
nombre_reparacion(revisar_cableado_sensor, 'Revisar cableado').
nombre_reparacion(reemplazar_sensor_oxigeno, 'Reemplazar sensor').
nombre_reparacion(revisar_cable_embrague, 'Revisar cable embrague').
nombre_reparacion(purgar_liquido_embrague, 'Purgar líquido embrague').
nombre_reparacion(cambiar_kit_embrague, 'Cambiar kit embrague').
nombre_reparacion(medir_compresion_cilindros, 'Medir compresión cilindros').
nombre_reparacion(rectificar_culata, 'Rectificar culata').
nombre_reparacion(reemplazar_junta_culata, 'Reemplazar junta culata').
nombre_reparacion(inspeccionar_guardapolvos, 'Inspeccionar guardapolvos').
nombre_reparacion(engrasar_junta, 'Engrasar junta').
nombre_reparacion(reemplazar_junta_homocinetica, 'Reemplazar junta').
nombre_reparacion(agregar_aditivo_limpiador, 'Agregar aditivo limpiador').
nombre_reparacion(realizar_limpieza_ultrasonido, 'Limpieza ultrasónica').
nombre_reparacion(calibrar_inyectores, 'Calibrar inyectores').
nombre_reparacion(verificar_desgaste, 'Verificar desgaste').
nombre_reparacion(ajustar_caliper, 'Ajustar caliper').
nombre_reparacion(cambiar_pastillas, 'Cambiar pastillas').
nombre_reparacion(verificar_compresion, 'Verificar compresión').
nombre_reparacion(ajustar_valvulas, 'Ajustar válvulas').
nombre_reparacion(cambiar_sellos, 'Cambiar sellos').
nombre_reparacion(reemplazar_unidad_control_aire, 'Reemplazar unidad control aire').
nombre_reparacion(cambiar_aceite_y_filtro, 'Cambiar aceite y filtro').
nombre_reparacion(verificar_conexion_electrica, 'Verificar conexión eléctrica').
nombre_reparacion(cambiar_aspas_ventilador, 'Cambiar aspas ventilador').
nombre_reparacion(buscar_fugas_con_uv, 'Buscar fugas con UV').
nombre_reparacion(sellar_sistema_ac, 'Sellar sistema AC').
nombre_reparacion(recargar_gas_refrigerante, 'Recargar gas refrigerante').
nombre_reparacion(inspeccionar_tension, 'Inspeccionar tensión').
nombre_reparacion(revisar_poleas, 'Revisar poleas').
nombre_reparacion(reemplazar_correa_serpentina, 'Reemplazar correa serpentina').
nombre_reparacion(inspeccionar_desgaste_llantas, 'Inspeccionar desgaste').
nombre_reparacion(balancear_llantas, 'Balancear llantas').
nombre_reparacion(alinear_direccion, 'Alinear dirección').
nombre_reparacion(limpiar_zona_fuga, 'Limpiar zona de fuga').
nombre_reparacion(apretar_tornillos_carter, 'Apretar tornillos carter').
nombre_reparacion(reemplazar_empaque_carter, 'Reemplazar empaque').
nombre_reparacion(apagar_motor_inmediatamente, 'Apagar motor inmediatamente').
nombre_reparacion(medir_nivel_aceite, 'Medir nivel de aceite').
nombre_reparacion(revisar_bomba_aceite, 'Revisar bomba de aceite').
nombre_reparacion(dejar_enfriar_frenos, 'Dejar enfriar frenos').
nombre_reparacion(revisar_liquido_frenos, 'Revisar líquido de frenos').
nombre_reparacion(purgar_sistema, 'Purgar sistema').
nombre_reparacion(escanear_codigos_obd, 'Escanear códigos con escáner OBD-II').
nombre_reparacion(prueba_manejo_baja_velocidad, 'Prueba de manejo en aceleración suave/baja velocidad').
nombre_reparacion(verificar_boletin_tsb, 'Verificar boletín de servicio (TSB) aplicable al VIN').
nombre_reparacion(confirmar_recall_nhtsa, 'Confirmar VIN contra recalls vigentes en NHTSA').
nombre_reparacion(revisar_fluido_transmision, 'Revisar nivel/color/olor del fluido de transmisión').
nombre_reparacion(verificar_software_tcm, 'Verificar actualización de software del módulo de control (TCM/TCU)').
nombre_reparacion(inspeccionar_fugas_fluido, 'Inspeccionar fugas de fluido en la carcasa de la transmisión').
nombre_reparacion(escuchar_golpeteo_motor, 'Escuchar golpeteo metálico del motor en ralentí/aceleración').
nombre_reparacion(verificar_consumo_aceite, 'Verificar consumo de aceite cada 1,000 km/millas').
nombre_reparacion(inspeccionar_cadena_boroscopio, 'Inspeccionar cadena de distribución con boroscopio por el tapón de aceite').
nombre_reparacion(revisar_fugas_culata, 'Revisar fugas externas de aceite/refrigerante en la junta de culata').
nombre_reparacion(verificar_luz_suspension, 'Verificar mensaje de falla de suspensión en el tablero').
nombre_reparacion(inspeccionar_fuelles_aire, 'Inspeccionar fuelles/resortes de aire con solución jabonosa').
nombre_reparacion(revisar_bomba_agua, 'Revisar bomba de agua/múltiple de admisión por fugas').
nombre_reparacion(verificar_garantia_extendida, 'Confirmar si el VIN califica para garantía extendida del fabricante').
nombre_reparacion(verificar_recall_arnes, 'Verificar si se aplicó el recall de arnés de cableado del sensor').
nombre_reparacion(revisar_actualizacion_tcu, 'Revisar si se instaló la actualización de software del TCU').
nombre_reparacion(verificar_disponibilidad_reconstruccion, 'Verificar disponibilidad de unidades reconstruidas antes de diagnosticar').
nombre_reparacion(prueba_compresion_cilindros, 'Considerar prueba de compresión de cilindros').
nombre_reparacion(verificar_arranque_frio, 'Prueba de manejo en frío verificando retraso al cambiar a Drive').

explicacion(fuga_sistema_refrigeracion) :- writeln('  Razon: El sobrecalentamiento combinado con nivel bajo de anticongelante indica una perdida activa.').
explicacion(bateria_descargada_o_alternador) :- writeln('  Razon: Motor no gira y luces debiles apuntan a fuente de energia electrica comprometida.').
explicacion(sistema_frenos_con_aire) :- writeln('  Razon: Pedal esponjoso junto con chirrido sugiere aire atrapado en lineas hidraulicas.').
explicacion(bobina_encendido_defectuosa) :- writeln('  Razon: Falla de encendido y perdida de potencia apuntan a una bobina sin chispa.').
explicacion(bomba_direccion_averiada) :- writeln('  Razon: Volante duro y fuga confirman falla en la bomba hidraulica.').
explicacion(sensor_oxigeno_defectuoso) :- writeln('  Razon: Check engine con consumo elevado indica falla en la lectura de mezcla.').
explicacion(embrague_desgastado) :- writeln('  Razon: Resbalamiento de marchas y pedal flojo son sintomas de disco desgastado.').
explicacion(junta_culata_quemada) :- writeln('  Razon: Humo blanco y sobrecalentamiento indica mezcla de gases con refrigerante.').
explicacion(junta_homocinetica_daniada) :- writeln('  Razon: Ruido clac-clac al girar con vibracion es firma tipica de junta deteriorada.').
explicacion(inyectores_sucios) :- writeln('  Razon: Humo negro y tirones indican mala atomizacion de combustible.').
explicacion(falta_lubricacion_motor) :- writeln('  Razon: Ruido metalico y charco de aceite confirman falta critica de lubricacion.').
explicacion(pastillas_freno) :- writeln('  Razon: Chirrido al frenar sin pedal esponjoso es indicador de pastillas desgastadas.').
explicacion(sellos_valvula) :- writeln('  Razon: Humo azul indica quema de aceite, tipicamente por sellos de valvula.').
explicacion(dilucion_aceite) :- writeln('  Razon: Olor a gasolina en aceite indica contaminacion de lubricante.').
explicacion(aspas_ventilador_radiador) :- writeln('  Razon: Vibracion al encender AC apunta a aspas del ventilador rotas o sueltas.').
explicacion(falta_gas_refrigerante) :- writeln('  Razon: AC sin enfriar es sintoma de nivel insuficiente de gas refrigerante.').
explicacion(correa_accesorios_desgastada) :- writeln('  Razon: Ruido agudo al acelerar indica desgaste o tension incorrecta de la correa.').
explicacion(llantas_desbalanceadas) :- writeln('  Razon: Vibracion en alta velocidad es sintoma caracteristico de desbalanceo.').
explicacion(fuga_carter_aceite) :- writeln('  Razon: Charco de aceite bajo vehiculo confirma fuga en el carter.').
explicacion(frenos_sobrecalentados) :- writeln('  Razon: Olor a quemado indica sobrecalentamiento y reduccion de capacidad de frenado.').
explicacion(cvt_nissan_altima) :- writeln('  Razon: Vibracion en aceleracion suave junto con resbalamiento de marchas es el patron documentado de falla de la CVT Jatco en Nissan Altima 2013-2018.').
explicacion(cvt_nissan_sentra) :- writeln('  Razon: Patron de falla de CVT documentado ampliamente en Nissan Sentra 2013-2019 (costo tipico reportado 3,590 USD).').
explicacion(cvt_nissan_rogue) :- writeln('  Razon: Falla de rodamiento interno de la CVT que se manifiesta como ruido bajo carga y termina en reemplazo completo.').
explicacion(cvt_nissan_pathfinder) :- writeln('  Razon: Mismo diseno de CVT Jatco reportado en otros modelos Nissan del periodo; costo estimado por analogia.').
explicacion(cvt_nissan_murano) :- writeln('  Razon: Mismo patron de falla de CVT Jatco reportado en la familia Nissan del periodo; costo estimado por analogia.').
explicacion(dct_ford_focus_powershift) :- writeln('  Razon: Sacudidas y vacilacion por desgaste/falla del paquete de embragues secos de la transmision PowerShift (DPS6).').
explicacion(dct_ford_fiesta_powershift) :- writeln('  Razon: Mismo defecto que Ford Focus: sacudidas y falla del paquete de embragues de la transmision PowerShift.').
explicacion(motor_theta2_hyundai_sonata) :- writeln('  Razon: Rebabas metalicas de fabricacion danan cojinetes de biela: golpeteo, consumo de aceite y riesgo de agarrotamiento. Cubierto por recall NHTSA; costo fuera de garantia es estimado.').
explicacion(motor_theta2_hyundai_santafe) :- writeln('  Razon: Mismo defecto de fabricacion del motor Theta II. Cubierto por recall NHTSA; costo fuera de garantia estimado.').
explicacion(motor_theta2_kia_optima) :- writeln('  Razon: Motor Theta II con riesgo de golpeteo, agarrotamiento y, segun recall posterior, riesgo de incendio.').
explicacion(motor_theta2_kia_sportage) :- writeln('  Razon: Motor Theta II compartido con Optima/Sonata/Santa Fe.').
explicacion(dsg_vw_jetta) :- writeln('  Razon: Falla de la unidad mecatronica del DSG7 (DQ200): cambios bruscos, modo de emergencia, perdida de reversa.').
explicacion(dsg_vw_golf) :- writeln('  Razon: Mismo patron de falla de mecatronica DSG7 (DQ200) reportado en Jetta.').
explicacion(dsg_vw_passat) :- writeln('  Razon: Falla del paquete de embragues humedos y/o unidad mecatronica del DSG6 (DQ250).').
explicacion(zf8_jeep_grandcherokee) :- writeln('  Razon: Cambios inconsistentes/vacilacion en el motor V6 3.6L; mayormente resuelto con reprogramacion de TCM (boletin SB-10069301).').
explicacion(zf9_jeep_cherokee) :- writeln('  Razon: Cambios duros, tirones y caida inesperada a neutro; en gran parte por defecto de arnes de cableado (recall) o software.').
explicacion(zf9_chrysler_200) :- writeln('  Razon: Misma transmision ZF9HP48 compartida con Jeep Cherokee; motivo de demanda colectiva por cambios erraticos.').
explicacion(cadena_bmw_n20) :- writeln('  Razon: Guias plasticas de la cadena de distribucion se rompen y pueden causar salto de tiempo y dano catastrofico del motor.').
explicacion(auto_722_mercedes_clasec) :- writeln('  Razon: Cambios bruscos o perdida de comunicacion con la transmision, con frecuencia por falla de la tarjeta conductora interna.').
explicacion(cvt_subaru_legacy_outback) :- writeln('  Razon: Deslizamiento de cadena y desgaste de poleas de la CVT Lineartronic TR690; Subaru extendio la garantia hasta 10 anios/100,000 millas.').
explicacion(cvt_subaru_forester) :- writeln('  Razon: Mismo patron de falla de la CVT Lineartronic reportado en Legacy/Outback.').
explicacion(culata_subaru_ej25) :- writeln('  Razon: Fuga externa de aceite/refrigerante por falla progresiva de la junta de culata del motor boxer EJ25.').
explicacion(auto_honda_accord_v6) :- writeln('  Razon: Falla prematura de la transmision automatica de 5 velocidades; Honda extendio la garantia a 7 anios/100,000 millas.').
explicacion(cvt_honda_accord_crv) :- writeln('  Razon: Vibracion/tiron de la CVT entre 30-45 mph, tipicamente resuelto con reprogramacion de software.').
explicacion(auto6t40_chevrolet_malibu) :- writeln('  Razon: Vibracion del convertidor de par en aceleracion suave y crucero a baja RPM.').
explicacion(refrigerante_chevrolet_cruze) :- writeln('  Razon: Fuga de refrigerante por bomba de agua o multiple de admision, con riesgo de sobrecalentamiento si se ignora.').
explicacion(cvt_mitsubishi_lancer_outlander) :- writeln('  Razon: Vibracion y falla prematura de CVT, patron similar al de otros modelos con CVT Jatco.').
explicacion(multitronic_audi_a4a6) :- writeln('  Razon: Falla de la transmision Multitronic; disponibilidad de reconstruccion limitada, por lo que el reemplazo completo suele ser la unica opcion.').
explicacion(aceite_toyota_2azfe) :- writeln('  Razon: Consumo excesivo de aceite del motor 2AZ-FE por desgaste de aros de piston; motivo de demanda colectiva y extension de garantia.').
explicacion(zf8_ram_1500) :- writeln('  Razon: Vibracion del convertidor de par a baja velocidad/RPM, patron similar al reportado en otros vehiculos con la misma transmision ZF8HP.').
explicacion(suspension_landrover_discovery) :- writeln('  Razon: Sobrecalentamiento y falla del compresor de suspension neumatica, usualmente originado por fugas en los fuelles de aire.').
explicacion(zf9_landrover_discoverysport) :- writeln('  Razon: Transmision ZF9HP de plataforma compartida con Jeep Cherokee y Chrysler/Fiat del mismo periodo.').
explicacion(dct_hyundai_elantra) :- writeln('  Razon: Vibracion y tirones a baja velocidad asociados al paquete de embragues o software del TCU del DCT de 7 velocidades.').
explicacion(zf8_chrysler300_dodgecharger) :- writeln('  Razon: Retraso al pasar de Park/Neutral a Drive e inconsistencia en los cambios, especialmente en frio.').
explicacion(_) :- writeln('  Razon: No hay explicacion detallada disponible.').


% ==========================================
% INFERENCIA: REGLAS DISPARADAS Y COMBINACION DE EVIDENCIA
% ==========================================

% reglas_disparadas(+Marca, +Modelo, +Anio, +Trans, -Disparos)
% Disparos = lista de Certeza-Falla-Simbolos, uno por cada regla que se cumple.
% aplica_vehiculo se evalua primero: no se preguntan sintomas de fallas que no
% aplican al vehiculo.
reglas_disparadas(Marca, Modelo, Anio, Trans, Disparos) :-
    findall(
        C-F-Set,
        (   clause(falla(F, C), Body),
            once(aplica_vehiculo(F, Marca, Modelo, Anio, Trans)),
            call(Body),
            simbolos_de_cuerpo(Body, Set)
        ),
        Disparos
    ).

simbolos_de_cuerpo(Body, Set) :-
    extraer_conjuncion(Body, Goals),
    findall(S, member(sintoma(S), Goals), L0),
    sort(L0, Set).

extraer_conjuncion((A, B), Goals) :- !,
    extraer_conjuncion(A, GA),
    extraer_conjuncion(B, GB),
    append(GA, GB, Goals).
extraer_conjuncion(G, [G]).

% agrupar_certeza(+Disparos, -Resultado): Resultado = lista Certeza-Falla
agrupar_certeza(Disparos, Resultado) :-
    findall(F, member(_-F-_, Disparos), Fs0),
    sort(Fs0, Fs),
    findall(CF-F, ( member(F, Fs), certeza_falla(F, Disparos, CF) ), Resultado).

certeza_falla(F, Disparos, CFRedondeada) :-
    findall(C-S, member(C-F-S, Disparos), Ev0),
    sort(Ev0, Ev),
    findall(C-S, ( member(C-S, Ev), \+ subsumida(S, Ev) ), Independientes),
    combinar_certezas(Independientes, 0.0, CF),
    CFRedondeada is round(CF * 100) / 100.0.

% Una regla esta subsumida si sus sintomas son un subconjunto propio de los de otra
% regla disparada (misma evidencia, no independiente): no se cuenta dos veces.
subsumida(S, Ev) :-
    member(_-S2, Ev),
    S2 \== S,
    subset(S, S2).

% Combinacion de factores de certeza (MYCIN): CF = CF1 + CF2 * (1 - CF1)
combinar_certezas([], CF, CF).
combinar_certezas([C-_|T], Acc, CF) :-
    Acc1 is Acc + C * (1 - Acc),
    combinar_certezas(T, Acc1, CF).

sintomas_respaldo(Falla, Disparos, Respaldo) :-
    findall(S, ( member(_-Falla-Set, Disparos), member(S, Set) ), L0),
    sort(L0, Respaldo).



% FUNCIONES DE REPORTE Y LÓGICA MANUAL
etiqueta_certeza(C, 'ALTA')  :- C >= 0.85, !.
etiqueta_certeza(C, 'MEDIA') :- C >= 0.60, !.
etiqueta_certeza(_, 'BAJA').

etiqueta_urgencia(urgencia(critica), '[!!! CRITICA]') :- !.
etiqueta_urgencia(urgencia(alta),    '[!!  ALTA   ]') :- !.
etiqueta_urgencia(urgencia(media),   '[!   MEDIA  ]') :- !.
etiqueta_urgencia(urgencia(baja),    '[    BAJA   ]') :- !.
etiqueta_urgencia(_,                 '[    ---    ]').

etiqueta_moneda(mxn, 'MXN') :- !.
etiqueta_moneda(usd, 'USD') :- !.
etiqueta_moneda(M, L) :- upcase_atom(M, L).

imprime_pasos([]).
imprime_pasos([H|T]) :-
    (   nombre_reparacion(H, Nombre) -> true ; Nombre = H ),
    format('      - ~w~n', [Nombre]),
    imprime_pasos(T).

reportar_falla(Disparos, Certeza-Falla) :-
    writeln('  --------------------------------------------------'),
    etiqueta_certeza(Certeza, EtiquetaC),
    format('  FALLA DETECTADA : ~w~n', [Falla]),
    (   nombre_falla(Falla, Nombre) -> format('  Descripcion     : ~w~n', [Nombre]) ; true ),
    format('  Confianza       : ~w (~2f)~n', [EtiquetaC, Certeza]),
    (   meta_falla(Falla, Urgencia, costo(Min, Max, Moneda)) ->
        etiqueta_urgencia(Urgencia, EU),
        etiqueta_moneda(Moneda, ML),
        format('  Urgencia        : ~w~n', [EU]),
        format('  Costo estimado  : $~w - $~w ~w~n', [Min, Max, ML])
    ;   true ),
    sintomas_respaldo(Falla, Disparos, Respaldo),
    format('  Sintomas que lo respaldan: ~w~n', [Respaldo]),
    (   fuente_falla(Falla, Fuente) -> format('  Fuente del dato : ~w~n', [Fuente]) ; true ),
    (   confianza_dato(Falla, CD) -> format('  Confianza del dato: ~w~n', [CD]) ; true ),
    writeln('  Por que se detecto:'),
    once(explicacion(Falla)),
    (   reparacion(Falla, Pasos) ->
        writeln('  Pasos sugeridos de reparacion / verificacion:'),
        imprime_pasos(Pasos)
    ;   writeln('  (Sin pasos de reparacion registrados)') ).

ordenar_fallas(Fallas, FallasOrdenadas) :-
    sort(Fallas, FallasAsc),
    invertir_lista(FallasAsc, [], FallasOrdenadas).

invertir_lista([], Acc, Acc).
invertir_lista([H|T], Acc, Res) :-
    invertir_lista(T, [H|Acc], Res).

imprimir_fallas(_, []).
imprimir_fallas(Disparos, [C-F|T]) :-
    reportar_falla(Disparos, C-F),
    imprimir_fallas(Disparos, T).

imprimir_sintomas_confirmados :-
    sintomas_confirmados(Lista),
    (Lista = [] ->
        writeln('  (Ninguno confirmado)')
    ;
        invertir_lista(Lista, [], ListaOrdenada),
        imprimir_sintomas(ListaOrdenada)
    ).

imprimir_sintomas([]).
imprimir_sintomas([S|T]) :-
    format('  [+] ~w~n', [S]),
    imprimir_sintomas(T).

limpiar_memoria :-
    retractall(conocido(_, _, _)),
    retractall(vehiculo_actual(_, _, _, _)),
    retractall(sintomas_confirmados(_)),
    asserta(sintomas_confirmados([])).



% ==========================================
% HISTORIAL DE DIAGNOSTICOS (trazabilidad, solo en memoria)
% ==========================================
limite_historial(100).

registrar_historial(Marca, Modelo, Anio, Trans, Sintomas, Ordenadas) :-
    get_time(T),
    findall(F-C, member(C-F, Ordenadas), Pares),
    assertz(historial_diagnostico(h(T, Marca, Modelo, Anio, Trans, Sintomas, Pares))),
    recortar_historial.

recortar_historial :-
    limite_historial(L),
    findall(x, historial_diagnostico(_), Xs),
    length(Xs, N),
    (   N > L
    ->  once(retract(historial_diagnostico(_))),
        recortar_historial
    ;   true ).

historial_a_dict(h(T, M, Mo, A, Tr, S, Pares), Dict) :-
    maplist(par_falla_a_dict, Pares, FD),
    Dict = _{ timestamp: T,
              vehiculo: _{marca: M, modelo: Mo, anio: A, transmision: Tr},
              sintomas: S,
              fallas: FD }.

par_falla_a_dict(F-C, D) :- D = _{id: F, certeza: C}.

% ==========================================
% VALIDACION DE LA BASE DE CONOCIMIENTO
% Uso:  ?- validar_kb.
% ==========================================
validar_kb :-
    validar_kb(N),
    (   N =:= 0
    ->  writeln('[OK] Base de conocimiento consistente: sin alertas.')
    ;   format('[!] La validacion reporto ~w alerta(s).~n', [N]) ).

validar_kb(N) :-
    findall(F, clause(falla(F, _), _), Fs0),
    sort(Fs0, Fs),
    findall(A, ( member(F, Fs), alerta_falla(F, A) ), AF),
    findall(S, ( clause(falla(_, _), Body), simbolos_de_cuerpo(Body, Ss), member(S, Ss) ), Sx0),
    sort(Sx0, Sx),
    findall(A, ( member(S, Sx), alerta_sintoma(S, A) ), AS),
    findall(A, ( clause(sintoma(S), _), \+ memberchk(S, Sx),
                 format(atom(A), 'El sintoma ~w esta declarado pero ninguna regla lo usa', [S]) ), AO),
    findall(A, ( clause(aplica_a(F, _, _, _, _), _), \+ clause(falla(F, _), _),
                 format(atom(A), 'aplica_a/5 apunta a la falla inexistente ~w', [F]) ), AH),
    append([AF, AS, AO, AH], Todas0),
    sort(Todas0, Todas),
    maplist(imprimir_alerta, Todas),
    length(Todas, N).

imprimir_alerta(A) :- format('  [ALERTA] ~w~n', [A]).

alerta_falla(F, A) :-
    \+ nombre_falla(F, _),
    format(atom(A), 'Falta nombre_falla/2 para ~w', [F]).
alerta_falla(F, A) :-
    \+ meta_falla(F, _, _),
    format(atom(A), 'Falta meta_falla/3 para ~w', [F]).
alerta_falla(F, A) :-
    meta_falla(F, Urg, Costo),
    meta_problema(Urg, Costo, Motivo),
    format(atom(A), 'meta_falla/3 invalida para ~w: ~w', [F, Motivo]).
alerta_falla(F, A) :-
    \+ reparacion(F, _),
    format(atom(A), 'Falta reparacion/2 para ~w', [F]).
alerta_falla(F, A) :-
    reparacion(F, Pasos),
    member(P, Pasos),
    \+ nombre_reparacion(P, _),
    format(atom(A), 'Falta nombre_reparacion/2 para el paso ~w (falla ~w)', [P, F]).
alerta_falla(F, A) :-
    \+ clause(aplica_a(F, _, _, _, _), _),
    format(atom(A), 'Falta aplica_a/5 para ~w', [F]).
alerta_falla(F, A) :-
    \+ tiene_explicacion(F),
    format(atom(A), 'Falta explicacion/1 especifica para ~w', [F]).
alerta_falla(F, A) :-
    clause(falla(F, C), _),
    (   \+ number(C) ; C =< 0 ; C > 1 ),
    format(atom(A), 'Certeza fuera de rango (0-1] en una regla de ~w', [F]).

meta_problema(Urg, _, 'urgencia no reconocida') :-
    \+ memberchk(Urg, [urgencia(critica), urgencia(alta), urgencia(media), urgencia(baja)]).
meta_problema(_, Costo, 'el costo debe ser costo(Min,Max,Moneda)') :-
    \+ Costo = costo(_, _, _).
meta_problema(_, costo(Min, Max, _), 'costo minimo mayor que el maximo') :-
    number(Min), number(Max), Min > Max.
meta_problema(_, costo(_, _, Moneda), 'moneda no reconocida (use mxn o usd)') :-
    \+ memberchk(Moneda, [mxn, usd]).

tiene_explicacion(F) :-
    clause(explicacion(X), _),
    nonvar(X),
    X == F,
    !.

alerta_sintoma(S, A) :-
    \+ clause(sintoma(S), _),
    format(atom(A), 'El sintoma ~w se usa en una regla pero no existe sintoma/1', [S]).
alerta_sintoma(S, A) :-
    clause(sintoma(S), _),
    \+ nombre_sintoma(S, _),
    format(atom(A), 'Falta nombre_sintoma/2 para ~w', [S]).
alerta_sintoma(S, A) :-
    clause(sintoma(S), _),
    \+ categoria_sintoma(S, _),
    format(atom(A), 'Falta categoria_sintoma/2 para ~w', [S]).



% FLUJO PRINCIPAL POR CONSOLA
inicio :-
    limpiar_memoria,
    nl,
    writeln('=================================================='),
    writeln('    SISTEMA EXPERTO - TALLER AUTOMOTRIZ v3.0'),
    writeln('=================================================='),
    nl,
    writeln('Ingrese los datos del vehiculo.'),
    writeln('(Use "gen" para marca/modelo no listado, 0 para anio desconocido,'),
    writeln(' y "desconocida" si no sabe el tipo de transmision)'),
    nl,
    write('  Marca  (ej: nissan, toyota, volkswagen): '), read(Marca),
    write('  Modelo (ej: sentra, corolla, jetta)    : '), read(Modelo),
    write('  Anio   (ej: 2015)                      : '), read(Anio),
    write('  Transmision (manual/automatica/cvt/dct/desconocida): '), read(TransIn),
    normalizar_transmision(TransIn, Trans),

    asserta(vehiculo_actual(Marca, Modelo, Anio, Trans)),
    nl,
    writeln('=================================================='),
    format('  Vehiculo registrado: ~w ~w (~w) - transmision: ~w~n', [Marca, Modelo, Anio, Trans]),
    writeln('=================================================='),
    nl,
    writeln('Responda con s. (si) o n. (no) las siguientes preguntas.'),
    nl,

    vehiculo_actual(MarcaG, ModeloG, AnioG, TransG),
    reglas_disparadas(MarcaG, ModeloG, AnioG, TransG, Disparos),
    agrupar_certeza(Disparos, Fallas),

    nl,
    writeln('=================================================='),
    writeln('             RESULTADOS DEL DIAGNOSTICO'),
    writeln('=================================================='),

    (Fallas = [] ->
        writeln('  No se pudo determinar ninguna falla con los sintomas indicados.'),
        FallasOrdenadas = []
    ;
        ordenar_fallas(Fallas, FallasOrdenadas),
        imprimir_fallas(Disparos, FallasOrdenadas)
    ),

    sintomas_confirmados(Confirmados),
    registrar_historial(MarcaG, ModeloG, AnioG, TransG, Confirmados, FallasOrdenadas),

    nl,
    writeln('=================================================='),
    writeln('         SINTOMAS CONFIRMADOS EN ESTA SESION'),
    writeln('=================================================='),
    imprimir_sintomas_confirmados,
    nl,
    writeln('=================================================='),
    writeln('         Diagnostico finalizado. '),
    writeln('=================================================='),
    nl,
    limpiar_memoria.



% ==========================================
% SERVIDOR WEB API (CONEXIÓN CON JS)
% ==========================================
:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).
:- use_module(library(http/http_cors)).
% `library(http/http_parameters)` aporta `http_parameters/2`, que lee los
% parametros de la query y del cuerpo de un PUT/DELETE. No basta con
% `thread_httpd`: los handlers se ejecutan en el modulo `user` y, sin este
% import, SWI responde "Unknown procedure" con 500 en vez de un 400 de
% peticion invalida. `post_type(string)` hace que un `prologId=` ausente o mal
% formado falle aqui y no mas abajo.
:- use_module(library(http/http_parameters)).

:- set_setting(http:cors, [*]). % Permite recibir peticiones de cualquier página web

% Endpoints (método principal + preflight OPTIONS del navegador)
:- http_handler(root(api/diagnostico), con_token(procesar_api), [methods([options, post]), time_limit(infinite)]).
:- http_handler(root(api/sintomas), con_token(procesar_sintomas), [methods([options, get])]).
:- http_handler(root(api/fallas), con_token(procesar_fallas_dinamicas), [methods([options, get, post, put, delete]), time_limit(infinite)]).
:- http_handler(root(api/fallas/bootstrap), con_token(procesar_bootstrap_fallas), [methods([options, post]), time_limit(infinite)]).
:- http_handler(root(api/historial), con_token(procesar_historial), [methods([options, get])]).   % NUEVO (aditivo)

% Sonda de salud. No lleva con_token a proposito: la pide el orquestador, que no
% conoce el token, y no toca la base de conocimiento, asi que no puede colgarse.
:- http_handler(root(health), procesar_health, [methods([get])]).

procesar_health(_Request) :-
    reply_json_dict(_{status: "ok"}).

% El motor no comprueba nada por si mismo: cualquiera que alcance su puerto
% podria vaciar el catalogo (DELETE /api/fallas) o sobreescribirlo (bootstrap).
% El backend expone solo lo necesario, pero esa es una capa que se puede
% rodear; esta es la que hay que atravesar. Todas las rutas exigen la cabecera
% X-Motor-Token con el valor que comparte con la API. El preflight (OPTIONS)
% queda fuera: el navegador no puede mandar cabeceras propias en un OPTIONS y
% ese handler solo responde CORS, no toca el catalogo.
%
% Sin MOTOR_TOKEN definido el motor queda ABIERTO (acepta sin token) y lo avisa
% por stderr al arrancar. Es el estado que necesita un despliegue por etapas: se
% puede levantar el motor nuevo antes de que exista la variable, sin que la API
% vieja (que aun no manda token) reciba 401. No es un modo para produccion.
con_token(Handler, Request) :-
    (   memberchk(method(options), Request)
    ->  call(Handler, Request)
    ;   token_motor(Esperado)
    ->  (   memberchk(x_motor_token(Recibido), Request),
            token_coincide(Recibido, Esperado)
        ->  call(Handler, Request)
        ;   reply_json_dict(_{error: 'No autorizado'}, [status(401)])
        )
    ;   call(Handler, Request)
    ).

% SWI lee el valor de la cabecera como termino Prolog, asi que el token no puede
% llevar espacios ni comillas: por eso se genera hexadecimal. Sin la variable
% esta clausula falla y con_token/2 deja pasar: el aviso de arranque es lo que
% hace visible que la proteccion esta apagada. En produccion la define la task
% definition, con el mismo valor en los dos contenedores.
token_motor(Token) :-
    catch(getenv('MOTOR_TOKEN', Valor), _, fail),
    Valor \== '',
    Token = Valor.

% La cabecera llega como atomo (y el valor de getenv tambien puede ser string o
% atomo, segun la version): se normalizan los dos lados antes de comparar. El
% guardia atomic/1 corta el caso en que el cliente mande algo que SWI no lea como
% atomo: sin el, atom_string/2 lanzaria un error y el 401 se volveria un 500.
token_coincide(Recibido, Esperado) :-
    atomic(Recibido),
    atom_string(Recibido, R),
    atomic(Esperado),
    atom_string(Esperado, R).

cors_reply(Metodos) :-
    maplist(upcase_atom, Metodos, MetodosUp),
    atomic_list_concat(MetodosUp, ', ', MetodosStr),
    format('Access-Control-Allow-Origin: *~n'),
    format('Access-Control-Allow-Methods: ~s~n', [MetodosStr]),
    format('Access-Control-Allow-Headers: Content-Type~n'),
    format('~n').

% Sondeo del puerto antes de arrancar. SWI activa SO_REUSEADDR al crear el
% socket del servidor (thread_httpd.pl: tcp_setopt(Socket, reuseaddr)). En Linux
% eso solo cubre puertos en TIME_WAIT, pero en Windows permite enlazarse a un
% puerto que YA tiene un listener activo. Por eso arrancar un segundo motor en
% el mismo puerto no falla de forma limpia: el bind tiene exito, ambos procesos
% compiten por las conexiones y el error aflora despues y sin contexto, como
% "thread httpd@80001 socket error" (ese 80001 es el worker #1 del pool, no un
% puerto).
%
% Sondeamos con un bind SIN reuseaddr: si algo ya escucha en el puerto, el bind
% falla con socket_error y lo Reportamos como ocupado. Se usa bind y no
% tcp_connect a proposito, para no abrir y cerrar una conexion contra el
% servidor que ya esta corriendo, lo que dejaria una peticion vacia en su consola.
%
% El catch acota el patron a socket_error a proposito: si se comiera cualquier
% error, un fallo de este mismo sondeo (autoload, permisos) se reportaria como
% "puerto ocupado", que es un diagnostico falso. Cualquier otro error sube.
puerto_ocupado(Puerto) :-
    socket_create(S, [domain(inet)]),
    catch(( tcp_bind(S, Puerto), Resultado = libre ),
          error(socket_error(_, _), _), Resultado = ocupado),
    catch(tcp_close_socket(S), _, true),
    Resultado == ocupado.

% Comando para arrancar el servidor. El puerto lo puede fijar el contenedor con
% PORT; sin la variable queda el 8000 de siempre, que es el que usan los scripts
% locales. server/1 sigue disponible para forzar otro puerto a mano.
server :-
    (   catch(getenv('PORT', Valor), _, fail),
        Valor \== '',
        atom_string(Valor, Texto),
        number_string(Puerto, Texto),
        integer(Puerto)
    ->  true
    ;   Puerto = 8000
    ),
    server(Puerto).
server(Puerto) :-
    (   puerto_ocupado(Puerto)
    ->          format(user_error, '[!] El puerto ~w ya esta ocupado.~n', [Puerto]),
        format(user_error, '[!] No se arranca un segundo motor: ambos procesos~n', []),
        format(user_error, '[!] competirian por las conexiones y el fallo~n', []),
        format(user_error, '[!] apareceria despues y sin contexto.~n', []),
        format(user_error, '[!] Cierra la instancia anterior, o arranca con:~n', []),
        format(user_error, '[!]     server(OtroPuerto).~n~n', []),
        halt(1)
    ;   true
    ),
    catch(validar_kb(N), E, ( format('[!] No se pudo validar la KB: ~w~n', [E]), N = -1 )),
    (   token_motor(_)
    ->  true
    ;   format(user_error, '[!] MOTOR_TOKEN no esta definido: el motor acepta~n', []),
        format(user_error, '[!] peticiones SIN token. Definelo en produccion.~n~n', [])
    ),
    http_server(http_dispatch, [port(Puerto)]),
    format('~n[+] Servidor Prolog corriendo exitosamente en http://localhost:~w/~n', [Puerto]),
    (   N =:= 0
    ->  writeln('[+] Base de conocimiento validada sin alertas.')
    ;   format('[!] Validacion de la KB: ~w alerta(s) (ver arriba).~n', [N]) ),
    format('[+] Pagina Web lista para abrir.~n~n').

campo_json(Clave, Dict, Defecto, Valor) :-
    (   get_dict(Clave, Dict, V) -> Valor = V ; Valor = Defecto ).

procesar_api(Request) :-
    option(method(options), Request),
    !,
    cors_reply([post]).
procesar_api(Request) :-
    cors_enable,
    http_read_json_dict(Request, DictIn),

    % Extraer datos del JSON. marca/modelo/anio/sintomas ya existian;
    % "transmision" es NUEVO y OPCIONAL (si falta => desconocida => sin filtro).
    campo_json(marca,       DictIn, "gen", MarcaStr),
    campo_json(modelo,      DictIn, "gen", ModeloStr),
    campo_json(anio,        DictIn, 0,     AnioIn),
    campo_json(sintomas,    DictIn, [],    SintomasStr),
    campo_json(transmision, DictIn, "desconocida", TransStr),

    % Normalizar a los átomos/números que usa la base de conocimiento
    % (en el thread HTTP string y átomo NO unifican).
    normalizar_identificador(MarcaStr, Marca),
    normalizar_identificador(ModeloStr, Modelo),
    normalizar_anio(AnioIn, Anio),
    normalizar_transmision(TransStr, Trans),
    maplist(atom_string, Sintomas, SintomasStr),

    % Exclusión mutua: la memoria dinámica es global, dos peticiones
    % simultáneas no deben mezclar sus síntomas.
    with_mutex(diagnostico_mutex,
               diagnosticar_http(Marca, Modelo, Anio, Trans, Sintomas, FallasDict)),

    Respuesta = _{
        status: "success",
        vehiculo: _{marca: MarcaStr, modelo: ModeloStr, anio: AnioIn, transmision: Trans},
        fallas: FallasDict
    },
    reply_json_dict(Respuesta).

diagnosticar_http(Marca, Modelo, Anio, Trans, Sintomas, FallasDict) :-
    limpiar_memoria,
    retractall(sintomas_confirmados(_)),
    asserta(sintomas_confirmados(Sintomas)),
    asserta(vehiculo_actual(Marca, Modelo, Anio, Trans)),

    % Inyectar conocimiento: TODOS los síntomas se marcan como NO confirmados
    % y los recibidos como confirmados. Así las reglas nunca preguntan a consola.
    inyectar_conocimiento(Sintomas),
    asserta(modo_http),
    setup_call_cleanup(
        true,
        (
            reglas_disparadas(Marca, Modelo, Anio, Trans, Disparos),
            agrupar_certeza(Disparos, Fallas),
            ordenar_fallas(Fallas, FallasOrdenadas),
            maplist(falla_a_dict(Disparos), FallasOrdenadas, FallasDict),
            registrar_historial(Marca, Modelo, Anio, Trans, Sintomas, FallasOrdenadas)
        ),
        ( retractall(modo_http), limpiar_memoria )
    ).

inyectar_conocimiento(Sintomas) :-
    findall(S, clause(sintoma(S), _), TodosLosSintomas),
    maplist(negacion_sintoma, TodosLosSintomas),
    maplist(inyectar_sintoma, Sintomas).

negacion_sintoma(S) :- asserta(conocido(n, sintoma, S)).
inyectar_sintoma(S) :- asserta(conocido(s, sintoma, S)).

% Campos originales: id, certeza, urgencia, costo_min, costo_max, reparaciones.
% Campos NUEVOS (aditivos): nombre, moneda, sintomas_relacionados, fuente, confianza_dato.
falla_a_dict(Disparos, Certeza-Falla, Dict) :-
    (   meta_falla(Falla, urgencia(Urg), costo(Min, Max, Moneda)) -> true
    ;   Urg = desconocida, Min = 0, Max = 0, Moneda = desconocida ),
    (   reparacion(Falla, Rep) -> true ; Rep = [] ),
    maplist(reparacion_a_nombre, Rep, RepNombres),
    (   nombre_falla(Falla, Nombre) -> true ; atom_string(Nombre, Falla) ),
    sintomas_respaldo(Falla, Disparos, Respaldo),
    (   fuente_falla(Falla, Fuente) -> true
    ;   Fuente = 'Base original del sistema (sin fuente registrada)' ),
    (   confianza_dato(Falla, CD) -> true ; CD = no_registrada ),
    % Las causas las declaran las fallas de usuario; la base estatica no las
    % modela, asi que degradan a lista vacia en vez de romper el diagnostico.
    (   causa_falla(Falla, Causas) -> true ; Causas = [] ),
    (   observaciones_falla(Falla, Obs) -> true ; Obs = '' ),
    Dict = _{
        id: Falla,
        nombre: Nombre,
        certeza: Certeza,
        urgencia: Urg,
        costo_min: Min,
        costo_max: Max,
        moneda: Moneda,
        reparaciones: RepNombres,
        sintomas_relacionados: Respaldo,
        causas: Causas,
        fuente: Fuente,
        confianza_dato: CD,
        observaciones: Obs
    }.

reparacion_a_nombre(R, Nombre) :-
    (nombre_reparacion(R, Nombre) -> true ; atom_string(Nombre, R)).

procesar_sintomas(Request) :-
    option(method(options), Request),
    !,
    cors_reply([get]).
procesar_sintomas(_Request) :-
    cors_enable,
    findall(S, clause(sintoma(S), _), SintomasIds),
    sort(SintomasIds, SintomasOrdenados),
    maplist(sintoma_a_dict, SintomasOrdenados, SintomasDict),
    reply_json_dict(_{
        status: "success",
        sintomas: SintomasDict
    }).

sintoma_a_dict(S, Dict) :-
    (nombre_sintoma(S, N) -> true ; atom_string(N, S)),
    (categoria_sintoma(S, C) -> true ; C = "General"),
    Dict = _{
        id: S,
        nombre: N,
        categoria: C
    }.

procesar_fallas(Request) :-
    option(method(options), Request),
    !,
    cors_reply([get]).
procesar_fallas(_Request) :-
    cors_enable,
    findall(F, clause(falla(F, _), _), FallasIds),
    sort(FallasIds, FallasOrdenadas),
    maplist(falla_meta_a_dict, FallasOrdenadas, FallasDict),
    reply_json_dict(_{
        status: "success",
        fallas: FallasDict
    }).

% ==========================================
% CRUD FALLAS DINÁMICAS + BOOTSTRAP
% ==========================================

% Toda mutacion del catalogo toma el MISMO mutex que el diagnostico. El
% diagnostico enumera `falla/2` mientras infiere; si un POST, un PUT, un DELETE o
% un bootstrap afirmara o retrayera clausulas a mitad de esa enumeracion, el
% resultado saldria armado con dos versiones del catalogo a la vez. Con el mutex
% compartido las dos operaciones se serializan y cada diagnostico ve una sola
% version. El `once/1` no es decorativo: `with_mutex/2` suelta el cerrojo al
% terminar, pero si el objetivo deja puntos de eleccion lo conserva hasta el
% backtracking, y aqui no hay ninguno que los consuma.
procesar_fallas_dinamicas(Request) :-
    option(method(options), Request),
    !,
    cors_reply([get, post, put, delete]).

procesar_fallas_dinamicas(Request) :-
    option(method(get), Request),
    !,
    cors_enable,
    procesar_fallas(Request).

procesar_fallas_dinamicas(Request) :-
    option(method(post), Request),
    !,
    cors_enable,
    http_read_json_dict(Request, DictIn),
    with_mutex(diagnostico_mutex, once(procesar_falla_crear(DictIn, Resp))),
    reply_json_dict(Resp).

procesar_fallas_dinamicas(Request) :-
    option(method(put), Request),
    !,
    cors_enable,
    prolog_id_de_query(Request, QId),
    (   QId == sin_prolog_id
    ->  reply_json_dict(_{error:'prologId requerido'}, [status(400)])
    ;   http_read_json_dict(Request, DictIn),
        % El identificador viene en la URL y no en el cuerpo: si no se copiara
        % al dict, el cuerpo podría traer otro prologId y la falla se escribiría
        % bajo un functor distinto del que se pidió editar.
        put_dict(prologId, DictIn, QId, DictConId),
        with_mutex(diagnostico_mutex, once(procesar_falla_crear(DictConId, Resp))),
        reply_json_dict(Resp)
    ).

procesar_fallas_dinamicas(Request) :-
    option(method(delete), Request),
    !,
    cors_enable,
    prolog_id_de_query(Request, QId),
    (   QId == sin_prolog_id
    ->  reply_json_dict(_{error:'prologId requerido'}, [status(400)])
    ;   % La decision de si existia se toma DENTRO del mutex: preguntarla fuera
        % dejaria una ventana en la que otro borrado o el bootstrap la retracta
        % entre el `falla_usuario/1` y el `retractar_falla_dinamica/1`.
        with_mutex(diagnostico_mutex,
                   once(( falla_usuario(QId)
                        -> retractar_falla_dinamica(QId), Borrada = true
                        ;  Borrada = false
                        ))),
        (   Borrada == true
        ->  reply_json_dict(_{status:'success', action:'retracted'})
        ;   reply_json_dict(_{status:'not_found'}, [status(404)])
        )
    ).

% Lee el `prologId` de la query string. DELETE y PUT llamaban a
% `http_current_query/2`, que no existe en SWI-Prolog, asi que el motor
% respondia 500 `Unknown procedure`, el backend solo lo dejaba anotado en el log
% y la borrada nunca llegaba a retractarse: la falla seguia viva en el motor.
%
% `http_parameters/2` si existe, pero no devuelve un dict: recibe la LISTA de
% parametros que se quieren extraer, en la forma `Nombre(Valor, Opciones)`, y
% lanza excepcion si el parametro no viene. Por eso va dentro de un `catch` que
% degrada a `sin_prolog_id`, que los handlers traducen a un 400 explicito.
% La query tiene prioridad sobre el cuerpo (`http_parms/4` busca `search` antes
% que el POST), asi que un PUT con cuerpo JSON tambien funciona.
prolog_id_de_query(Request, PrologId) :-
    (   catch(http_parameters(Request, [prologId(Id, [post_type(string)])]), _, fail),
        Id \== ''
    ->  PrologId = Id
    ;   PrologId = sin_prolog_id
    ).

procesar_bootstrap_fallas(Request) :-
    option(method(options), Request),
    !,
    cors_reply([post]).

procesar_bootstrap_fallas(Request) :-
    cors_enable,
    http_read_json_dict(Request, DictIn),
    (   get_dict(fallas, DictIn, FallasList), is_list(FallasList)
    ->  % El borrado global y la recarga entran juntos en el mutex: si se
        % partieran, un diagnostico podria correr entre las dos y ver el catalogo
        % vaciado, que es justo el estado que el bootstrap viene a reemplazar.
        with_mutex(diagnostico_mutex,
                   once(( limpiar_dinamicas_usuario, procesar_lote_fallas(FallasList, 0, N) ))),
        reply_json_dict(_{status:'success', count:N})
    ;   reply_json_dict(_{error:'fallas[] requerido'}, [status(400)])
    ).

procesar_lote_fallas([], N, N).
procesar_lote_fallas([F|T], Acc, N) :-
    ignore(procesar_falla_crear(F, _)),
    Acc1 is Acc + 1,
    procesar_lote_fallas(T, Acc1, N).

% Una falla sin sintomas no se guarda. La falla se afirma como REGLA cuyo cuerpo
% es la conjuncion de sus sintomas, y `falla(P, C) :- true` se dispararia en
% todos los diagnosticos, es decir, apareceria aunque no hubiera un solo sintoma
% en comun. El endpoint Prolog es un limite de confianza: el backend tambien lo
% valida, peroreachable directo no se puede quedar solo con esa capa.
procesar_falla_crear(DictIn, Resp) :-
    (   falla_incompleta(DictIn, Motivo)
    ->  reply_json_dict(_{status:'error', error:Motivo}, [status(400)])
    ;   crear_falla_dinamica(DictIn, Resp)
    ).

falla_incompleta(DictIn, 'La falla debe declarar al menos un sintoma') :-
    \+ ( get_dict(sintomas, DictIn, Ss), is_list(Ss), Ss \== [] ),
    !.
falla_incompleta(DictIn, 'La falla debe indicar marca, modelo y transmision del vehiculo') :-
    \+ vehiculo_completo(DictIn),
    !.

vehiculo_completo(DictIn) :-
    is_dict(DictIn),
    get_dict(vehiculo, DictIn, Veh),
    is_dict(Veh),
    get_dict(marca, Veh, M),    M \== '',    \+ M == null,
    get_dict(modelo, Veh, Mo),  Mo \== '',   \+ Mo == null,
    get_dict(transmision, Veh, T), T \== '', \+ T == null.

% El ano se guarda como RANGO y no como valor unico porque es como lo declara la
% base estatica: las fallas por vehiculo usan guards `Anio >= Min, Anio =< Max`.
% El administrador que no conoce el rango escribe el mismo ano en ambos extremos
% y queda con la semantica exacta que quiere.
vehiculo_aplicable(DictIn, Marca, Modelo, Trans, AnioDesde, AnioHasta) :-
    get_dict(vehiculo, DictIn, Veh),
    get_dict(marca, Veh, M),       normalizar_identificador(M, Marca),
    get_dict(modelo, Veh, Mo),     normalizar_identificador(Mo, Modelo),
    get_dict(transmision, Veh, T), normalizar_transmision(T, Trans),
    (   anio_entero(Veh, anioDesde, Desde) -> true ; Desde = 0 ),
    (   anio_entero(Veh, anioHasta,  Hasta) -> true ; Hasta = 0 ),
    rango_anios(Desde, Hasta, AnioDesde, AnioHasta).

anio_entero(Veh, Clave, Valor) :-
    get_dict(Clave, Veh, Valor),
    (   integer(Valor)
    ->  true
    ;   (   atom_string(A, Valor), atom_number(A, N), integer(N)
        ->  Valor = N
        ;   fail
        )
    ).

% Sin rango declarado la falla aplica a cualquier ano. Con rango, se toleran los
% extremos invertidos porque el formulario puede mandarlos en cualquier orden.
rango_anios(0, 0, 0, 9999) :- !.
rango_anios(Desde, Hasta, Min, Max) :-
    (   Desde =< Hasta
    ->  Min = Desde, Max = Hasta
    ;   Min = Hasta, Max = Desde
    ).

% Construye el cuerpo de la regla `falla/2` como la conjuncion de sus sintomas,
% con la misma forma anidada `(sintoma(A), sintoma(B), ...)` que usan las fallas
% estaticas, para que `extraer_conjuncion/2` las lea igual.
cuerpo_sintomas([], true).
cuerpo_sintomas([S|Ss], (sintoma(S), Resto)) :-
    cuerpo_sintomas(Ss, Resto).

crear_falla_dinamica(DictIn, Resp) :-
    (   get_dict(nombre, DictIn, NombreStr)
    ->  true
    ;   NombreStr = ''
    ),
    (   get_dict(prologId, DictIn, PrologId0)
    ->  atom_string(PrologId, PrologId0)
    ;   slug_prolog_id(NombreStr, PrologId)
    ),
    (   get_dict(sintomas, DictIn, SintomasIn), is_list(SintomasIn)
    ->  maplist(normalizar_id_sintoma, SintomasIn, SintomasList)
    ;   SintomasList = []
    ),
    (   get_dict(procedimiento, DictIn, ProcIn), is_list(ProcIn)
    ->  ProcList = ProcIn
    ;   ProcList = []
    ),
    (   get_dict(causas, DictIn, CausasIn), is_list(CausasIn)
    ->  CausasList = CausasIn
    ;   CausasList = []
    ),
    % El vehiculo se normaliza con las MISMAS funciones que usa el diagnostico
    % (`procesar_api/1`): `aplica_vehiculo/5` compara por unificacion y en el
    % hilo HTTP un string no unifica con un atomo.
    vehiculo_aplicable(DictIn, VehMarca, VehModelo, VehTrans, AnioDesde, AnioHasta),
    (   get_dict(precioMin, DictIn, PM)
    ->  PrecioMin = PM
    ;   PrecioMin = 0
    ),
    (   get_dict(precioMax, DictIn, PMx)
    ->  PrecioMax = PMx
    ;   PrecioMax = 0
    ),
    % La moneda llega en el cuerpo y se respeta en vez de fijarla a mano: si aqui
    % se escribiera siempre `mxn`, una falla dinamica mostraria una moneda distinta
    % de las de la base estatica, que si la declaran.
    (   get_dict(moneda, DictIn, Mon)
    ->  MonedaAtom = Mon
    ;   MonedaAtom = mxn
    ),
    % `vehiculo` y `causas` si se modelan: el primero es lo que permite que la
    % falla se limite a un vehiculo en vez de aparecer en todo diagnostico, y las
    % causas se devuelven con el resultado. `solucion` sigue sin modelarse: es
    % texto largo de taller, no participa del razonamiento y se consulta en Mongo.
    (   get_dict(urgencia, DictIn, Urg)
    ->  UrgAtom = Urg
    ;   UrgAtom = media
    ),
    (   get_dict(confianzaDato, DictIn, CD)
    ->  CDAtom = CD
    ;   CDAtom = media
    ),
    (   get_dict(fuenteFalla, DictIn, FF)
    ->  FFText = FF
    ;   FFText = 'Registrado por usuario (Administrador/Mecánico)'
    ),
    (   get_dict(certezaBase, DictIn, CB), number(CB)
    ->  CertezaBase = CB
    ;   CertezaBase = 0.7
    ),
    (   get_dict(observaciones, DictIn, ObsIn)
    ->  (   string(ObsIn) -> Obs = ObsIn ; term_string(ObsIn, Obs) )
    ;   Obs = ''
    ),
    (   falla_usuario(PrologId)
    ->  retractar_falla_dinamica(PrologId)
    ;   true
    ),
    asegurar_sintomas_usuario(SintomasList),
    cuerpo_sintomas(SintomasList, SintomasCuerpo),
    assertz((falla(PrologId, CertezaBase) :- SintomasCuerpo)),
    (   string(NombreStr) -> atom_string(NomAtomF, NombreStr); NomAtomF = NombreStr ),
    assertz(nombre_falla(PrologId, NomAtomF)),
    assertz(meta_falla(PrologId, urgencia(UrgAtom), costo(PrecioMin, PrecioMax, MonedaAtom))),
    maplist(atom_string, PasosAtoms, ProcList),
    assertz(reparacion(PrologId, PasosAtoms)),
    maplist(assert_nombre_paso, PasosAtoms, ProcList),
    assertz((aplica_a(PrologId, VehMarca, VehModelo, Anio, VehTrans)
             :- Anio >= AnioDesde, Anio =< AnioHasta)),
    (   CausasList \== []
    ->  assertz(causa_falla(PrologId, CausasList))
    ;   true
    ),
    assertz(fuente_falla(PrologId, FFText)),
    assertz(confianza_dato(PrologId, CDAtom)),
    assertz(explicacion(PrologId)),
    assertz(falla_usuario(PrologId)),
    (   Obs == '' -> true ; assertz(observaciones_falla(PrologId, Obs)) ),
    Resp = _{status:'success', prologId:PrologId}.

% Normaliza un nombre al `prologId` que usa el resto del sistema. Replica
% `slugPrologId` del backend, que es la unica fuente de verdad del identificador:
%
%   minusculas -> NFD sin marcas -> separador `_+` por cualquier corrida que no
%   sea [a-z0-9] -> se quitan los `_` de los extremos.
%
% El backend reemplaza ESPACIOS por `_`, no los borra: "Fuga de refrigerante" es
% `fuga_de_refrigerante`. Por eso el guion bajo es un caracter de salida y no uno
% descartable; cuando se filtraba, el motor guardaba la falla como
% `fugaderefrigerante`, un id que el catalogo, el diagnostico y el borrado nunca
% reconocen. Tampoco se admiten acentuados: el backend aplica NFD y los retira.
slug_prolog_id(NombreStr, PrologId) :-
    string_lower(NombreStr, L),
    string_codes(L, Codes),
    partes_palabras(Codes, Partes),
    une_partes(Partes, SlugStr),
    (   SlugStr == ''
    ->  PrologId = f_dinamica
    ;   atom_string(PrologId, SlugStr)
    ).

% Parte el texto en las palabras que el backend separaria con `_`. El backend
% hace `replace(/[^a-z0-9]+/g, '_')`: una CORRIDA de caracteres no admitidos se
% convierte en un unico `_`. Como los espacios caen dentro de esa corrida, "Fuga
% de refrigerante" produce tres partes y no una. Antes cada caracter no admitido
% se descartaba y el id quedaba pegado (`fugaderefrigerante`), que es un functor
% que ni el catalogo ni el diagnostico ni el borrado reconocen. Al partir en
% palabras y descartar las vacias queda hecho de paso el recorte de `_` de los
% extremos, que el backend hace con `replace(/^_+|_+$/g, '')`.
partes_palabras([], []).
partes_palabras([C|Cs], Partes) :-
    (   caracter_slug(C)
    ->  toma_palabra([C|Cs], Palabra, Resto),
        partes_palabras(Resto, Restos),
        Partes = [Palabra|Restos]
    ;   toma_separador([C|Cs], Resto),
        partes_palabras(Resto, Partes)
    ).

toma_palabra([], [], []).
toma_palabra([C|Cs], Palabra, Resto) :-
    caracter_slug(C),
    !,
    toma_palabra(Cs, Cola, Resto),
    Palabra = [C|Cola].
toma_palabra(Codes, [], Codes).

% Consume una CORRIDA de separadores y se detiene en el primer caracter admitido,
% dejando ese caracter en `Resto`. El corte tras el primer separador es lo que
% evita que se coma el resto de la cadena: sin el, `toma_separador` seguia
% hasta el final y solo sobrevivia la primera palabra del id.
toma_separador([], []).
toma_separador([C|Cs], Resto) :-
    \+ caracter_slug(C),
    !,
    toma_separador_resto(Cs, Resto).

toma_separador_resto([], []).
toma_separador_resto([C|Cs], Resto) :-
    \+ caracter_slug(C),
    !,
    toma_separador_resto(Cs, Resto).
toma_separador_resto(Cs, Cs).

% Une las partes con `_`. Las partes son listas de codigos, no atomos, asi que
% `atomic_list_concat/3` no sirve: hay que pasarlas a texto primero.
une_partes([], '').
une_partes([P|Ps], Slug) :-
    string_codes(S, P),
    une_partes(Ps, Cola),
    (   Cola == ''
    ->  Slug = S
    ;   string_concat(S, '_', T),
        string_concat(T, Cola, Slug)
    ).

% Caracteres que pasan al identificador: letras ASCII minusculas y digitos. Los
% acentuados no se admiten porque el backend aplica NFD y los retira antes de
% aplicar su regex.
caracter_slug(C) :-
    (   (C >= 97, C =< 122) ; (C >= 48, C =< 57)
    ->  true
    ;   fail
    ).

% Los sintomas de una falla llegan como texto libre ("Aire acondicionado no
% enfria") y el motor los indexa por id, asi que se normalizan con la misma regla
% que el nombre de la falla. Sin esto el sintoma quedaria escrito con su tilde o su
% mayuscula y el catalogo no lo reconoceria.
% Devuelve un ATOM, no un string. `procesar_api/1` afirma los sintomas del
% diagnostico con `atom_string/2` y `preguntar/2` los compara por unificacion
% contra `conocido/3`; si esta devolviera un string, `sintoma("x")` buscaria
% `conocido(s, sintoma, "x")` mientras el diagnostico habia afirmado
% `conocido(s, sintoma, x)`, y la falla nunca dispararia. Es la misma razon por
% la que `slug_prolog_id/2` cierra con `atom_string/2`.
normalizar_id_sintoma(S, SOut) :-
    (   atom(S)    -> atom_string(S, Ss)
    ;   string(S)  -> Ss = S
    ;               term_string(Ss, S)
    ),
    string_lower(Ss, L),
    string_codes(L, Codes),
    partes_palabras(Codes, Partes),
    une_partes(Partes, SOutStr),
    (   SOutStr == ''
    ->  SOut = sintoma
    ;   atom_string(SOut, SOutStr)
    ).

asegurar_sintomas_usuario([]).
asegurar_sintomas_usuario([S|T]) :-
    % El guardia pregunta si YA existe una clausula `sintoma/1` para S, no si
    % `sintoma(S)` tiene exito ahora. Con `\+ sintoma(S)` el resultado dependia
    % del estado de `conocido/3` de la peticion en curso, lo que rompia el
    % guardado del anti-duplicado. Preguntar por la clausula es estable.
    %
    % Esto tambien protege la base estatica: como solo se marca con
    % `sintoma_usuario/1` lo que se agrega aqui, y solo se agrega lo que no
    % existia, el `retractall(sintoma(S))` del borrado nunca alcanza a tocar un
    % sintoma declarado en el archivo.
    (   \+ clause(sintoma(S), _)
    ->  assertz((sintoma(S) :- preguntar(sintoma, S))),
        (   atom_string(S, Sstr) -> true; Sstr=S ),
        assertz(nombre_sintoma(S, Sstr)),
        assertz(categoria_sintoma(S, 'General')),
        assertz(sintoma_usuario(S))
    ;   true
    ),
    asegurar_sintomas_usuario(T).

assert_nombre_paso(PasoAtom, PasoTexto) :-
    (   string(PasoTexto) -> atom_string(PtAtom, PasoTexto); PtAtom=PasoTexto ),
    (   \+ nombre_reparacion(PasoAtom, _)
    ->  assertz(nombre_reparacion(PasoAtom, PtAtom))
    ;   true
    ).
falla_meta_a_dict(F, Dict) :-
    (nombre_falla(F, N) -> true ; atom_string(N, F)),
    (   meta_falla(F, urgencia(Urg), costo(Min, Max, Moneda)) -> true
    ;   Urg = desconocida, Min = 0, Max = 0, Moneda = desconocida ),
    (reparacion(F, Rep) -> true ; Rep = []),
    maplist(reparacion_a_nombre, Rep, RepNombres),
    (   fuente_falla(F, Fuente) -> true
    ;   Fuente = 'Base original del sistema (sin fuente registrada)' ),
    (   confianza_dato(F, CD) -> true ; CD = no_registrada ),
    (   observaciones_falla(F, Obs) -> true ; Obs = '' ),
    Dict = _{
        id: F,
        nombre: N,
        urgencia: Urg,
        costo_min: Min,
        costo_max: Max,
        moneda: Moneda,
        reparaciones: RepNombres,
        fuente: Fuente,
        confianza_dato: CD,
        observaciones: Obs
    }.

% NUEVO endpoint (aditivo): historial de diagnosticos en memoria.
procesar_historial(Request) :-
    option(method(options), Request),
    !,
    cors_reply([get]).
procesar_historial(_Request) :-
    cors_enable,
    findall(D, ( historial_diagnostico(H), historial_a_dict(H, D) ), Ds),
    length(Ds, Total),
    reply_json_dict(_{
        status: "success",
        total: Total,
        historial: Ds
    }).

% ==========================================
% GESTIÓN DE CONOCIMIENTO DINÁMICO (USUARIO)
% ==========================================

% Limpia TODO el conocimiento dinámico ingresado por usuario
limpiar_dinamicas_usuario :-
    findall(F, falla_usuario(F), Fs),
    maplist(retractar_falla_dinamica, Fs),
    findall(S, sintoma_usuario(S), Ss),
    maplist(retractar_sintoma_dinamico, Ss),
    retractall(falla_usuario(_)),
    retractall(sintoma_usuario(_)).

% Retrae todas las cláusulas asociadas a una falla dinámica. Antes de retirar su
% regla se anotan sus síntomas, porque una vez retirada ya no queda forma de
% saber cuáles eran; luego solo se retiran los síntomas de usuario que ninguna
% otra falla viva siga usando. Un síntoma compartido con otra falla se queda.
retractar_falla_dinamica(F) :-
    findall(S, ( clause(falla(F, _), Body), simbolos_de_cuerpo(Body, Ss), member(S, Ss) ), Singles),
    sort(Singles, SintomasDeLaFalla),
    retractall(falla(F,_)),
    retractall(nombre_falla(F,_)),
    retractall(meta_falla(F,_,_)),
    retractall(reparacion(F,_)),
    retractall(explicacion(F)),
    retractall(fuente_falla(F,_)),
    retractall(confianza_dato(F,_)),
    retractall(causa_falla(F,_)),
    retractall(aplica_a(F,_,_,_,_)),
    retractall(falla_usuario(F)),
    retractall(observaciones_falla(F,_)),
    maplist(retractar_sintoma_huerfano, SintomasDeLaFalla).

% Un síntoma de usuario que ninguna falla viva (estática o dinámica) referencia
% queda huérfano y se retira. El marcador `sintoma_usuario/1` evita tocar la base
% estática, y mirar el cuerpo de las reglas (no `sintoma/1`) evita retirar un
% síntoma que otra falla todavía usa para inferir.
retractar_sintoma_huerfano(S) :-
    (   sintoma_usuario(S),
        \+ ( clause(falla(_, _), Body), simbolos_de_cuerpo(Body, Ss), memberchk(S, Ss) )
    ->  retractar_sintoma_dinamico(S)
    ;   true
    ).

% Retrae síntomas dinámicos (solo marcados como usuario)
retractar_sintoma_dinamico(S) :-
    retractall(sintoma(S)),
    retractall(nombre_sintoma(S,_)),
    retractall(categoria_sintoma(S,_)),
    retractall(sintoma_usuario(S)).
