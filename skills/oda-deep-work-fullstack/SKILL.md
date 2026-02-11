---
name: oda-deep-work-fullstack
description: Ejecutar historias de usuario complejas de ODA Storefront con enfoque de trabajo profundo y alcance end-to-end (frontend, backend, datos y operación). Usar cuando la solicitud implique cambios coordinados entre `apps/web` y servicios/workers, cuando se deba respetar contexto vivo de producto (`AGENTS.md`, `BACKLOG.md`, `USER_STORIES.md`, `STATUS.md`), o cuando se necesite cerrar una historia con validación técnica, actualización documental y verificación de despliegue.
---

# ODA Deep Work Fullstack

## Objetivo

Entregar implementaciones robustas y completas en ODA, evitando cambios aislados. Construir primero el contexto vivo del proyecto, luego ejecutar cambios full-stack con verificación real y cierre documental.

## Cargar contexto obligatorio

Leer estos archivos en este orden, antes de proponer o tocar código:

1. `AGENTS.md`
2. `BACKLOG.md`
3. `USER_STORIES.md`
4. `STATUS.md`
5. `README.md`

Aplicar esta lectura para:

1. Confirmar alcance funcional real y restricciones vigentes.
2. Detectar historias relacionadas ya iniciadas o cerradas.
3. Evitar regresiones sobre decisiones previas de arquitectura y operación.

Usar `references/contexto-obligatorio.md` como guía de lectura rápida.

## Ejecutar workflow de historia full-stack

Seguir siempre este flujo:

1. Solicitar o confirmar prerequisitos mínimos faltantes (credenciales, llaves API, accesos, variables de entorno), solo si realmente bloquean la ejecución.
2. Levantar el contexto técnico específico: rutas afectadas de frontend (`apps/web`) y backend/servicios (`apps/web/app/api`, `services/*`, scripts de soporte).
3. Definir plan corto con impacto por capa:
`UI/UX`, `BFF/API`, `persistencia`, `workers/scrapers`, `observabilidad`, `billing/flags` si aplica.
4. Implementar cambios end-to-end, priorizando consistencia de contrato entre capas.
5. Ejecutar validación local relevante (lint, tests, build, scripts de verificación) y corregir fallas.
6. Ejecutar cierre operativo de historia según protocolo ODA:
   - Push de cambios.
   - Verificar build/deploy en Vercel.
   - Revisar logs de runtime del deployment resultante.
7. Actualizar documentación obligatoria de control:
`README.md`, `USER_STORIES.md`, `BACKLOG.md`, `STATUS.md`.

Usar `references/workflow-historia-fullstack.md` para checklist detallado.

## Reglas de profundidad

1. Trazar impacto cruzado antes de editar: endpoint, esquema de datos, consumo en UI y efectos en jobs.
2. Evitar soluciones parciales cuando la historia exige consistencia E2E.
3. Preferir cambios pequeños pero completos, en lugar de cambios grandes incompletos.
4. Mantener contratos explícitos (tipos, payloads, validaciones de entrada y salida).
5. Si aparecen cambios inesperados no hechos por el agente durante el trabajo, detener y pedir instrucción.
6. No omitir actualización de historias/backlog/estado cuando se considera historia terminada.

## Criterios de terminado

Considerar la historia lista solo si:

1. El comportamiento funciona en frontend y backend para el caso principal y casos límite relevantes.
2. No hay errores bloqueantes en validación local ejecutable.
3. El deploy objetivo compila y no presenta errores de runtime visibles.
4. La documentación operativa y de producto está sincronizada.

## Referencias incluidas

1. `references/contexto-obligatorio.md`
2. `references/workflow-historia-fullstack.md`
