# Aguiteks LifeOS

Plataforma SaaS para organizar la vida personal y laboral: tareas, recordatorios, finanzas, contactos y espacios de empresa, desde una **PWA** instalable y un **bot de Telegram** que comparten los mismos servicios de backend y los mismos datos.

> Estado de cada fase, pruebas y pendientes: **[docs/PROGRESS.md](docs/PROGRESS.md)**.

## Tecnologías

| Capa | Tecnología |
|---|---|
| PWA | React 19, TypeScript estricto, Vite 8, Tailwind 4, React Router 7, Firebase Web SDK 13 |
| Backend | Cloud Functions 2.ª gen. (Node 22, TypeScript, esbuild), Firestore, Firebase Auth, Cloud Scheduler |
| Contratos | `packages/contracts`: Zod 4 (entradas de la API), dinero, permisos, planes |
| Bot | Telegram Bot API por webhook HTTPS |
| IA | Reglas en español (sin costo) + proveedor Claude opcional (`@anthropic-ai/sdk`) |
| Pruebas | Vitest, Firebase Emulator Suite, `@firebase/rules-unit-testing`, Playwright |

## Estructura

```
apps/web/            PWA (pages/, components/, hooks/, services/)
functions/src/       Cloud Functions: api/ (callable única), auth/, spaces/, tasks/, reminders/,
                     contacts/, finance/, telegram/, ai/, subscriptions/, shared/
packages/contracts/  Esquemas y reglas compartidas por PWA y backend
tests/               Integración contra emuladores (seguridad, finanzas, recordatorios, Telegram, reglas) y E2E
docs/                Arquitectura, datos, seguridad, Telegram, IA, despliegue, runbooks, avance
firestore.rules · firestore.indexes.json · storage.rules · firebase.json
```

## Requisitos

- Node.js 22 y npm 10
- Java 21 (para los emuladores de Firebase)
- Un proyecto de Firebase en plan **Blaze** para producción (Cloud Functions, Scheduler y Secret Manager lo requieren). El desarrollo local no necesita proyecto real.

## Ejecución local (sin credenciales)

```bash
npm install
npm run build -w functions                 # empaqueta las funciones para el emulador
npm run emulators                          # Auth, Firestore, Functions (proyecto demo-lifeos)
# en otra terminal:
cp apps/web/.env.example apps/web/.env.local
#   VITE_FIREBASE_API_KEY=demo  VITE_FIREBASE_PROJECT_ID=demo-lifeos  VITE_FIREBASE_APP_ID=1:1:web:1
#   VITE_USE_EMULATORS=true
npm run dev:web                            # http://localhost:5173
```

Los recordatorios programados no se disparan en el emulador (requiere Pub/Sub); se prueban con `tests/reminders.test.ts`.

## Pruebas

```bash
npm run typecheck      # TypeScript estricto en los tres paquetes
npm test               # unitarias: dinero, permisos, fechas en español, intérprete, zonas horarias
npm run test:emu       # integración contra emuladores (52 pruebas)
npm run build          # funciones + PWA
# E2E de la PWA (emuladores y `npm run dev:web` corriendo):
node tests/e2e/pwa.cjs /tmp
```

## Variables de entorno

Ver [.env.example](.env.example) y [apps/web/.env.example](apps/web/.env.example). Los secretos viven en Secret Manager; ningún secreto va en el repositorio ni en el frontend.

## Despliegue

Paso a paso, lista de comprobación y reversión en [docs/deployment.md](docs/deployment.md). Bot de Telegram en [docs/telegram-setup.md](docs/telegram-setup.md).
