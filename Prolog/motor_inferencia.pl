:- encoding(utf8).

% SISTEMA EXPERTO - TALLER AUTOMOTRIZ

% --- MEMORIA DINÁMICA ---
:- dynamic conocido/3.
:- dynamic vehiculo_actual/3.
:- dynamic sintomas_confirmados/1.
:- dynamic modo_http/0.

% ==========================================
% COMPATIBILIDAD DE VEHÍCULOS SEGUN TIPO DE TRANSMISION (aplica_a)
% ==========================================
aplica_a(pastillas_freno,                    _, _, _).
aplica_a(sellos_valvula,                     _, _, _).
aplica_a(bateria_descargada_o_alternador,    _, _, _).
aplica_a(fuga_sistema_refrigeracion,         _, _, _).
aplica_a(sistema_frenos_con_aire,            _, _, _).
aplica_a(bobina_encendido_defectuosa,        _, _, _).
aplica_a(bomba_direccion_averiada,           _, _, _).
aplica_a(sensor_oxigeno_defectuoso,          _, _, _).
aplica_a(junta_culata_quemada,               _, _, _).
aplica_a(inyectores_sucios,                  _, _, _).
aplica_a(dilucion_aceite,                    _, _, _).
aplica_a(aspas_ventilador_radiador,          _, _, _).
aplica_a(falta_gas_refrigerante,             _, _, _).
aplica_a(correa_accesorios_desgastada,       _, _, _).
aplica_a(llantas_desbalanceadas,             _, _, _).
aplica_a(fuga_carter_aceite,                 _, _, _).
aplica_a(frenos_sobrecalentados,             _, _, _).
aplica_a(falta_lubricacion_motor,            _, _, _).
aplica_a(junta_homocinetica_daniada,         _, _, _).

% Transmisión manual por defecto
aplica_a(embrague_desgastado, nissan,      sentra,    Anio) :- Anio >= 1990, Anio =< 2012.
aplica_a(embrague_desgastado, volkswagen,  jetta,     Anio) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, volkswagen,  golf,      Anio) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, honda,       civic,     Anio) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, honda,       accord,    Anio) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, toyota,      corolla,   Anio) :- Anio >= 1990, Anio =< 2020.
aplica_a(embrague_desgastado, toyota,      camry,     Anio) :- Anio >= 1990, Anio =< 2017.
aplica_a(embrague_desgastado, ford,        focus,     Anio) :- Anio >= 2000, Anio =< 2018.
aplica_a(embrague_desgastado, ford,        fiesta,    Anio) :- Anio >= 2000, Anio =< 2019.
aplica_a(embrague_desgastado, chevrolet,   aveo,      Anio) :- Anio >= 2004, Anio =< 2022.
aplica_a(embrague_desgastado, chevrolet,   trax,      Anio) :- Anio >= 2013, Anio =< 2022.
aplica_a(embrague_desgastado, mazda,       3,         Anio) :- Anio >= 2003, Anio =< 2025.
aplica_a(embrague_desgastado, mazda,       mx5,       Anio) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, hyundai,     accent,    Anio) :- Anio >= 1995, Anio =< 2025.
aplica_a(embrague_desgastado, kia,         rio,       Anio) :- Anio >= 2000, Anio =< 2025.
aplica_a(embrague_desgastado, mitsubishi,  lancer,    Anio) :- Anio >= 1990, Anio =< 2017.
aplica_a(embrague_desgastado, subaru,      impreza,   Anio) :- Anio >= 1992, Anio =< 2025.
aplica_a(embrague_desgastado, subaru,      wrx,       Anio) :- Anio >= 2002, Anio =< 2025.
aplica_a(embrague_desgastado, seat,        ibiza,     Anio) :- Anio >= 1993, Anio =< 2025.
aplica_a(embrague_desgastado, renault,     clio,      Anio) :- Anio >= 1990, Anio =< 2025.
aplica_a(embrague_desgastado, peugeot,     206,       Anio) :- Anio >= 1998, Anio =< 2012.
aplica_a(embrague_desgastado, peugeot,     208,       Anio) :- Anio >= 2012, Anio =< 2025.
aplica_a(embrague_desgastado, gen,         gen,       _).   


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



% FALLAS

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


% REPARACIONES, EXPLICACIONES, URGENCIA Y COSTOS
meta_falla(falta_lubricacion_motor,         urgencia(critica),  costo(500,   1500)).
meta_falla(junta_culata_quemada,            urgencia(critica),  costo(4000,  12000)).
meta_falla(bateria_descargada_o_alternador, urgencia(alta),     costo(800,   3500)).
meta_falla(fuga_sistema_refrigeracion,      urgencia(alta),     costo(600,   4000)).
meta_falla(embrague_desgastado,             urgencia(alta),     costo(2500,  6000)).
meta_falla(bomba_direccion_averiada,        urgencia(alta),     costo(1500,  5000)).
meta_falla(sistema_frenos_con_aire,         urgencia(alta),     costo(300,   1200)).
meta_falla(frenos_sobrecalentados,          urgencia(alta),     costo(400,   2000)).
meta_falla(bobina_encendido_defectuosa,     urgencia(media),    costo(800,   2500)).
meta_falla(sensor_oxigeno_defectuoso,       urgencia(media),    costo(600,   2000)).
meta_falla(junta_homocinetica_daniada,      urgencia(media),    costo(1200,  3500)).
meta_falla(inyectores_sucios,               urgencia(media),    costo(500,   2000)).
meta_falla(fuga_carter_aceite,              urgencia(media),    costo(300,   1500)).
meta_falla(sellos_valvula,                  urgencia(media),    costo(1000,  3000)).
meta_falla(pastillas_freno,                 urgencia(baja),     costo(400,   1200)).
meta_falla(correa_accesorios_desgastada,    urgencia(baja),     costo(400,   1200)).
meta_falla(dilucion_aceite,                 urgencia(baja),     costo(300,    800)).
meta_falla(aspas_ventilador_radiador,       urgencia(baja),     costo(300,    900)).
meta_falla(falta_gas_refrigerante,          urgencia(baja),     costo(500,   1500)).
meta_falla(llantas_desbalanceadas,          urgencia(baja),     costo(200,    600)).

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
explicacion(_) :- writeln('  Razon: No hay explicacion detallada disponible.').


% FUNCIONES DE REPORTE Y LÓGICA MANUAL
etiqueta_certeza(C, 'ALTA')  :- C >= 0.85, !.
etiqueta_certeza(C, 'MEDIA') :- C >= 0.60, !.
etiqueta_certeza(_, 'BAJA').

etiqueta_urgencia(urgencia(critica), '[!!! CRITICA]') :- !.
etiqueta_urgencia(urgencia(alta),    '[!!  ALTA   ]') :- !.
etiqueta_urgencia(urgencia(media),   '[!   MEDIA  ]') :- !.
etiqueta_urgencia(urgencia(baja),    '[    BAJA   ]') :- !.
etiqueta_urgencia(_,                 '[    ---    ]').

imprime_pasos([]).
imprime_pasos([H|T]) :- format('      - ~w~n', [H]), imprime_pasos(T).

reportar_falla(Certeza-Falla) :-
    writeln('  --------------------------------------------------'),
    etiqueta_certeza(Certeza, EtiquetaC),
    format('  FALLA DETECTADA : ~w~n', [Falla]),
    format('  Confianza       : ~w (~2f)~n', [EtiquetaC, Certeza]),
    (meta_falla(Falla, Urgencia, costo(Min, Max)) ->
        etiqueta_urgencia(Urgencia, EU),
        format('  Urgencia        : ~w~n', [EU]),
        format('  Costo estimado  : $~w - $~w MXN~n', [Min, Max])
    ; true),
    writeln('  Por que se detecto:'),
    explicacion(Falla),
    (reparacion(Falla, Pasos) ->
        writeln('  Pasos sugeridos de reparacion:'),
        imprime_pasos(Pasos)
    ; writeln('  (Sin pasos de reparacion registrados)')).

agrupar_max_certeza([], []).
agrupar_max_certeza([C-F|Rest], Resultado) :-
    agrupar_max_certeza(Rest, RestAgrupado),
    actualizar_certeza(C-F, RestAgrupado, Resultado).
actualizar_certeza(C-F, [], [C-F]).
actualizar_certeza(C-F, [C0-F|T], [CMax-F|T]) :-
    !, (C > C0 -> CMax = C ; CMax = C0).
actualizar_certeza(C-F, [H|T], [H|TRes]) :-
    actualizar_certeza(C-F, T, TRes).

ordenar_fallas(Fallas, FallasOrdenadas) :-
    sort(Fallas, FallasAsc),
    invertir_lista(FallasAsc, [], FallasOrdenadas).

invertir_lista([], Acc, Acc).
invertir_lista([H|T], Acc, Res) :-
    invertir_lista(T, [H|Acc], Res).

imprimir_fallas([]).
imprimir_fallas([C-F|T]) :-
    reportar_falla(C-F),
    imprimir_fallas(T).

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
    retractall(vehiculo_actual(_, _, _)),
    retractall(sintomas_confirmados(_)),
    asserta(sintomas_confirmados([])).

% FLUJO PRINCIPAL POR CONSOLA
inicio :-
    limpiar_memoria,
    nl,
    writeln('=================================================='),
    writeln('    SISTEMA EXPERTO - TALLER AUTOMOTRIZ v2.1'),
    writeln('=================================================='),
    nl,
    writeln('Ingrese los datos del vehiculo.'),
    writeln('(Use "gen" para marca/modelo no listado, 0 para anio desconocido)'),
    nl,
    write('  Marca  (ej: nissan, toyota, volkswagen): '), read(Marca),
    write('  Modelo (ej: sentra, corolla, jetta)    : '), read(Modelo),
    write('  Anio   (ej: 2015)                      : '), read(Anio),

    asserta(vehiculo_actual(Marca, Modelo, Anio)),
    nl,
    writeln('=================================================='),
    format('  Vehiculo registrado: ~w ~w (~w)~n', [Marca, Modelo, Anio]),
    writeln('=================================================='),
    nl,
    writeln('Responda con s. (si) o n. (no) las siguientes preguntas.'),
    nl,

    vehiculo_actual(MarcaG, ModeloG, AnioG),
    findall(
        Certeza-Falla,
        (falla(Falla, Certeza), aplica_a(Falla, MarcaG, ModeloG, AnioG)),
        FallasRaw
    ),

    agrupar_max_certeza(FallasRaw, Fallas),

    nl,
    writeln('=================================================='),
    writeln('             RESULTADOS DEL DIAGNOSTICO'),
    writeln('=================================================='),

    (Fallas = [] ->
        writeln('  No se pudo determinar ninguna falla con los sintomas indicados.')
    ;
        ordenar_fallas(Fallas, FallasOrdenadas),
        imprimir_fallas(FallasOrdenadas)
    ),

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
% SERVIDOR WEB API (NUEVO: CONEXIÓN CON JS)
% ==========================================
:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).
:- use_module(library(http/http_cors)).

:- set_setting(http:cors, [*]). % Permite recibir peticiones de cualquier página web

% Definir los endpoints (método principal + preflight OPTIONS del navegador)
:- http_handler(root(api/diagnostico), procesar_api, [methods([options, post]), time_limit(infinite)]).
:- http_handler(root(api/sintomas), procesar_sintomas, [methods([options, get])]).
:- http_handler(root(api/fallas), procesar_fallas, [methods([options, get])]).

cors_reply(Metodos) :-
    maplist(upcase_atom, Metodos, MetodosUp),
    atomic_list_concat(MetodosUp, ', ', MetodosStr),
    format('Access-Control-Allow-Origin: *~n'),
    format('Access-Control-Allow-Methods: ~s~n', [MetodosStr]),
    format('Access-Control-Allow-Headers: Content-Type~n'),
    format('~n').

% Comando para arrancar el servidor
server :- server(8000).
server(Puerto) :-
    http_server(http_dispatch, [port(Puerto)]),
    format('~n[+] Servidor Prolog corriendo exitosamente en http://localhost:~w/~n', [Puerto]),
    format('[+] Pagina Web lista para abrir.~n~n').

procesar_api(Request) :-
    option(method(options), Request),
    !,
    cors_reply([post]).
procesar_api(Request) :-
    cors_enable,
    http_read_json_dict(Request, DictIn),
    
    % Extraer datos del JSON enviado por JS
    MarcaStr  = DictIn.get(marca),
    ModeloStr = DictIn.get(modelo),
    Anio      = DictIn.get(anio),
    SintomasStr = DictIn.get(sintomas),

    % Normalizar los strings del JSON a átomos para que coincidan con la base
    % de conocimiento (en el thread HTTP string y átomo NO unifican).
    atom_string(Marca, MarcaStr),
    atom_string(Modelo, ModeloStr),
    maplist(atom_string, Sintomas, SintomasStr),

    limpiar_memoria,
    asserta(vehiculo_actual(Marca, Modelo, Anio)),
    asserta(sintomas_confirmados(Sintomas)),

    % Inyectar conocimiento: TODOS los síntomas se marcan como NO confirmados
    % y los recibidos como confirmados. Así las reglas nunca preguntan a consola.
    inyectar_conocimiento(Sintomas),
    asserta(modo_http),
    setup_call_cleanup(
        true,
        (
            findall(
                Certeza-Falla,
                (falla(Falla, Certeza), aplica_a(Falla, Marca, Modelo, Anio)),
                FallasRaw
            ),
            agrupar_max_certeza(FallasRaw, Fallas),
            ordenar_fallas(Fallas, FallasOrdenadas),
            maplist(falla_a_dict, FallasOrdenadas, FallasDict),
            Respuesta = _{
                status: "success",
                vehiculo: _{marca: Marca, modelo: Modelo, anio: Anio},
                fallas: FallasDict
            },
            reply_json_dict(Respuesta)
        ),
        retractall(modo_http)
    ).

inyectar_conocimiento(Sintomas) :-
    findall(S, clause(sintoma(S), _), TodosLosSintomas),
    maplist(negacion_sintoma, TodosLosSintomas),
    maplist(inyectar_sintoma, Sintomas).

negacion_sintoma(S) :- asserta(conocido(n, sintoma, S)).
inyectar_sintoma(S) :- asserta(conocido(s, sintoma, S)).

falla_a_dict(Certeza-Falla, Dict) :-
    (meta_falla(Falla, urgencia(Urg), costo(Min, Max)) -> true ; Urg=desconocida, Min=0, Max=0),
    (reparacion(Falla, Rep) -> true ; Rep=[]),
    maplist(reparacion_a_nombre, Rep, RepNombres),
    Dict = _{
        id: Falla,
        certeza: Certeza,
        urgencia: Urg,
        costo_min: Min,
        costo_max: Max,
        reparaciones: RepNombres
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

falla_meta_a_dict(F, Dict) :-
    (nombre_falla(F, N) -> true ; atom_string(N, F)),
    (meta_falla(F, urgencia(Urg), costo(Min, Max)) -> true ; Urg=desconocida, Min=0, Max=0),
    (reparacion(F, Rep) -> true ; Rep=[]),
    maplist(reparacion_a_nombre, Rep, RepNombres),
    Dict = _{
        id: F,
        nombre: N,
        urgencia: Urg,
        costo_min: Min,
        costo_max: Max,
        reparaciones: RepNombres
    }.