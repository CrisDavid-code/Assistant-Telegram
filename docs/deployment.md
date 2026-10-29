# Despliegue a costo cero (Firebase Spark + Cloudflare Workers)

Nunca se despliega a producción sin autorización explícita. No se requiere tarjeta de crédito en ninguno de los dos servicios.

| Pieza | Servicio | Plan |
|---|---|---|
| PWA | Firebase Hosting | Spark (gratis) |
| Inicio de sesión | Firebase Authentication | Spark |
| Base de datos | Cloud Firestore | Spark: 50 mil lecturas, 20 mil escrituras y 20 mil borrados al día; 1 GiB |
| API, webhook de Telegram, recordatorios | Cloudflare Worker + Cron Trigger | Workers Free: ~100 mil solicitudes al día |

## 1. Firebase (plan Spark)
1. Crear el proyecto en la consola de Firebase (sin activar facturación).
2. Authentication → habilitar **Correo/contraseña**; agregar el dominio de la PWA a dominios autorizados.
3. Firestore → crear la base en modo producción.
4. Registrar una app web y copiar su configuración a `apps/web/.env.production` (es pública). Agregar `VITE_API_URL=https://aguiteks-lifeos.<subdominio>.workers.dev` y `VITE_TELEGRAM_BOT_USERNAME`.
5. **Cuenta de servicio para el Worker:** Configuración del proyecto → Cuentas de servicio → *Generar nueva clave privada*. Guardar el JSON solo hasta subirlo como secreto (paso 3) y luego borrarlo del disco. Roles mínimos en Google Cloud IAM: **Cloud Datastore User** y **Firebase Authentication Viewer**.

```bash
npx firebase login
npx firebase use --add        # elige el proyecto y un alias (dev/prod)
```

## 2. Cloudflare (Workers Free)
```bash
cd worker
npx wrangler login
```
Completar `[vars]` en `worker/wrangler.toml`: `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS` (URL de la PWA), `TELEGRAM_BOT_USERNAME`, `APP_URL`, y opcionalmente `ADMIN_UIDS` (tu uid, visible en Firebase → Authentication) y `ADMIN_TELEGRAM_CHAT_ID` (alertas). El binding `[ai]` (voz) ya está configurado y es gratuito.

## 3. Secretos del Worker (nunca en el repositorio)
```bash
cd worker
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < /ruta/clave.json   # luego borra el archivo
npx wrangler secret put TELEGRAM_BOT_TOKEN
openssl rand -hex 32 | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ANTHROPIC_API_KEY        # opcional (IA de pago por uso)
```

## 4. Lista de comprobación previa
- [ ] `npm run typecheck && npm test && npm run test:emu && npm run build` en verde
- [ ] `apps/web/.env.production` y `wrangler.toml` apuntan al mismo proyecto
- [ ] Secretos cargados (`npx wrangler secret list`)

## 5. Orden de despliegue
Reglas e índices **antes** que el código que los usa:
```bash
npx firebase deploy --only firestore:rules,firestore:indexes
# esperar a que los índices estén READY (consola → Firestore → Índices)
cd worker && npx wrangler deploy && cd ..
npm run build -w apps/web && npx firebase deploy --only hosting
```
Después: registrar el webhook (`scripts/telegram-setup.mjs`, ver `docs/telegram-setup.md`).

## 6. Verificación posterior (humo)
`curl https://<worker>/health` → `ok`. Registrar una cuenta de prueba → crear tarea → registrar gasto → vincular Telegram → «/hoy» → recordatorio «en 2 minutos» → recibirlo. Logs en vivo: `cd worker && npx wrangler tail`.

## 7. Reversión
- Worker: `npx wrangler deployments list` y `npx wrangler rollback <id>`.
- Hosting: consola → Hosting → versión anterior → **Revertir**.
- Reglas: consola → Firestore → Reglas → historial → publicar la versión anterior.
- Datos: no hay migraciones destructivas; los cambios de esquema son aditivos.

## 8. Copias de seguridad en Spark
Las exportaciones administradas y PITR requieren facturación. Usa `scripts/backup.mjs` (ver `docs/runbooks.md`): respaldo y restauración completos por REST con la cuenta de servicio.

## Límites y riesgos del plan gratuito
| Límite | Consumo estimado | Qué pasa si se supera |
|---|---|---|
| Firestore 50 mil lecturas/día | Barrido de recordatorios ≈ 3 mil/día + uso normal | Firestore rechaza operaciones hasta el día siguiente (no cobra) |
| Workers 100 mil solicitudes/día | Cron 1,440/día + mensajes + API | Errores 429 hasta el día siguiente (no cobra) |
| Workers 10 ms de CPU por solicitud | Casi todo es espera de red; la firma RS256 se reutiliza 1 h | Solicitudes interrumpidas. Medir con `wrangler tail` en pruebas reales |
| Paquete del Worker ≤ 3 MB comprimido | 395 KB | No despliega |
| Workers AI (voz) | Asignación diaria gratuita | Las notas de voz fallan hasta el día siguiente; el bot pide escribir |
| Documentos | ≤ 700 KB por archivo; Firestore 1 GiB total | Se rechaza el archivo con un mensaje claro |

En ningún caso hay cobro: al superar un límite el servicio se detiene hasta que se renueva la cuota. La IA de Anthropic (opcional) sí es de pago por uso.
