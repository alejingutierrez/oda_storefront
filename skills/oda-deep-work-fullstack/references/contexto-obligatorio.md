# Contexto obligatorio ODA

## Objetivo

Construir una base de contexto mínima pero suficiente antes de implementar cambios.

## Orden de lectura

1. `AGENTS.md`
2. `BACKLOG.md`
3. `USER_STORIES.md`
4. `STATUS.md`
5. `README.md`

## Qué extraer de cada archivo

### `AGENTS.md`
- Arquitectura vigente (front/BFF/workers/scrapers/DB/colas).
- Protocolo obligatorio por historia.
- Reglas de seguridad, despliegue y operación.
- Restricciones de git y calidad.

### `BACKLOG.md`
- Prioridad y dependencias de la historia a implementar.
- Bloqueos abiertos o deuda técnica asociada.

### `USER_STORIES.md`
- Estado exacto de la historia (pendiente/en curso/terminada).
- Criterios de aceptación y notas históricas.

### `STATUS.md`
- Últimos cambios relevantes y fallas recientes.
- Riesgos activos y decisiones temporales.

### `README.md`
- Comandos oficiales de ejecución y validación.
- Variables de entorno requeridas.
- Flujo operativo actualizado para contribución.

## Regla de alineación

Si la solicitud del usuario contradice documentos vivos, priorizar:

1. Instrucción directa del usuario en el turno actual.
2. Restricciones operativas/seguridad de `AGENTS.md`.
3. Estado documental (`USER_STORIES.md`, `BACKLOG.md`, `STATUS.md`).

Explicitar cualquier conflicto antes de editar.
