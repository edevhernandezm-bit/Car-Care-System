FROM swipl:9.2.9

WORKDIR /app
COPY Prolog/motor_inferencia.pl ./motor_inferencia.pl

EXPOSE 8000

CMD ["swipl", "-q", "-f", "/app/motor_inferencia.pl", "-g", "server(8000), thread_get_message(_)", "-t", "halt"]