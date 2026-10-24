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
