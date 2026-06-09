---
title: Ofuscación de secretos
description: >-
  Pipeline de ofuscación de secretos que redacta valores sensibles de los
  registros de sesión y las salidas.
sidebar:
  order: 3
  label: Secretos
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Ofuscación de secretos

Evita que valores sensibles (claves API, tokens, contraseñas) sean enviados a los proveedores de LLM. Cuando está habilitado, los secretos son reemplazados con marcadores determinísticos antes de salir del proceso, y se restauran en los argumentos de llamadas a herramientas devueltos por el modelo.

## Habilitación

Habilitado por defecto. Puede alternarse mediante la interfaz `/settings` o directamente en `config.yml`:

```yaml
secrets:
  enabled: false
```

## Cómo funciona

1. Al iniciar la sesión, los secretos se recopilan de dos fuentes:
   - **Variables de entorno** que coinciden con patrones comunes de secretos (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, etc.) con valores de >= 8 caracteres
   - **Archivos `secrets.yml`** (ver más abajo)

2. Los mensajes salientes al LLM tienen todos los valores secretos reemplazados con marcadores como `<<$env:S0>>`, `<<$env:S1>>`, etc.

3. Los argumentos de llamadas a herramientas devueltos por el modelo se recorren en profundidad y los marcadores se restauran a sus valores originales antes de la ejecución.

Dos modos controlan lo que sucede con cada secreto:

| Modo | Comportamiento | Reversible |
|---|---|---|
| `obfuscate` (por defecto) | Reemplazado con marcador indexado `<<$env:SN>>` | Sí (desofuscado en argumentos de herramientas) |
| `replace` | Reemplazado con cadena determinística de la misma longitud | No (unidireccional) |

## secrets.yml

Define entradas de secretos personalizadas en YAML. Se verifican dos ubicaciones:

| Nivel | Ruta | Propósito |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Secretos en todos los proyectos |
| Proyecto | `<cwd>/.xcsh/secrets.yml` | Secretos específicos del proyecto |

Las entradas de proyecto sobreescriben las entradas globales con `content` coincidente.

### Esquema

Cada entrada en el array tiene estos campos:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `type` | `"plain"` o `"regex"` | Sí | Estrategia de coincidencia |
| `content` | string | Sí | El valor del secreto (plain) o patrón regex (regex) |
| `mode` | `"obfuscate"` o `"replace"` | No | Por defecto: `"obfuscate"` |
| `replacement` | string | No | Reemplazo personalizado (solo modo replace) |
| `flags` | string | No | Banderas de regex (solo tipo regex) |

### Ejemplos

#### Secretos de texto plano

```yaml
# Ofuscar una clave API específica (modo por defecto)
- type: plain
  content: sk-proj-abc123def456

# Reemplazar una contraseña de base de datos con una cadena fija
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Secretos con regex

```yaml
# Ofuscar cualquier clave de estilo AWS
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Coincidencia insensible a mayúsculas con banderas explícitas
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Sintaxis literal de regex (patrón y banderas en una sola cadena)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Las entradas regex siempre escanean globalmente (la bandera `g` se aplica automáticamente). La sintaxis literal de regex `/patrón/banderas` se admite como alternativa a los campos separados `content` + `flags`. Las barras escapadas dentro del patrón (`\\/`) se manejan correctamente.

#### Modo replace con regex

```yaml
# Reemplazo unidireccional de cadenas de conexión (no reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interacción con la detección de variables de entorno

Las variables de entorno siempre se recopilan primero. Las entradas definidas en archivos se agregan después, de modo que las entradas de archivo pueden cubrir secretos que no están en variables de entorno (archivos de configuración, valores hardcodeados, etc.). Si el mismo valor aparece en ambos, el modo de la entrada del archivo tiene precedencia.

## Archivos clave

- `src/secrets/index.ts` -- carga, fusión, recopilación de variables de entorno
- `src/secrets/obfuscator.ts` -- clase `SecretObfuscator`, generación de marcadores, ofuscación de mensajes
- `src/secrets/regex.ts` -- análisis y compilación de literales regex
- `src/config/settings-schema.ts` -- definición del ajuste `secrets.enabled`
