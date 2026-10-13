# Car-Care-System
Sistema Experto para detectar fallas automotrices

#Prototipo de Proyecto Modular para presentar en Ingenieria en informatica

-Sistema experto con motor de inferencia hecho en prolog  con 20 fallas descritas con sus respectivos sintomas

-Dependiendo del modelo, año y tipo de transmisión del auto son las fallas que se pueden recuperar o diagnosticar

-El sistema experto en prolog se conecta mediante un front end web (HTML,CSS Y JS) para asi consultarlo en una interfaz amigable al usuario

-Tiene cuentas de usuario: el administrador gestiona con quien entra (CRUD de
usuarios y de fallas del catalogo), y el estudiante se limita a diagnosticar y
consultar. Cada quien edita su propio perfil (nombre, contraseña y, el admin,
usuario y rol).

## Como levantarlo

### Requisitos

| Componente | Version | Nota |
|---|---|---|
| Node.js | 20 o superior | El E2E usa el runner de tests nativo |
| SWI-Prolog | 8 o superior | Si no esta en el PATH, define `SWIPL` con la ruta a `swipl.exe` |
| MongoDB | 6 o superior | Se espera en `mongodb://localhost:27017/car_care_system` |

Instala dependencias una sola vez (comprueba `node`/`npm`, instala backend y
frontend, y avisa si falta SWI-Prolog o MongoDB):

```bash
npm run setup
```

(o, a mano: `cd backend && npm install` y `cd ../frontend && npm install`).

### Primeros pasos (cuentas y sesion)

Sin bases de datos solo se ve la pagina de inicio de sesion. El sistema con
sesiones necesita un administrador inicial, que se crea la primera vez que
arranca la API contra una base vacia a partir del entorno:

1. Copia el ejemplo de entorno:
   ```powershell
   Copy-Item backend\.env.example backend\.env
   ```
2. Edita `backend\.env` y define `SESSION_SECRET` (en produccion es obligatoria:
   la API no arranca sin ella) y las credenciales del primer administrador:
   - `ADMIN_USERNAME` (p. ej. `admin`)
   - `ADMIN_PASSWORD` (p. ej. `admin123`, cambiala)
   - `ADMIN_NOMBRE` (opcional, por defecto `Administrador`)

Si la base ya tiene usuarios, esas variables no tocan nada: el administrador
semilla solo se crea cuando la coleccion de usuarios esta vacia.

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

Abre <http://localhost:5173> y entra con la cuenta administrador definida en
`backend\.env`. El navegador solo habla con ese puerto: Vite hace de proxy hacia
Express, y Express es el unico que habla con el motor.

Para detener:

```powershell
.\scripts\start-dev.ps1    -Detener
.\scripts\start-prolog.ps1 -Detener
```

### Sonda de salud

`GET /health` responde sin sesion con `200 {"status":"ok","db":"conectado"}` o
`503 {"status":"degradado","db":"desconectado"}` segun MongoDB, y es la que usa
el balanceador como health check. El motor expone la suya, tambien publica, en
`http://localhost:8000/health`.

Es de las pocas rutas abiertas: junto con `GET /api/config/tipo-cambio` y
`POST /api/auth/logout`, es lo que el navegador necesita antes de entrar. El
resto de los datos (`/api/diagnosticos`, `/api/stats/certeza` y el gateway de
Prolog) exige sesion.

### Comprobar que funciona

```powershell
# Levanta todo con los scripts, prueba el camino completo y lo apaga
.\scripts\smoke-test.ps1
```

### Pruebas automatizadas

Las pruebas automatizadas de la logica de presentacion
(`frontend/src/lib/*.test.js`: busqueda con y sin tildes, cortes de certeza,
conversion de moneda, validacion del formulario de fallas) no necesitan ni
navegador ni base de datos:

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

Desde la raiz, todo de una vez:

```bash
npm test
```

### Variables de entorno

| Variable | Por defecto | Para que sirve |
|---|---|---|
| `PORT` | `5000` | Puerto de la API; el motor tambien la lee (con `8000` por defecto). Vite lo lee para apuntar su proxy, asi que basta con definirla en un solo lado |
| `MONGO_URI` | `mongodb://localhost:27017/car_care_system` | Conexion a MongoDB |
| `PROLOG_BASE` | `http://localhost:8000` | Direccion del motor para el gateway |
| `PROLOG_TIMEOUT_MS` | `3000` | Tiempo maximo de espera del gateway |
| `CORS_ORIGIN` | `http://localhost:5173` | Origenes permitidos, separados por comas, o `*` |
| `SESSION_SECRET` | valor de desarrollo | Frase que firma las cookies de sesion. **En produccion es obligatoria**: sin ella la API no arranca |
| `TRUST_PROXY_HOPS` | `2` | Proxies delante de la API (CloudFront y el ALB). Sin declararlos, `req.ip` seria la IP interna del ALB |
| `ORIGIN_VERIFY` | — | Cabecera secreta que inyecta CloudFront. Sin definirla no se exige (local); definida, quien no la traiga recibe 403 |
| `MOTOR_TOKEN` | valor de desarrollo | Token hexadecimal compartido con el motor. Si el motor no lo define, arranca abierto y lo avisa por stderr |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Ventana del limite de peticiones (15 min) |
| `RATE_LIMIT_MAX` | `300` | Peticiones por ventana e IP para toda la API |
| `LOGIN_RATE_LIMIT_MAX` | `20` | Intentos de login fallidos por ventana y por `(IP, usuario)` |
| `DEBUG_IP` | `0` | Con `1`, registra la IP y `X-Forwarded-For` de cada intento de login, para calibrar `TRUST_PROXY_HOPS` |
| `ADMIN_USERNAME` | — | Usuario del primer administrador (solo si la base esta vacia) |
| `ADMIN_PASSWORD` | — | Contraseña del primer administrador (solo si la base esta vacia) |
| `ADMIN_NOMBRE` | `Administrador` | Nombre visible del primer administrador |
| `SWIPL` | instalacion estandar | Ruta a `swipl.exe` |

`MOTOR_TOKEN` y `PORT` las leen los dos contenedores: deben valer lo mismo en la
task definition de la API y en la del motor.

### Instalacion con Docker (opcional)

En vez de instalar MongoDB, SWI-Prolog y Node localmente se puede correr cada
pieza en un contenedor. Hay Dockerfile para el motor (`Prolog/Dockerfile`, expone
el 8000) y para la API (`backend/Dockerfile`, expone el 5000):

```powershell
docker run -d --name car-care-mongo  -p 27017:27017 mongo:7
docker build -t car-care-prolog -f Prolog/Dockerfile Prolog
docker run -d --name car-care-prolog -p 8000:8000 car-care-prolog
docker build -t car-care-api -f backend/Dockerfile backend
docker run -d --name car-care-api -p 5000:5000 --env-file backend\.env car-care-api
```

El frontend se sigue corriendo con Vite en local (`npm run setup` + scripts de
arranque); no hay imagen para el frontend.
