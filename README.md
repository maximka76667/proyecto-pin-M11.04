# proyecto-pin-M11.04

Monorepo con dos partes:

- `backend/` — API REST con NestJS + Prisma (PostgreSQL).
- `frontend/` — App con Expo (React Native + Expo Router), ejecutable en web, Android e iOS.

## Requisitos

- Node.js 20 o superior y npm
- Una base de datos PostgreSQL (local o en la nube, p. ej. Supabase)
- Opcional: la app Expo Go en el móvil, o un emulador Android / simulador iOS

## 1. Backend

```bash
cd backend
npm install
```

Crea un archivo `backend/.env` (no se sube al repositorio) con la conexión a la base de datos:

```env
DATABASE_URL="postgresql://USUARIO:PASSWORD@HOST:5432/BASEDEDATOS"
DIRECT_URL="postgresql://USUARIO:PASSWORD@HOST:5432/BASEDEDATOS"
# PORT=3000   # opcional, por defecto 3000

# Escáner de tickets (POST /scanner/ticket). Clave gratuita en https://aistudio.google.com/apikey
# Sin clave el backend arranca igual; solo falla el escaneo.
GEMINI_API_KEY="tu_clave"
# GEMINI_MODEL="gemini-3-flash-preview"   # opcional
# Respaldo gratuito si Gemini falla (429, caída, clave inválida). Clave en https://openrouter.ai/keys
# Sin clave no hay respaldo. Con límite gratuito de ~50 peticiones al día.
# OPENROUTER_API_KEY="tu_clave"
# OPENROUTER_MODELS="nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free"   # opcional, se prueban en orden
# Tiempos máximos en milisegundos (opcionales): pasado ese tiempo se da el lector por caído
# GEMINI_TIMEOUT_MS=20000       # por defecto 20 s
# OPENROUTER_TIMEOUT_MS=30000   # por defecto 30 s en total (25 s como máximo por modelo)
```

> Si usas una base de datos sin pooler (p. ej. PostgreSQL local), `DIRECT_URL` puede ser igual que `DATABASE_URL`.

Aplica las migraciones y genera el cliente de Prisma:

```bash
npx prisma migrate deploy   # aplica las migraciones existentes
npx prisma generate
```

Arranca el servidor en modo desarrollo (con recarga automática):

```bash
npm run start:dev
```

La API queda disponible en `http://localhost:3000`.

Otros comandos útiles:

| Comando                 | Descripción                                   |
| ----------------------- | --------------------------------------------- |
| `npm run build`         | Compila a `dist/`                             |
| `npm run start:prod`    | Ejecuta la versión compilada                  |
| `npm test`              | Tests unitarios                               |
| `npm run test:e2e`      | Tests end-to-end                              |
| `npm run lint`          | Linter (oxlint)                               |
| `npx prisma studio`     | Interfaz web para ver/editar la base de datos |
| `npx prisma migrate dev`| Crea una nueva migración tras cambiar el schema |

### Escáner de tickets

`POST /scanner/ticket` (multipart, campo `image`) lee la foto de un ticket y devuelve `comercio`, `items` y `provider` (qué lector la ha leído). No guarda nada: el usuario revisa los productos antes de crear el gasto.

Hay dos lectores:

- **Gemini** (principal). Hace falta `GEMINI_API_KEY`.
- **OpenRouter** (respaldo gratuito y opcional). Hace falta `OPENROUTER_API_KEY`. Usa modelos `:free` con entrada de imagen, que se prueban en orden.

Con el parámetro `provider` se elige cómo se usan:

| Petición | Qué hace |
| --- | --- |
| `POST /scanner/ticket` | Prueba Gemini y, si falla (límite 429, error del servidor, tiempo agotado o clave inválida), prueba OpenRouter |
| `POST /scanner/ticket?provider=gemini` | Solo Gemini, sin respaldo automático |
| `POST /scanner/ticket?provider=openrouter` | Solo OpenRouter |

La app usa los dos últimos, uno detrás de otro, para poder mostrar en qué intento va ("Leyendo con Gemini…", "Gemini no responde, probando con un lector de respaldo…"). Un `provider` desconocido devuelve 400, y pedir un lector sin su clave configurada devuelve 503.

- Un ticket ilegible (400) no se reintenta con otro lector.
- Si fallan los dos, la app avisa y deja añadir los productos a mano. Cuando el ticket lo lee el respaldo, la pantalla de revisión lo indica, porque suele leer peor los nombres.
- **Límites del respaldo gratuito:** OpenRouter permite unas 20 peticiones por minuto y 50 al día en los modelos `:free` (1.000 al día si se compran 10 créditos). Los intentos fallidos también cuentan. Los modelos gratuitos cambian, pueden ir lentos o estar limitados por su proveedor, así que el respaldo es de mejor esfuerzo.
- **Tiempos:** Gemini tiene 20 s y OpenRouter 30 s en total (25 s como máximo por modelo; no se intenta otro modelo si quedan menos de 8 s). Se cambian con `GEMINI_TIMEOUT_MS` y `OPENROUTER_TIMEOUT_MS`.
- El `.env` solo se lee al arrancar el backend, y `npm run start:dev` no vigila ese archivo: **reinicia el backend** después de cambiarlo.

## 2. Frontend

En otra terminal:

```bash
cd frontend
npm install
npm start          # o: npm run web / npm run android / npm run ios
```

Desde el menú de Expo pulsa `w` para abrir en el navegador, `a` para Android o `i` para iOS, o escanea el QR con Expo Go.

### URL de la API

La URL del backend está en `frontend/src/lib/api.ts`:

```ts
export const API_URL = 'http://localhost:3000';
```

`localhost` funciona en la versión web y en el simulador de iOS. Para otros casos cámbiala:

- Emulador Android: `http://10.0.2.2:3000`
- Móvil físico con Expo Go: `http://<IP-local-de-tu-PC>:3000` (ambos en la misma red Wi-Fi)

## Orden de arranque

1. Base de datos PostgreSQL accesible y `.env` configurado
2. `backend`: `npm run start:dev`
3. `frontend`: `npm start`
