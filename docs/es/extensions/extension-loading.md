---
title: Carga de extensiones (módulos TypeScript/JavaScript)
description: >-
  Pipeline de carga de módulos TypeScript y JavaScript para extensiones con
  resolución, validación y caché.
sidebar:
  order: 2
  label: Carga de extensiones
i18n:
  sourceHash: a8cea231c660
  translator: machine
---

# Carga de extensiones (módulos TypeScript/JavaScript)

Este documento cubre cómo el agente de codificación descubre y carga **módulos de extensión** (`.ts`/`.js`) durante el inicio.

**No** cubre las extensiones de manifiesto `gemini-extension.json` (documentadas por separado).

## Qué hace este subsistema

La carga de extensiones construye una lista de archivos de entrada de módulos, importa cada módulo con Bun, ejecuta su factory y devuelve:

- definiciones de extensiones cargadas
- errores de carga por ruta (sin abortar la carga completa)
- un objeto compartido de runtime de extensiones utilizado posteriormente por `ExtensionRunner`

## Archivos de implementación principales

- `src/extensibility/extensions/loader.ts` — descubrimiento de rutas + importación/ejecución
- `src/extensibility/extensions/index.ts` — exportaciones públicas
- `src/extensibility/extensions/runner.ts` — ejecución de runtime/eventos después de la carga
- `src/discovery/builtin.ts` — proveedor nativo de auto-descubrimiento para módulos de extensión
- `src/config/settings.ts` — carga la configuración combinada de `extensions` / `disabledExtensions`

---

## Entradas para la carga de extensiones

### 1) Módulos de extensión nativos auto-descubiertos

`discoverAndLoadExtensions()` primero solicita a los proveedores de descubrimiento elementos con capacidad `extension-module`, luego conserva solo los elementos del proveedor `native`.

Ubicaciones nativas efectivas:

- Proyecto: `<cwd>/.xcsh/extensions`
- Usuario: `~/.xcsh/agent/extensions`

Las rutas raíz provienen del proveedor nativo (`SOURCE_PATHS.native`).

Notas:

- El auto-descubrimiento nativo actualmente está basado en `.xcsh`.
- El legado `.pi` todavía se acepta en las claves de manifiesto de `package.json` (`pi.extensions`), pero no como raíz nativa aquí.

### 2) Rutas configuradas explícitamente

Después del auto-descubrimiento, las rutas configuradas se agregan y resuelven.

Fuentes de rutas configuradas en la ruta de inicio de sesión principal (`sdk.ts`):

1. Rutas proporcionadas por CLI (`--extension/-e`, y `--hook` también se trata como una ruta de extensión)
2. Array `extensions` de la configuración (configuración global + proyecto combinada)

Archivo de configuración global:

- `~/.xcsh/agent/config.yml` (o directorio de agente personalizado mediante `PI_CODING_AGENT_DIR`)

Archivo de configuración del proyecto:

- `<cwd>/.xcsh/settings.json`

Ejemplos:

```yaml
# ~/.xcsh/agent/config.yml
extensions:
  - ~/my-exts/safety.ts
  - ./local/ext-pack
```

```json
{
  "extensions": ["./.xcsh/extensions/my-extra"]
}
```

---

## Controles de habilitación/deshabilitación

### Deshabilitar descubrimiento

- CLI: `--no-extensions`
- Opción SDK: `disableExtensionDiscovery`

División de comportamiento:

- SDK: cuando `disableExtensionDiscovery=true`, aún carga `additionalExtensionPaths` mediante `loadExtensions()`.
- La construcción de rutas CLI (`main.ts`) actualmente limpia las rutas de extensión CLI cuando se establece `--no-extensions`, por lo que las opciones explícitas `-e/--hook` no se reenvían en ese modo.

### Deshabilitar módulos de extensión específicos

La configuración `disabledExtensions` filtra por formato de id de extensión:

- `extension-module:<derivedName>`

`derivedName` se basa en la ruta de entrada (`getExtensionNameFromPath`), por ejemplo:

- `/x/foo.ts` -> `foo`
- `/x/bar/index.ts` -> `bar`

Ejemplo:

```yaml
disabledExtensions:
  - extension-module:foo
```

---

## Resolución de rutas y entradas

### Normalización de rutas

Para rutas configuradas:

1. Normalizar espacios unicode
2. Expandir `~`
3. Si es relativa, resolver contra el `cwd` actual

### Si la ruta configurada es un archivo

Se utiliza directamente como candidato de entrada de módulo.

### Si la ruta configurada es un directorio

Orden de resolución:

1. `package.json` en ese directorio con `xcsh.extensions` (o legado `pi.extensions`) -> usar entradas declaradas
2. `index.ts`
3. `index.js`
4. En caso contrario, escanear un nivel en busca de entradas de extensión:
   - `*.ts` / `*.js` directos
   - subdirectorio `index.ts` / `index.js`
   - subdirectorio `package.json` con `xcsh.extensions` / `pi.extensions`

Reglas y restricciones:

- sin descubrimiento recursivo más allá de un nivel de subdirectorio
- las entradas de manifiesto `extensions` declaradas se resuelven relativamente a ese directorio de paquete
- las entradas declaradas se incluyen solo si el archivo existe/el acceso está permitido
- en pares `*/index.{ts,js}`, TypeScript se prefiere sobre JavaScript
- los enlaces simbólicos se tratan como archivos/directorios elegibles

### El comportamiento de ignorar difiere según la fuente

- El auto-descubrimiento nativo (`discoverExtensionModulePaths` en los helpers de descubrimiento) usa glob nativo con `gitignore: true` y `hidden: false`.
- El escaneo explícito de directorios configurados en `loader.ts` usa reglas de `readdir` y **no** aplica filtrado de gitignore.

---

## Orden de carga y precedencia

`discoverAndLoadExtensions()` construye una lista ordenada y luego llama a `loadExtensions()`.

Orden:

1. Módulos auto-descubiertos nativos
2. Rutas configuradas explícitamente (en el orden proporcionado)

En `sdk.ts`, el orden configurado es:

1. Rutas adicionales de CLI
2. `extensions` de la configuración

Deduplicación:

- basada en ruta absoluta
- la primera ruta encontrada tiene prioridad
- los duplicados posteriores se ignoran

Implicación: si la misma ruta de módulo está tanto auto-descubierta como configurada explícitamente, se carga una vez en la primera posición (etapa de auto-descubrimiento).

---

## Importación de módulos y contrato del factory

Cada ruta candidata se carga con importación dinámica:

- `await import(resolvedPath)`
- el factory es `module.default ?? module`
- el factory debe ser una función (`ExtensionFactory`)

Si la exportación no es una función, esa ruta falla con un error estructurado y la carga continúa.

---

## Manejo de fallos y aislamiento

### Durante la carga

Por cada ruta de extensión, los fallos se capturan como `{ path, error }` y no detienen la carga de otras rutas.

Casos comunes:

- fallo de importación / archivo faltante
- exportación de factory inválida (no es función)
- excepción lanzada durante la ejecución del factory

### Modelo de aislamiento en runtime

- Las extensiones **no están aisladas en sandbox** (mismo proceso/runtime).
- Comparten un `EventBus` y una instancia de `ExtensionRuntime`.
- Durante la carga, los métodos de acción del runtime lanzan intencionalmente `ExtensionRuntimeNotInitializedError`; la conexión de acciones ocurre después en `ExtensionRunner.initialize()`.

### Después de la carga

Cuando los eventos se ejecutan a través de `ExtensionRunner`, las excepciones de los handlers se capturan y se emiten como errores de extensión en lugar de hacer fallar el bucle del runner.

---

## Ejemplos mínimos de disposición de usuario/proyecto

### Nivel de usuario

```text
~/.xcsh/agent/
  config.yml
  extensions/
    guardrails.ts
    audit/
      index.ts
```

### Nivel de proyecto

```text
<repo>/
  .xcsh/
    settings.json
    extensions/
      checks/
        package.json
      lint-gates.ts
```

`checks/package.json`:

```json
{
  "xcsh": {
    "extensions": ["./src/check-a.ts", "./src/check-b.js"]
  }
}
```

Clave de manifiesto legada todavía aceptada:

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```
