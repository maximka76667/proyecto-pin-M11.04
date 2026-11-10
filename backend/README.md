<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Calendario compartido y Google Calendar

La autenticación almacena las contraseñas usando bcrypt y devuelve sesiones JWT
con una duración de 30 días. Define también una clave secreta aleatoria y estable
en `backend/.env`:

```env
JWT_SECRET=<secreto-largo-aleatorio>
```

El cliente debe enviar el JWT en cada petición autenticada mediante
`Authorization: Bearer <token>`. Cerrar sesión revoca la sesión almacenada.

### Cambio y recuperación de contraseña (UT1015)

- `POST /auth/change-password`: pide la contraseña actual, cierra la sesión en los demás
  dispositivos y devuelve un token nuevo para el que hace el cambio.
- `POST /auth/forgot-password` y `POST /auth/reset-password`: recuperación con un código de
  8 dígitos enviado por email (caduca a los 15 minutos, 5 intentos, un solo uso).
- Al cambiar o restablecer la contraseña se envía un aviso a la dirección de la cuenta.
- Los intentos se cuentan por cuenta (usuario con sesión, o email), no por IP, para que el
  abuso de una cuenta no deje a las demás sin poder recuperarse. Hay además un límite por IP
  más holgado contra quien pruebe muchas cuentas desde una misma máquina.

Variables opcionales en `backend/.env`:

```env
# Envío del código con Gmail por SMTP (llega a cualquier dirección, sin dominio propio).
# Sin estas dos, el código solo se escribe en la consola si NODE_ENV es development o test;
# en cualquier otro caso no se escribe nunca, porque sería una credencial en los registros
GMAIL_USER=room8.app@gmail.com
# Contraseña de aplicación, no la normal: https://myaccount.google.com/apppasswords
# (hay que activar antes la verificación en dos pasos de esa cuenta)
GMAIL_APP_PASSWORD=<16-letras-de-la-contraseña-de-aplicación>
# Opcional; por defecto "Room8 <GMAIL_USER>"
MAIL_FROM=Room8 <room8.app@gmail.com>
# Clave para el HMAC de los códigos; si falta se deriva de JWT_SECRET.
# Genérala con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Al ponerla o cambiarla, los códigos pendientes en ese momento dejan de valer
PASSWORD_RESET_SECRET=<secreto-largo-aleatorio>
```

### Al desplegar

```env
# Cuántos proxies hay delante de la aplicación (Render, Railway, Nginx…): normalmente 1.
# Sin esta variable no se confía en X-Forwarded-For, así que el servidor ve la IP del proxy
# para todos los usuarios y el límite por IP se comparte entre ellos. Nunca uses `true`:
# aceptaría la cabecera de cualquiera y permitiría saltarse los límites falseándola
TRUST_PROXY_HOPS=1
# Necesaria para que el código de recuperación no se escriba nunca en los registros
NODE_ENV=production
```

La migración `20261108120000_password_reset_code` crea la tabla de códigos. Aplícala con
`npx prisma migrate deploy`; no uses `prisma migrate dev` contra la base de datos compartida.

La migración `20261028120000_shared_calendar` añade la hora de inicio de las asignaciones (duración fija de 30 minutos), guarda solo los intervalos ocupados importados y almacena cifrado el refresh token de Google. Aplica las migraciones con `npx prisma migrate deploy`.

Para activar Google Calendar, habilita Google Calendar API en Google Cloud, configura la pantalla de consentimiento y crea credenciales OAuth para una aplicación web. Define en `backend/.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://<backend-publico>/availability/google/callback
GOOGLE_APP_CALLBACK_URI=frontend://calendar/google-callback
# GOOGLE_WEB_CALLBACK_URI=https://<frontend-domain>/availability
GOOGLE_TOKEN_ENCRYPTION_KEY=<secreto-largo-aleatorio>
CALENDAR_TIME_ZONE=Europe/Madrid
```

Registra `GOOGLE_REDIRECT_URI` como URI de redirección autorizada en Google Cloud. En desarrollo web local, el backend detecta el origen de Expo y vuelve a `/availability`; para despliegues web, configura `GOOGLE_WEB_CALLBACK_URI` con la URL de esa pantalla. `GOOGLE_APP_CALLBACK_URI` se reserva para la app nativa. Usa una clave aleatoria estable para `GOOGLE_TOKEN_ENCRYPTION_KEY`; cambiarla invalida las conexiones guardadas.

El login con Google usa el mismo cliente OAuth con estos valores adicionales:

```env
GOOGLE_AUTH_REDIRECT_URI=http://localhost:3000/auth/google/callback
FRONTEND_URL=http://localhost:8081
```

Registra `GOOGLE_AUTH_REDIRECT_URI` como URI autorizada en Google Cloud. Las cuentas creadas con email y contraseña requieren al menos 8 caracteres; tras registrarse, la aplicación conduce al usuario a crear un hogar o unirse mediante código.

El consentimiento solicita acceso de solo lectura para poder listar todos los calendarios de Google y traer sus eventos. La app muestra los títulos solo a su dueño; los demás miembros de «La casa» únicamente ven «Ocupado». Las descripciones no se guardan. Al desconectar, se eliminan también los eventos importados.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
