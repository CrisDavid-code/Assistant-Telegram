# Aguiteks LifeOS

Plataforma SaaS **de costo cero** para organizar la vida personal y laboral: tareas, recordatorios, calendario, finanzas, metas, contactos, CRM, proyectos, documentos y espacios de empresa, desde una **PWA** instalable y un **bot de Telegram** que comparten los mismos servicios de backend y los mismos datos.

> Estado de cada fase, pruebas y pendientes: **[docs/PROGRESS.md](docs/PROGRESS.md)**.

## Tecnologías

| Capa | Tecnología |
|---|---|
| PWA | React 19, TypeScript estricto, Vite 8, Tailwind 4, React Router 7, Firebase Web SDK 13 |
| Backend | Cloudflare Worker (plan gratuito, TypeScript) con Cron Trigger; Firestore y Firebase Auth en plan Spark vía REST |
| Contratos | `packages/contracts`: Zod 4 (entradas de la API), dinero, permisos, planes |
| Bot | Telegram Bot API por webhook HTTPS |
| IA | Reglas en español (sin costo) + proveedor Claude opcional (`@anthropic-ai/sdk`) |
| Pruebas | Vitest, Firebase Emulator Suite, `@firebase/rules-unit-testing`, Playwright |

## Estructura

```
apps/web/            PWA (pages/, components/, hooks/, services/)
worker/src/          Cloudflare Worker: api/ (POST /api), auth/, spaces/, tasks/, reminders/, contacts/,
                     finance/, telegram/ (POST /telegram), ai/, subscriptions/, shared/ (cliente REST de Firestore)
packages/contracts/  Esquemas y reglas compartidas por PWA y backend
tests/               Integración contra emuladores (seguridad, finanzas, recordatorios, Telegram, reglas) y E2E
docs/                Arquitectura, datos, seguridad, Telegram, IA, despliegue, runbooks, avance
firestore.rules · firestore.indexes.json · firebase.json · worker/wrangler.toml
```

## Requisitos

- Node.js 22 y npm 10
- Java 21 (para los emuladores de Firebase)
- Para producción: un proyecto de Firebase en plan **Spark** (gratis) y una cuenta de Cloudflare (Workers Free). Ninguno pide tarjeta. El desarrollo local no necesita cuentas.

## Ejecución local (sin credenciales)

```bash
npm install
npm run emulators                          # Auth + Firestore (proyecto demo-lifeos)
# en otra terminal: el Worker (runtime real de Cloudflare) contra los emuladores
printf 'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080\nFIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099\nFIREBASE_PROJECT_ID=demo-lifeos\nTELEGRAM_WEBHOOK_SECRET=dev-secret\n' > worker/.dev.vars
npm run dev:worker                         # http://127.0.0.1:8787
# en otra terminal: la PWA
cp apps/web/.env.example apps/web/.env.local
#   VITE_FIREBASE_API_KEY=demo  VITE_FIREBASE_PROJECT_ID=demo-lifeos  VITE_FIREBASE_APP_ID=1:1:web:1
#   VITE_USE_EMULATORS=true  VITE_API_URL=http://127.0.0.1:8787
npm run dev:web                            # http://localhost:5173
```

`npm run dev:worker` usa `worker/wrangler.dev.toml` (sin Workers AI, que solo funciona remoto: la voz responde «no configurada»).
Para disparar el barrido de recordatorios a mano: `curl 'http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*'`.

## Pruebas

```bash
npm run typecheck      # TypeScript estricto en los tres paquetes
npm test               # unitarias: dinero, permisos, fechas en español, intérprete, zonas horarias
npm run test:emu       # integración contra emuladores (67 pruebas)
npm run build          # PWA + paquete del Worker
# E2E de la PWA (emuladores, `npm run dev:worker` y `npm run dev:web` corriendo):
node tests/e2e/pwa.cjs /tmp
```

## Variables de entorno

Ver [.env.example](.env.example) y [apps/web/.env.example](apps/web/.env.example). Los secretos viven en los secretos cifrados del Worker (`wrangler secret put`); ningún secreto va en el repositorio ni en el frontend.

## Despliegue

Paso a paso, lista de comprobación y reversión en [docs/deployment.md](docs/deployment.md). Bot de Telegram en [docs/telegram-setup.md](docs/telegram-setup.md).
