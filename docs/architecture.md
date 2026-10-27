# Arquitectura

## Componentes

```
 PWA (React)  ──lectura en tiempo real──▶  Firestore  ◀──Admin SDK──┐
     │                (reglas: solo lectura por rol)                  │
     └──httpsCallable("api", {op, spaceId, data})──▶ Cloud Function api ─┐
                                                                         ├─▶ runOp() ─▶ servicios de dominio ─▶ Firestore
 Telegram ──webhook HTTPS (secreto)──▶ Cloud Function telegramWebhook ───┘          (transacción + auditoría)
 Cloud Scheduler (cada minuto) ──▶ reminderSweep ──▶ entrega de recordatorios ──▶ Bot API
```

**Decisión central:** los clientes solo **leen** (con reglas de Firestore); toda **escritura** pasa por `runOp` (`functions/src/api/registry.ts`). Así la PWA, Telegram y la IA aplican exactamente las mismas validaciones, permisos e idempotencia, y no hay dos versiones de las reglas financieras.

## Capas del backend

| Capa | Dónde | Responsabilidad |
|---|---|---|
| Adaptadores de entrada | `api/callable.ts`, `telegram/webhook.ts`, `telegram/bot.ts`, `index.ts` (scheduler) | Traducir HTTP/Telegram/cron a operaciones. Sin reglas de negocio |
| Contratos | `packages/contracts/src/schemas.ts` | Validar cada entrada con Zod (`OPS`) |
| Autorización | `auth/context.ts` | Resolver membresía activa y rol desde Firestore; `requirePerm` |
| Servicios de dominio | `spaces/`, `tasks/`, `reminders/`, `contacts/`, `finance/`, `telegram/link.ts` | Reglas de negocio en transacciones |
| Auditoría | `shared/audit.ts` | Registro en la misma transacción que la operación |
| Integraciones | `telegram/api.ts`, `ai/claude.ts` | Clientes externos reemplazables en pruebas |
| Cuotas | `subscriptions/quota.ts` | Límites por plan aplicados antes de ejecutar |

## Flujo PWA

1. Firebase Auth (correo/contraseña). Primera sesión → `user.bootstrap` crea perfil y espacio personal (idempotente).
2. `SessionProvider` escucha `users/{uid}` y `collectionGroup('members').where('uid','==',uid)`; el espacio activo se guarda en `localStorage` solo como preferencia: el servidor valida la membresía en cada operación.
3. Pantallas leen con `onSnapshot`; las acciones llaman `call(op, spaceId, data)` (valida con el mismo contrato antes de enviar). El éxito solo se muestra cuando el servidor confirma.

## Flujo Telegram

1. Webhook valida `X-Telegram-Bot-Api-Secret-Token` (comparación en tiempo constante) → 401 si no coincide.
2. Idempotencia: `telegramUpdates/{update_id}.create()`; si ya existe, se responde 200 sin procesar.
3. Solo chats privados; límite de 30 mensajes/minuto por chat.
4. Chat no vinculado → instrucciones de vinculación (código de la PWA). Vinculado → resolver espacio → comando, contacto compartido, voz, imagen o texto.
5. Texto → `runOp('assistant.message')` (cuenta contra la cuota) → intérprete → plan → respuesta.

## Flujo de IA

```
texto ─▶ reglas en español (ai/rules.ts) ──entiende──▶ intención
                    └─no entiende y hay clave─▶ Claude (salida estructurada) ─▶ zIntent.parse ─▶ intención
intención ─▶ plan (ai/assistant.ts):
   consulta            → servicio de lectura (vuelve a comprobar permiso)
   tarea/recordatorio  → runOp directo (bajo riesgo), respuesta con el resultado real
   gasto/ingreso/deuda/contacto/imagen → propuesta guardada en conversations/{key} (10 min, ligada a
                         usuario + espacio + datos) → botón Confirmar → runOp(requestId = id de la propuesta)
   faltan datos        → pregunta corta; la respuesta completa la intención pendiente
```

La IA nunca accede a Firestore ni ejecuta: solo produce una intención que se valida y autoriza como cualquier entrada de usuario.

## Recordatorios duraderos

- Estado en `spaces/{s}/reminders/{id}`: `scheduled → sending → delivered | undeliverable | failed`, con `version`, `attempts`, `lockedUntil`.
- `reminderSweep` (cada minuto) toma vencidos con una transacción (`claim`), envía y guarda el resultado solo si la versión no cambió (`finish`). Reprogramar/cancelar sube la versión e invalida envíos en curso.
- Fallo de Telegram: reintentos con espera 2ⁿ minutos hasta 5 intentos → `failed`. Sin Telegram vinculado → `undeliverable` (visible en la PWA). Proceso caído → `sending` con plazo vencido se recupera.
- Entrega **al menos una vez**: si la función muere entre enviar y guardar, puede repetirse un aviso.
- Recurrencias en hora local con Luxon (respeta cambios de horario y meses cortos con `anchorDay`).
- Mejora futura: Cloud Tasks para precisión de segundos; el barrido seguiría como red de seguridad.

## Límites de confianza

| Origen | Confianza | Tratamiento |
|---|---|---|
| PWA / cliente | Ninguna | Contrato Zod + membresía/rol en servidor; `spaceId` solo selecciona |
| Telegram | Autenticidad por secreto del webhook | Identidad por vínculo `telegramLinks/{chatId}`, nunca por username |
| IA (texto, imágenes) | Ninguna | Salida validada; acciones financieras con confirmación; instrucciones del contenido ignoradas |
| Admin SDK | Total (salta reglas) | Por eso cada servicio llama `requirePerm` explícitamente |
