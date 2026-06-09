---
title: Utilidades nativas de medios y sistema
description: >-
  Utilidades nativas de procesamiento de medios para capturas de pantalla,
  manejo de imágenes e información del sistema.
sidebar:
  order: 7
  label: Utilidades de medios y sistema
i18n:
  sourceHash: 430898c177bc
  translator: machine
---

# Utilidades nativas de medios + sistema

Este documento es una inmersión profunda en el subsistema de la capa de **primitivas de sistema/medios/conversión** descrita en [`docs/natives-architecture.md`](./natives-architecture.md): `image`, `html`, `clipboard` y perfilado de `work`.

## Archivos de implementación

- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/prof.rs`
- `crates/pi-natives/src/task.rs`
- `packages/natives/src/image/index.ts`
- `packages/natives/src/image/types.ts`
- `packages/natives/src/html/index.ts`
- `packages/natives/src/html/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/work/index.ts`
- `packages/natives/src/work/types.ts`

> Nota: no existe `crates/pi-natives/src/work.rs`; el perfilado de trabajo está implementado en `prof.rs` y alimentado por la instrumentación en `task.rs`.

## Mapeo de API TS ↔ exportación/módulo Rust

| Exportación TS (packages/natives)           | Exportación N-API de Rust                                               | Módulo Rust                           |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `PhotonImage.parse(bytes)`                  | `PhotonImage::parse`                                                     | `image.rs`                            |
| `PhotonImage#resize(width, height, filter)` | `PhotonImage::resize`                                                    | `image.rs`                            |
| `PhotonImage#encode(format, quality)`       | `PhotonImage::encode`                                                    | `image.rs`                            |
| `htmlToMarkdown(html, options)`             | `html_to_markdown`                                                       | `html.rs`                             |
| `copyToClipboard(text)`                     | `copy_to_clipboard` + lógica de respaldo en TS                           | `clipboard.rs` + `clipboard/index.ts` |
| `readImageFromClipboard()`                  | `read_image_from_clipboard`                                              | `clipboard.rs`                        |
| `getWorkProfile(lastSeconds)`               | `get_work_profile`                                                      | `prof.rs`                             |

## Límites de formato de datos y conversiones

### Imagen (`image`)

- **Límite de entrada JS**: `Uint8Array` con bytes de imagen codificada.
- **Límite de decodificación Rust**: los bytes se copian a `Vec<u8>`, el formato se detecta con `ImageReader::with_guessed_format()`, luego se decodifica a `DynamicImage`.
- **Estado en memoria**: `PhotonImage` almacena `Arc<DynamicImage>`.
- **Límite de salida**: `encode(format, quality)` devuelve `Promise<Uint8Array>` (`Vec<u8>` en Rust).

Los IDs de formato son numéricos:

- `0`: PNG
- `1`: JPEG
- `2`: WebP (codificador sin pérdida)
- `3`: GIF

Restricciones:

- `quality` solo se utiliza para JPEG.
- PNG/WebP/GIF ignoran `quality`.
- Los IDs de formato no soportados fallan (`Invalid image format: <id>`).

### Conversión HTML (`html`)

- **Límite de entrada JS**: `string` HTML + objeto opcional `{ cleanContent?: boolean; skipImages?: boolean }`.
- **Límite de conversión Rust**: la entrada `String` se convierte mediante `html_to_markdown_rs::convert`.
- **Límite de salida**: `string` Markdown.

Comportamiento de conversión:

- `cleanContent` tiene valor predeterminado `false`.
- Cuando `cleanContent=true`, se habilita el preprocesamiento con `PreprocessingPreset::Aggressive` y flags de eliminación forzada para navegación/formularios.
- `skipImages` tiene valor predeterminado `false`.

### Portapapeles (`clipboard`)

- **Ruta de texto**:
  - TS primero emite OSC 52 (`\x1b]52;c;<base64>\x07`) cuando stdout es una TTY.
  - El mismo texto se intenta luego a través de la API nativa del portapapeles (`native.copyToClipboard`) como mejor esfuerzo.
  - En Termux, TS intenta `termux-clipboard-set` primero.
- **Ruta de lectura de imagen**:
  - Rust lee la imagen sin procesar desde `arboard`.
  - Rust la recodifica a bytes PNG (crate `image`), devuelve `{ data: Uint8Array, mimeType: "image/png" }`.
  - TS devuelve `null` anticipadamente en Termux o sesiones Linux sin servidor de pantalla (`DISPLAY`/`WAYLAND_DISPLAY` ausentes).

### Perfilado de trabajo (`work`)

- **Límite de recolección**: las muestras de perfilado son producidas por guardias `profile_region(tag)` en `task::blocking` y `task::future`.
- **Formato de almacenamiento**: búfer circular de tamaño fijo (`MAX_SAMPLES = 10_000`) que almacena ruta de pila + duración (`μs`) + marca de tiempo (`μs desde inicio del proceso`).
- **Límite de salida**: `getWorkProfile(lastSeconds)` devuelve un objeto:
  - `folded`: texto de pila plegada (entrada para flamegraph)
  - `summary`: tabla resumen en markdown
  - `svg`: SVG de flamegraph opcional
  - `totalMs`, `sampleCount`

## Ciclo de vida y transiciones de estado

### Ciclo de vida de imagen

1. `PhotonImage.parse(bytes)` programa una tarea de decodificación bloqueante (`image.decode`).
2. En caso de éxito, existe un handle nativo `PhotonImage` en JS.
3. `resize(...)` crea un nuevo handle nativo (`image.resize`), los handles antiguo y nuevo pueden coexistir.
4. `encode(...)` materializa bytes (`image.encode`) sin mutar las dimensiones de la imagen.

Transiciones de fallo:

- Un fallo en la detección de formato/decodificación rechaza la promesa de parse.
- Un fallo en la codificación rechaza la promesa de encode.
- Un ID de formato inválido rechaza la promesa de encode.

### Ciclo de vida de HTML

1. `htmlToMarkdown(html, options)` programa una tarea de conversión bloqueante.
2. La conversión se ejecuta con opciones predeterminadas (`cleanContent=false`, `skipImages=false`) a menos que se especifiquen.
3. Devuelve una cadena markdown o rechaza.

Transiciones de fallo:

- Un fallo del convertidor devuelve una promesa rechazada (`Conversion error: ...`).

### Ciclo de vida del portapapeles

`copyToClipboard(text)` es intencionalmente de mejor esfuerzo y multi-ruta:

1. Si es TTY: intenta escritura OSC 52 (payload en base64).
2. Intenta el comando de Termux cuando `TERMUX_VERSION` está configurado.
3. Intenta copia de texto nativa con `arboard`.
4. Suprime errores en la capa TS.

`readImageFromClipboard()` difiere en rigurosidad según la etapa:

1. TS bloquea estrictamente contextos de ejecución no soportados (Termux/Linux sin interfaz gráfica) devolviendo `null`.
2. La lectura de `arboard` en Rust se ejecuta solo cuando TS lo permite.
3. `ContentNotAvailable` se mapea a `null`.
4. Otros errores de Rust rechazan la promesa.

### Ciclo de vida del perfilado de trabajo

1. Sin inicio explícito: el perfilado está siempre activo cuando se ejecutan los helpers de tareas.
2. Cada ámbito de tarea instrumentado registra una muestra al destruir el guardia.
3. Las muestras sobrescriben las entradas más antiguas después de alcanzar la capacidad del búfer.
4. `getWorkProfile(lastSeconds)` lee una ventana de tiempo y deriva artefactos plegados/resumen/svg.

Transiciones de fallo:

- Un fallo en la generación de SVG es un fallo suave (`svg: null`), mientras que folded y summary aún se devuelven.
- Una ventana de muestras vacía devuelve datos folded vacíos y `svg: null`, no un error.

## Operaciones no soportadas y propagación de errores

### Imagen

- Entrada de decodificación no soportada o bytes corruptos: fallo estricto (rechazo de promesa).
- ID de formato de codificación no soportado: fallo estricto.
- Sin ruta de respaldo de mejor esfuerzo en el wrapper TS.

### HTML

- Los errores de conversión son fallos estrictos (rechazo).
- La omisión de opciones usa valores predeterminados de mejor esfuerzo, no fallo.

### Portapapeles

- La copia de texto es de mejor esfuerzo en la capa TS: los fallos operacionales se suprimen.
- La lectura de imagen distingue "sin imagen" (`null`) de fallo operacional (rechazo).
- Termux/Linux sin interfaz gráfica se tratan como contextos no soportados para lectura de imagen (`null`).

### Perfilado de trabajo

- La recuperación es estricta para la llamada a la función en sí, pero la generación de artefactos es parcialmente de mejor esfuerzo (`svg` puede ser nulo).
- El truncamiento del búfer es comportamiento esperado (búfer circular), no un error de pérdida de datos.

## Consideraciones de plataforma

- **Texto del portapapeles**: OSC 52 depende del soporte del terminal; el acceso nativo al portapapeles depende del entorno de escritorio/sesión.
- **Lectura de imagen del portapapeles**: bloqueada en TS para Termux y Linux sin servidor de pantalla.
