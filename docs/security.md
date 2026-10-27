# Seguridad y privacidad

## Autenticación
- Firebase Authentication (correo/contraseña, restablecimiento por correo). El callable `api` rechaza llamadas sin token.
- Telegram: identidad solo por vínculo verificado (`telegramLinks/{chatId}`), creado con un código de un solo uso.

## Autorización
- Roles por espacio: `owner, admin, supervisor, member, viewer` (`packages/contracts/src/permissions.ts`).

| Permiso | owner | admin | supervisor | member | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| Leer tareas/contactos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Escribir tareas/contactos | ✓ | ✓ | ✓ | ✓ | |
| Leer finanzas | ✓ | ✓ | ✓ | | |
| Escribir finanzas | ✓ | ✓ | | | |
| Gestionar miembros / espacio, ver auditoría | ✓ | ✓ | | | |

- El backend usa Admin SDK (salta reglas), por eso **cada servicio** llama `requirePerm` y `loadCtx` verifica membresía `active` y espacio `active`. El `spaceId` del cliente solo selecciona.
- Nadie modifica al propietario; solo el propietario nombra o modifica administradores; el espacio personal no admite miembros; quitar un miembro no transfiere datos.
- Planes ≠ permisos: el plan limita cuotas (`subscriptions/quota.ts`), los roles limitan datos.

## Reglas de Firestore y Storage
- Denegación por defecto. Clientes: **solo lectura** según rol; ninguna escritura directa (`firestore.rules`).
- Colecciones internas (`telegramLinkCodes`, `conversations`, `telegramLinks`, `rateLimits`) inaccesibles.
- Storage: todo denegado hasta implementar documentos privados (Fase 7) con URLs firmadas de corta duración.
- Probado en `tests/rules.test.ts` y `tests/security.test.ts`.

## Vinculación de Telegram
- Código de 10 caracteres (≈49 bits) con `crypto.randomInt`, válido 10 minutos, un solo uso, guardado como SHA-256.
- Mismo mensaje para código inexistente, usado o vencido. Un chat no puede robar el vínculo de otra cuenta.
- Desvincular desde la PWA o con `/desvincular` (confirmación) revoca el chat y borra su conversación.

## Telegram
- Secreto del webhook comparado en tiempo constante; actualizaciones repetidas ignoradas; 30 mensajes/min por chat.
- Solo chats privados (en grupos no se muestra información).
- Los logs no incluyen tokens ni contenido de mensajes (solo `update_id` y errores).

## IA
- Entrada y salida no confiables. La salida se valida con Zod; operaciones financieras, contactos e imágenes siempre se confirman.
- La confirmación está ligada a usuario, espacio, datos y vence en 10 minutos; se consume en una transacción y su id es la clave de idempotencia.
- Al proveedor se envía solo el mensaje actual, la fecha y la zona horaria; nunca historial ni datos guardados.

## Secretos
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` en Secret Manager. La configuración web de Firebase es pública por diseño.
- `.env*` locales ignorados por git.

## Auditoría
`spaces/{sid}/audit`: actor, origen (pwa/telegram/system), operación, documento, detalles sin secretos, fecha; escrita en la misma transacción. Cubre permisos, invitaciones, finanzas, anulaciones, vinculación de Telegram y configuración.

## Privacidad y ciclo de vida
- Datos personales y financieros separados por espacio; el espacio personal nunca se comparte.
- PWA: caché de Firestore en memoria (no se guardan finanzas en el dispositivo); el service worker solo guarda archivos de la app.
- Imágenes y voz de Telegram no se guardan.
- **Pendiente (Fase 9):** exportación de datos del usuario, solicitud de eliminación de cuenta, limpieza de códigos vencidos. La eliminación no puede ser instantánea en copias de seguridad (ver runbooks).
- **Pendiente:** verificación de correo obligatoria y App Check.
