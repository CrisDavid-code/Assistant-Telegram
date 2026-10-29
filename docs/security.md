# Seguridad y privacidad

## Autenticación
- Firebase Authentication (correo/contraseña, restablecimiento por correo). `POST /api` exige un ID token de Firebase verificado en el Worker (firma de Google, emisor, audiencia y vigencia con `jose`). El modo sin firma solo se activa si se apunta al emulador de Auth.
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

- El Worker usa una cuenta de servicio (salta reglas), por eso **cada servicio** llama `requirePerm` y `loadCtx` verifica membresía `active` y espacio `active`. El `spaceId` del cliente solo selecciona.
- Nadie modifica al propietario; solo el propietario nombra o modifica administradores; el espacio personal no admite miembros; quitar un miembro no transfiere datos.
- Planes ≠ permisos: el plan limita cuotas (`subscriptions/quota.ts`), los roles limitan datos.

## Reglas de Firestore y Storage
- Denegación por defecto. Clientes: **solo lectura** según rol; ninguna escritura directa (`firestore.rules`).
- Colecciones internas (`telegramLinkCodes`, `conversations`, `telegramLinks`, `rateLimits`) inaccesibles.
- Archivos: Cloud Storage para Firebase exige facturación en proyectos nuevos; los documentos privados (Fase 7) se guardarán en Cloudflare R2 (10 GB gratis) con URLs firmadas de corta duración.
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
- `FIREBASE_SERVICE_ACCOUNT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` como secretos cifrados del Worker. Cuenta de servicio con roles mínimos (Cloud Datastore User, Firebase Authentication Viewer).
- CORS: `/api` solo acepta los orígenes de `ALLOWED_ORIGINS`. La configuración web de Firebase es pública por diseño.
- `.env*` locales ignorados por git.

## Auditoría
`spaces/{sid}/audit`: actor, origen (pwa/telegram/system), operación, documento, detalles sin secretos, fecha; escrita en la misma transacción. Cubre permisos, invitaciones, finanzas, anulaciones, vinculación de Telegram y configuración.

## Privacidad y ciclo de vida
- Datos personales y financieros separados por espacio; el espacio personal nunca se comparte.
- PWA: caché de Firestore en memoria (no se guardan finanzas en el dispositivo); el service worker solo guarda archivos de la app.
- Imágenes y voz de Telegram no se guardan.
- **Exportación:** Configuración → Mis datos → «Exportar mis datos» (JSON de los espacios propios; archivos como metadatos).
- **Eliminación de cuenta:** exige escribir ELIMINAR; bloquea si la persona es dueña de una empresa con otros miembros; borra sus espacios, sale de los ajenos, revoca Telegram y elimina el usuario de Auth. Queda solo `deletedAccounts/{uid}` sin datos personales. Los respaldos JSON existentes deben borrarse aparte.
- **Verificación de correo:** se envía al registrarse; es obligatoria para invitar personas.
- **Documentos:** solo PDF/JPG/PNG/WEBP verificados por bytes, ≤ 700 KB; el contenido no es legible directo desde el cliente.
- **Administración:** `ADMIN_UIDS` en el Worker; el backend lo verifica en cada operación de administración.
- Limpieza automática de códigos de vinculación vencidos (cada 15 min).
- **No incluido:** App Check (opcional; requiere reCAPTCHA).
