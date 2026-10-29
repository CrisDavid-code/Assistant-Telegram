# Modelo de datos (Firestore)

Tipos exactos en `packages/contracts/src/entities.ts`. Todos los documentos los escribe **solo el backend**.

## Colecciones

| Ruta | Contenido | Lectura (reglas) |
|---|---|---|
| `users/{uid}` | `displayName, email, personalSpaceId, defaultSpaceId, telegram{chatId,username,linkedAt}, ownedBusinessSpaces` | El propio usuario |
| `spaces/{sid}` | `name, type(personal/business), ownerId, timezone, currency, status, plan` | Miembros activos |
| `spaces/{sid}/members/{uid}` | `uid, spaceId, spaceName, spaceType, role, status(active/invited/removed), displayName, email, invitedBy` | El propio usuario o miembros activos |
| `spaces/{sid}/tasks/{id}` | `title, notes, status, priority, dueDate, dueTime, dueAt, tags, assigneeId, contactId, source` | Miembros activos |
| `spaces/{sid}/reminders/{id}` | `title, userId, dueAt, scheduledFor, timezone, recurrence, anchorDay, status, version, attempts, lockedUntil, lastError, deliveredAt, taskId, obligationId` | Miembros activos |
| `spaces/{sid}/contacts/{id}` | `name, nameLower, phones[], emails[], company, jobTitle, notes, tags, relation, archived, lastContactAt` | Miembros activos |
| `spaces/{sid}/activities/{id}` | `type, summary, contactId, followUpReminderId` | Miembros activos |
| `spaces/{sid}/accounts/{id}` | `name, type, currency, openingBalance, balance, archived` | owner/admin/supervisor |
| `spaces/{sid}/transactions/{id}` | `kind(income/expense/transfer), status(posted/voided), amount, currency, accountId, toAccountId, toAmount, toCurrency, category, description, date, occurredAt, obligationId, voidReason` | owner/admin/supervisor |
| `spaces/{sid}/obligations/{id}` | `direction(payable/receivable), kind, title, counterparty, contactId, amount, paid, currency, dueDate, dueAt, status(open/partial/settled/cancelled), reminderId` | owner/admin/supervisor |
| `spaces/{sid}/budgets/{categoria}` | `category, limit, currency` (mensual) | owner/admin/supervisor |
| `spaces/{sid}/projects/{id}` | `name, description, status(active/paused/done/cancelled), dueDate, budget, currency, contactId` | Miembros activos |
| `spaces/{sid}/opportunities/{id}` | `title, contactId, stage(lead→won/lost), amount, currency, expectedClose, nextAction, notes, obligationId, closedAt` | Miembros activos |
| `spaces/{sid}/documents/{id}` | `title, type, issuer, issuedAt, expiresAt, tags, contactId, file{name,mime,size}, reminderId` | Miembros activos |
| `spaces/{sid}/documentFiles/{id}` | `data` (base64 ≤ 700 KB), `mime` | Nadie (solo por la API) |
| `spaces/{sid}/goals/{id}` | `name, target, saved, currency, targetDate, status(active/reached/archived)` | owner/admin/supervisor |
| `spaces/{sid}/goalContributions/{id}` | `goalId, amount (±), note` | owner/admin/supervisor |
| `spaces/{sid}/audit/{id}` | `actorId, source, op, target, details, result, at` | owner/admin |
| `spaces/{sid}/usage/{AAAA-MM}` | `month, assistantPerMonth, aiInputTokens, aiOutputTokens` | owner/admin |
| `deletedAccounts/{uid}` | fecha y número de espacios borrados (sin datos personales) | Nadie |
| `system/alerts` | última revisión de alertas operativas | Nadie |
| `telegramLinks/{chatId}` | `uid, username, linkedAt` | Nadie (backend) |
| `telegramLinkCodes/{sha256(código)}` | `uid, expiresAt, usedAt` | Nadie |
| `telegramUpdates/{update_id}` | marca de idempotencia, `expireAt` (TTL 7 días) | Nadie |
| `conversations/{tg_chatId \| pwa_uid}` | espacio elegido, propuesta pendiente, pregunta pendiente | Nadie |
| `rateLimits/{tg_chatId}` | ventana por minuto, `expireAt` (TTL) | Nadie |

## Reglas de consistencia

- **Dinero:** enteros en unidades menores + `currency` en cada registro. Nunca se suman monedas distintas (resúmenes agrupados por moneda).
- **Saldo de cuenta** (`balance`): calculado, actualizado en la misma transacción que el movimiento. `recomputeBalance` lo reconcilia contra los registros.
- **Transferencias:** un solo documento `kind: transfer`; no cuentan como ingreso ni gasto. Entre monedas distintas exige `toAmount` explícito.
- **Anulación:** `status: voided` + motivo; revierte saldos y lo pagado de la obligación. No hay borrado de movimientos.
- **Obligaciones:** crear una obligación no mueve dinero. `obligation.pay` crea el movimiento (gasto si `payable`, ingreso si `receivable`) y suma `paid` en la misma transacción; no se permite sobrepago. Estados: `open → partial → settled`, o `cancelled`.
- **Idempotencia:** el `requestId` del cliente es el id del documento; repetirlo devuelve `duplicate: true` sin efectos.
- **Tareas recurrentes:** al completar una, se crea la siguiente con id determinista (`{id}_{AAAAMMDD}`): completar dos veces no duplica.
- **Oportunidad ganada:** puede crear un cobro esperado (`obligations/opp_{id}`); nunca un ingreso.
- **Documentos:** el tipo real se valida por los primeros bytes (PDF, JPG, PNG, WEBP), no por el nombre.
- **Fechas:** instantes absolutos (`Timestamp`) + fecha/hora local y zona del espacio cuando importa para programar. Movimientos con solo fecha → `occurredAt` a mediodía local.

## Índices

Definidos en `firestore.indexes.json` (miembros por `uid` en grupo de colecciones, recordatorios por estado y vencimiento, tareas por estado/fecha, contactos, obligaciones, actividades por contacto). TTL en `telegramUpdates.expireAt` y `rateLimits.expireAt`.

## Retención

| Dato | Retención |
|---|---|
| Movimientos, obligaciones, auditoría | Indefinida mientras exista la cuenta (historial financiero y trazabilidad) |
| `telegramUpdates`, `rateLimits` | 7 días / 1 hora (TTL) |
| `telegramLinkCodes` | Se invalidan al usarse o a los 10 min; limpieza periódica pendiente (Fase 9) |
| `conversations` | Propuestas caducan a los 10 min; el documento se elimina al desvincular |
| Imágenes y notas de voz de Telegram | No se almacenan: se procesan en memoria |

## Limitaciones conocidas

- Resumen financiero suma en memoria hasta 5,000 movimientos/mes (`truncated: true` si se supera).
- Búsqueda de contactos filtra en memoria hasta 1,000 contactos por espacio.
