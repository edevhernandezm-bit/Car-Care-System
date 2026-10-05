# Car-Care-System
Sistema Experto para detectar fallas automotrices

#Prototipo de Proyecto Modular para presentar en Ingenieria en informatica

-Sistema experto con motor de inferencia hecho en prolog  con 20 fallas descritas con sus respectivos sintomas

-Dependiendo del modelo, año y tipo de transmisión del auto son las fallas que se pueden recuperar o diagnosticar

-El sistema experto en prolog se conecta mediante un front end web (HTML,CSS Y JS) para asi consultarlo en una interfaz amigable al usuario

## Como levantarlo

### Requisitos

| Componente | Version | Nota |
|---|---|---|
| Node.js | 20 o superior | El E2E usa el runner de tests nativo |
| SWI-Prolog | 8 o superior | Si no esta en el PATH, define `SWIPL` con la ruta a `swipl.exe` |
| MongoDB | 6 o superior | Se espera en `mongodb://localhost:27017/car_care_system` |

Instala dependencias una sola vez:

```bash
cd backend  && npm install
cd ../frontend && npm install
```

### Arranque

El motor Prolog se levanta aparte del resto porque es un proceso propio, no un
servidor de Node. Los dos scripts dejan cada pieza esperando a que su puerto
este abierto antes de devolver el control.

```powershell
# Terminal 1: el motor de inferencia (puerto 8000)
.\scripts\start-prolog.ps1

# Terminal 2: la API Express (5000) y el frontend de Vite (5173)
.\scripts\start-dev.ps1
```

Abre <http://localhost:5173>. El navegador solo habla con ese puerto: Vite hace
de proxy hacia Express, y Express es el unico que habla con el motor.

Para detener:

```powershell
.\scripts\start-dev.ps1    -Detener
.\scripts\start-prolog.ps1 -Detener
```

### Comprobar que funciona

```powershell
# Levanta todo con los scripts, prueba el camino completo y lo apaga
.\scripts\smoke-test.ps1
```

### Pruebas automatizadas

Las pruebas de la lógica de presentación (`frontend/src/lib/diagnostico.js`:
búsqueda con y sin tildes, cortes de certeza, conversión de moneda) no necesitan
ni navegador ni base de datos:

```bash
cd frontend && npm test
```

El e2e levanta su propio stack y sí necesita MongoDB y SWI-Prolog:

```bash
cd backend && npm test
```

La suite levanta su propio stack (motor, API, Vite y Mongo) contra una base
`car_care_e2e` que se borra al terminar, asi que no toca los datos de
desarrollo.

### Variables de entorno

| Variable | Por defecto | Para que sirve |
|---|---|---|
| `PORT` | `5000` | Puerto de la API. Vite lo lee para apuntar su proxy, asi que basta con definirla en un solo lado |
| `MONGO_URI` | `mongodb://localhost:27017/car_care_system` | Conexion a MongoDB |
| `PROLOG_BASE` | `http://localhost:8000` | Direccion del motor para el gateway |
| `PROLOG_TIMEOUT_MS` | `8000` | Tiempo maximo de espera del gateway |
| `CORS_ORIGIN` | `http://localhost:5173` | Origenes permitidos, separados por comas, o `*` |
| `SWIPL` | instalacion estandar | Ruta a `swipl.exe` |
