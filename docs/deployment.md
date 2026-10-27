# Despliegue

Nunca se despliega a producción sin autorización explícita. Usa proyectos separados: `lifeos-dev`, `lifeos-prod` (nombres a elegir; aquí no se inventan identificadores).

## 1. Proyecto de Firebase
1. Crear el proyecto en la consola de Firebase y activar el plan **Blaze** (Functions, Scheduler y Secret Manager lo requieren). Configurar una alerta de presupuesto en Google Cloud Billing.
2. Authentication → habilitar **Correo/contraseña**. Agregar el dominio de la PWA a dominios autorizados.
3. Firestore → crear base en modo producción (región recomendada `nam5` o `us-central1`).
4. Registrar una app web y copiar su configuración a `apps/web/.env.production` (es pública).

```bash
npm i -g firebase-tools   # o usa npx
firebase login
firebase use --add        # elige el proyecto y un alias (dev/prod)
```

## 2. Secretos y variables
Ver `.env.example`, `docs/telegram-setup.md` y `docs/ai-providers.md`:
```bash
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET
firebase functions:secrets:set ANTHROPIC_API_KEY      # "disabled" si aún no usarás IA
```

## 3. Lista de comprobación previa
- [ ] `npm run typecheck && npm test && npm run test:emu && npm run build` en verde
- [ ] `apps/web/.env.production` apunta al proyecto correcto
- [ ] Secretos creados en el proyecto destino
- [ ] Alerta de presupuesto configurada

## 4. Orden de despliegue
Reglas e índices **antes** que el código que los usa:
```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
# esperar a que los índices estén READY (consola → Firestore → Índices)
firebase deploy --only functions
npm run build -w apps/web && firebase deploy --only hosting
```
Después: registrar el webhook (`scripts/telegram-setup.mjs`) y activar las políticas TTL si la consola lo solicita.

## 5. Verificación posterior (humo)
Registrar una cuenta de prueba → crear tarea → registrar gasto → vincular Telegram → «/hoy» → recordatorio en 2 minutos → recibirlo. Revisar `firebase functions:log`.

## 6. Reversión
- Hosting: consola → Hosting → versión anterior → **Revertir** (o `firebase hosting:clone`).
- Functions: `git checkout <commit-anterior> && firebase deploy --only functions`.
- Reglas: consola → Firestore → Reglas → historial → publicar la versión anterior.
- Datos: no hay migraciones destructivas; los cambios de esquema son aditivos.

## 7. Copias de seguridad
Activar exportaciones programadas o PITR de Firestore:
```bash
gcloud firestore databases update --database='(default)' --enable-pitr
gcloud firestore export gs://<bucket-de-respaldos>    # manual o con Cloud Scheduler
```
Restauración: ver `docs/runbooks.md`.

## Costos esperados (orientativo)
`reminderSweep` = ~43,800 ejecuciones/mes (dentro de la capa gratuita de Functions); Cloud Scheduler: 1 de los 3 trabajos gratuitos. El costo variable principal es la IA (si se activa), limitada por las cuotas por plan.
