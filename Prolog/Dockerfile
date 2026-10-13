FROM swipl:9.2.9

WORKDIR /app
COPY Prolog/motor_inferencia.pl ./motor_inferencia.pl

EXPOSE 8000

# Sin puerto fijo: server/0 lee PORT del entorno (8000 por defecto), de modo que
# la task definition puede cambiarlo sin reconstruir la imagen.
CMD ["swipl", "-q", "-f", "/app/motor_inferencia.pl", "-g", "server, thread_get_message(_)", "-t", "halt"]