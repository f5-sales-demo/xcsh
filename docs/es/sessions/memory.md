---
title: Memoria autónoma
description: >-
  Sistema de memoria autónoma para persistir preferencias del usuario, contexto
  del proyecto y retroalimentación entre sesiones.
sidebar:
  order: 7
  label: Memoria autónoma
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# Memoria autónoma

Cuando está habilitada, el agente extrae automáticamente conocimiento duradero de sesiones anteriores e inyecta un resumen compacto en cada nueva sesión. Con el tiempo construye un almacén de memoria con alcance de proyecto — decisiones técnicas, flujos de trabajo recurrentes, problemas conocidos — que se traslada sin esfuerzo manual.

Deshabilitada por defecto. Habilítela mediante `/settings` o `config.yml`:

```yaml
memories:
  enabled: true
```

## Uso

### Qué se inyecta

Al inicio de la sesión, si existe un resumen de memoria para el proyecto actual, se inyecta en el prompt del sistema como un bloque de **Memory Guidance**. El agente recibe instrucciones de:

- Tratar la memoria como contexto heurístico — útil para procesos y decisiones previas, no autoritativo sobre el estado actual del repositorio.
- Citar la ruta del artefacto de memoria cuando la memoria cambie el plan, y combinarlo con evidencia del repositorio actual antes de actuar.
- Preferir el estado del repositorio y las instrucciones del usuario cuando entren en conflicto con la memoria; tratar la memoria en conflicto como obsoleta.

### Lectura de artefactos de memoria

El agente puede leer archivos de memoria directamente usando URLs `memory://` con la herramienta `read`:

| URL | Contenido |
|---|---|
| `memory://root` | Resumen compacto inyectado al inicio |
| `memory://root/MEMORY.md` | Documento completo de memoria a largo plazo |
| `memory://root/skills/<name>/SKILL.md` | Un manual de habilidades generado |

### Comando slash `/memory`

| Subcomando | Efecto |
|---|---|
| `view` | Mostrar el payload de inyección de memoria actual |
| `clear` / `reset` | Eliminar todos los datos de memoria y artefactos generados |
| `enqueue` / `rebuild` | Forzar la consolidación para que se ejecute en el próximo inicio |

## Cómo funciona

Las memorias se construyen mediante un pipeline en segundo plano que se ejecuta al inicio o se activa manualmente mediante comando slash.

**Fase 1 — extracción por sesión:** Para cada sesión pasada que haya cambiado desde la última vez que fue procesada, un modelo lee el historial de la sesión y extrae señales duraderas: decisiones técnicas, restricciones, fallos resueltos, flujos de trabajo recurrentes. Las sesiones que son demasiado recientes, demasiado antiguas o que están actualmente activas se omiten. Cada extracción produce un bloque de memoria sin procesar y una sinopsis corta para esa sesión.

**Fase 2 — consolidación:** Después de la extracción, una segunda pasada del modelo lee todas las extracciones por sesión y produce tres salidas escritas en disco:

- `MEMORY.md` — un documento de memoria a largo plazo curado
- `memory_summary.md` — el texto compacto inyectado al inicio de la sesión
- `skills/` — manuales de procedimientos reutilizables, cada uno en su propio subdirectorio

La Fase 2 utiliza un lease para prevenir la doble ejecución cuando múltiples procesos inician simultáneamente. Los directorios de habilidades obsoletos de ejecuciones anteriores se eliminan automáticamente.

Toda la salida se escanea en busca de secretos antes de escribirse en disco.

### Comportamiento de extracción

El comportamiento de extracción y consolidación de memoria está completamente dirigido por archivos de prompts estáticos en `src/prompts/memories/`.

| Archivo | Propósito | Variables |
|---|---|---|
| `stage_one_system.md` | Prompt del sistema para extracción por sesión | — |
| `stage_one_input.md` | Plantilla de turno de usuario que envuelve el contenido de la sesión | `{{thread_id}}`, `{{response_items_json}}` |
| `consolidation.md` | Prompt para consolidación entre sesiones | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read_path.md` | Guía de memoria inyectada en sesiones activas | `{{memory_summary}}` |

### Selección de modelo

La memoria se apoya en el sistema de roles de modelos.

| Fase | Rol | Propósito |
|---|---|---|
| Fase 1 (extracción) | `default` | Extracción de conocimiento por sesión |
| Fase 2 (consolidación) | `smol` | Síntesis entre sesiones |

Si `smol` no está configurado, la Fase 2 recurre al rol `default`.

## Configuración

| Ajuste | Valor predeterminado | Descripción |
|---|---|---|
| `memories.enabled` | `false` | Interruptor principal |
| `memories.maxRolloutAgeDays` | `30` | Las sesiones más antiguas que este valor no se procesan |
| `memories.minRolloutIdleHours` | `12` | Las sesiones activas más recientemente que este valor se omiten |
| `memories.maxRolloutsPerStartup` | `64` | Límite de sesiones procesadas en un solo inicio |
| `memories.summaryInjectionTokenLimit` | `5000` | Máximo de tokens del resumen inyectado en el prompt del sistema |

Controles adicionales de ajuste (concurrencia, duraciones de lease, presupuestos de tokens) están disponibles en la configuración para uso avanzado.

## Archivos clave

- `src/memories/index.ts` — orquestación del pipeline, inyección, manejo de comandos slash
- `src/memories/storage.ts` — cola de trabajos respaldada por SQLite y registro de hilos
- `src/prompts/memories/` — plantillas de prompts de memoria
- `src/internal-urls/memory-protocol.ts` — manejador de URLs `memory://`
