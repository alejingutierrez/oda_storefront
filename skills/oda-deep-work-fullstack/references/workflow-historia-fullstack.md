# Workflow historia full-stack

## 1) Delimitar historia

1. Identificar historia exacta en `USER_STORIES.md`.
2. Corroborar prioridad y alcance en `BACKLOG.md`.
3. Definir impacto por capa:
- UI/rutas/componentes.
- API/BFF/endpoints/actions.
- Datos/esquema/migraciones/scripts.
- Workers/scrapers/jobs.
- Integraciones externas (Vercel, Wompi, OpenAI, Neon, Blob).

## 2) Preparar ejecución

1. Confirmar prerequisitos faltantes solo si bloquean:
- Credenciales o claves no presentes.
- Variables de entorno críticas.
- Accesos de despliegue/DB.
2. Levantar servicios locales necesarios y revisar logs iniciales.

## 3) Implementar en profundidad

1. Corregir primero contratos entre capas (tipos/payloads/validación).
2. Implementar backend y datos antes de acoplar UI, salvo que la historia exija lo contrario.
3. Adaptar frontend al contrato final y estados de error/carga vacíos.
4. Preservar comportamiento existente no relacionado.

## 4) Verificar

1. Ejecutar validación mínima relevante:
- `lint` sobre archivos tocados o proyecto.
- tests directos del alcance.
- build cuando aplique.
2. Validar manualmente flujo crítico E2E.
3. Registrar limitaciones si algo no pudo ejecutarse.

## 5) Cerrar operación

1. Push de cambios a la rama de trabajo activa.
2. Esperar build en Vercel y corregir si falla.
3. Revisar logs de runtime del deployment final.

## 6) Sincronizar documentación

Actualizar siempre:

1. `README.md` (si hubo cambios de uso/config/comandos).
2. `USER_STORIES.md` (estado y evidencia de cierre).
3. `BACKLOG.md` (quitar/repriorizar tareas impactadas).
4. `STATUS.md` (resumen técnico, validaciones y riesgos remanentes).

## 7) Formato de reporte final recomendado

1. Qué se implementó (front/back/datos).
2. Qué se validó y con qué comandos.
3. Qué quedó pendiente o con riesgo.
4. Qué archivos de control se actualizaron.
