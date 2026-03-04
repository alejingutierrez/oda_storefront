# BUGS.md

## 1) Cron admin token parsing incorrecto en catalog refresh
- Prioridad: **P1 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/catalog-refresh/cron/route.ts`
- Descripción: `hasAdminToken` usa la expresión `/^Bearer\\s+/i` (literal `\\s`) al parsear `Authorization`, por lo que `Bearer <token>` no se transforma correctamente y no coincide con `ADMIN_TOKEN`.
- Impacto: Llamadas manuales con `Authorization: Bearer ...` a `GET /api/admin/catalog-refresh/cron` pueden ser rechazadas con `401` a pesar de tener token válido.
- Acción propuesta:
  - Corregir el parseo al mismo patrón usado por `validateAdminRequest`: `/^Bearer\s+/i`.
  - Reutilizar función de parseo compartida para evitar desalineación futura.

## 2) Fallback de autenticación en workers contra `NEXTAUTH_SECRET`
- Prioridad: **P1 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/services/worker/index.js`
- Descripción: Los workers usan `ADMIN_TOKEN || NEXTAUTH_SECRET` para firmar `Authorization` al invocar endpoints admin. `validateAdminRequest` no acepta `NEXTAUTH_SECRET`, por lo que en ausencia de `ADMIN_TOKEN` los requests entran con token inválido.
- Impacto: Cola de catálogo/enriquecimiento puede fallar con 401 en endpoints `process-item`.
- Acción propuesta:
  - Eliminar fallback a `NEXTAUTH_SECRET` en los workers.
  - Hacer obligatorio `ADMIN_TOKEN` y fallar al iniciar worker si no está configurado.
- Estado: **resuelto en repo actual** (`services/worker/index.js` exige `ADMIN_TOKEN` y no contempla fallback).

## 3) Job demo de cola en arranque
- Prioridad: **P3 (media)**
- Archivo: `/Volumes/MyApps/oda_storefront/services/worker/index.js`
- Descripción: Existe `queue.add('demo', { hello: 'world' })` con ejecución automática en startup.
- Impacto: Inserción de jobs no productivos, ruido en métricas y posible degradación de la cola.
- Acción propuesta:
  - Retirar el `demo` job o ejecutarlo solo en no producción (`NODE_ENV !== 'production'`).
- Estado: **resuelto en repo actual** (no se observa job demo de arranque).

## 5) Posible carrera en `orderIndex` al crear/duplicar items de cola de product-curation
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/product-curation/queue/route.ts`
- Descripción: Operaciones concurrentes de inserción/duplicado pueden leer y calcular `orderIndex` sin bloqueo.
- Impacto: Posibles duplicados y orden inestable en la cola de curación.
- Acción propuesta:
  - Serializar la sección de cálculo/asignación de `orderIndex` o usar secuencia/lock para evitar condiciones de carrera.

## 6) `apply` de product-curation sin claim atómico
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/product-curation/queue/apply/route.ts`
- Descripción: El flujo puede tomar y procesar items pendientes sin claim atómico.
- Impacto: En ejecuciones concurrentes hay riesgo de doble procesamiento del mismo item.
- Acción propuesta:
  - Realizar claim y transición a estado en una operación atómica (`UPDATE ... WHERE status='pending' ... RETURNING`).

## 7) `apply` actualiza items sin validar estado actual
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/product-curation/queue/apply/route.ts`
- Descripción: La transición a `applying` ocurre sin confirmar que el item siga pendiente.
- Impacto: Puede sobrescribir acciones ya canceladas u ocupadas por otro proceso.
- Acción propuesta:
  - Verificar estado precondición antes del update y registrar conflicto para reintento.

## 4) Revisión pendiente
- Prioridad: **P4 (baja)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/color-combinations/route.ts`
- Descripción: La paginación se hace en memoria tras cargar la colección completa; puede volverla costosa conforme crece el catálogo.
- Impacto: Latencia y consumo de recursos innecesario con alto volumen.
- Acción propuesta: Mover paginación a consulta DB (limit/offset en `findMany`) y recuperar sólo campos estrictamente necesarios.

## 8) Falta validación de `variantId` por `productId` en favoritos/listas
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/user/favorites/route.ts` y `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/user/lists/[listId]/items/route.ts`
- Descripción: Al guardar un `variantId`, se consulta/crea el registro sin comprobar que ese `variantId` pertenezca al `productId` recibido.
- Impacto: Se pueden persistir relaciones inconsistentes (o fallar con error de FK) y mostrar/usar datos incorrectos al listar favoritos/listas.
- Acción propuesta:
  - Validar `variantId` con `prisma.variant.findFirst({ where: { id, productId }})` antes de crear o reutilizar registro.
  - Retornar error 400 cuando el par sea inválido.

## 9) `admin/products` no valida `page`/`pageSize` y puede quedar con `NaN`
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/products/route.ts`
- Descripción: `page` y `pageSize` usan `Number(...)` directo junto con `Math.max/Math.min`; con valores no numéricos terminan en `NaN`.
- Impacto: `skip`/`take` de Prisma reciben `NaN`, generando respuestas 500 o paginación inválida.
- Acción propuesta:
  - Introducir parser seguro con fallback (`Number.isFinite`) para ambos parámetros.
  - Normalizar a rangos mínimos/máximos explícitos antes del query.

## 10) Lecturas de configuración numérica en `queue-health` pueden devolver `NaN`
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/queue-health/route.ts`
- Descripción: Varios parámetros de entorno se parsean con `Number()` y se envuelven en `Math.max(...)`; si la variable es inválida (`abc`) el resultado queda `NaN`.
- Impacto: Métricas de salud de colas y umbrales de diagnóstico pueden desactivarse silenciosamente (`NaN`) y ocultar regresiones de cola.
- Acción propuesta:
  - Usar helper de parsing numérico estricto con fallback (`Number.isFinite`) para cada variable crítica.
  - Registrar valor efectivo usado en respuesta de diagnóstico.

## 11) Configuración de tiempo/concurrencia en worker puede quedar en `NaN`
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/services/worker/index.js`
- Descripción: Variables como `WORKER_ACTIVE_HUNG_MINUTES`, `WORKER_HEARTBEAT_*` y `WORKER_AUTONOMOUS_*` se parsean sin validación robusta (se asumen `Number(...)` válidos).
- Impacto: En caso de env inválida, `Math.max` termina en `NaN` y timers/concurrencias quedan inválidos (`heartbeatIntervalMs`, watchdogs, límites de cola) con comportamiento no determinista.
- Acción propuesta:
  - Sustituir parsers por función central de `safeNumber`.
  - Definir límites mínimos/máximos y fallback determinístico.

## 12) Sesión de admin válida sin caducidad server-side
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/lib/auth.ts`
- Descripción: `validateAdminRequest` valida hash de `admin_session` pero no comprueba `sessionTokenCreatedAt` contra `SESSION_TTL_DAYS`.
- Impacto: Si un token admin es filtrado, permanece válido hasta que se sobrescriba manualmente, aun fuera de ventana de sesión esperada.
- Acción propuesta:
  - Guardar y comparar `sessionTokenCreatedAt` en validación.
  - Invalidar sesión del lado servidor cuando exceda TTL y limpiar cookie/tokens obsoletos.

## 13) `x-descope-session` en request sin verificación en servidor
- Prioridad: **P1 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/lib/descope.ts`
- Descripción: `getDescopeSessionFromRequest` confía en `x-descope-session` (base64+JSON) cuando viene en la cabecera, sin validar firma ni integridad del contenido.
- Impacto: Un cliente puede falsificar este header y suplantar sesión.
- Acción propuesta:
  - Reemplazar ese camino por validación del JWT de descope en backend o firmar/verificar el payload de la cabecera antes de usarlo.

## 14) `syncUserFromDescope` permite sobrescritura de campos con `fallbackUser` no confiable
- Prioridad: **P2 (alta)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/lib/descope.ts`
- Descripción: En `syncUserFromDescope`, `fallbackUser` se mezcla con spread antes de `descopeUser`, permitiendo que datos del request reemplacen campos del token.
- Impacto: Riesgo de inyección de identidad/atributos (por ejemplo email) y desalineación con el sujeto real.
- Acción propuesta:
  - Limitar `fallbackUser` a campos no sensibles o usar solo valores de fallback para campos ausentes.
  - Validar/omitir campos críticos antes de merge.

## 15) `PATCH /api/user/profile` acepta payload vacío y puede reventar Prisma
- Prioridad: **P3 (baja)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/user/profile/route.ts`
- Descripción: Si el body viene vacío, `updatePayload` queda `{}` y se ejecuta `prisma.user.update` con data vacía.
- Impacto: Falla en runtime (error de Prisma por objeto de update vacío).
- Acción propuesta:
  - Retornar `400` cuando no haya campos editables.
  - Mantener validación explícita de campos permitidos.

## 16) `experience/events` no valida FK de IDs de dominio
- Prioridad: **P3 (baja)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/experience/events/route.ts`
- Descripción: El endpoint registra `productId/variantId/brandId/listId` sin verificar existencia en tabla destino.
- Impacto: Peticiones con IDs aleatorios pueden generar 500 por FK, ruido en telemetría y pérdida de eventos.
- Acción propuesta:
  - Validar opcionalmente si los IDs existen antes de persistir, o registrar `null` con campo de integridad.

## 17) `catalog-extractor/brands` acepta `limit` negativo
- Prioridad: **P3 (baja)**
- Archivo: `/Volumes/MyApps/oda_storefront/apps/web/src/app/api/admin/catalog-extractor/brands/route.ts`
- Descripción: `limit` solo se limita superiormente y puede quedar negativo tras `Math.min`, y se pasa directo a `take`.
- Impacto: Errores intermitentes de Prisma para consultas con `take` inválido.
- Acción propuesta:
  - Aplicar `Math.max(1, Math.min(...))` y fallback seguro para valores negativos o no numéricos.
