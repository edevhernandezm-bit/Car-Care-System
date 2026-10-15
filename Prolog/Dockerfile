FROM swipl:9.2.9

WORKDIR /app
COPY Prolog/motor_inferencia.pl ./motor_inferencia.pl

EXPOSE 8000

# El motor en produccion no arranca sin MOTOR_TOKEN (server/1 aborta si falta).
# Aqui se fija el entorno de produccion para que la guarda aplique en el
# contenedor, sin depender de que la task definition lo recuerde.
ENV NODE_ENV=production

# Sin puerto fijo: server/0 lee PORT del entorno (8000 por defecto), de modo que
# la task definition puede cambiarlo sin reconstruir la imagen.
CMD ["swipl", "-q", "-f", "/app/motor_inferencia.pl", "-g", "server, thread_get_message(_)", "-t", "halt"]