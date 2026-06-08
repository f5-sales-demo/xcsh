---
title: Ofuscación de Secretos
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

# Ofuscación de Secretos

Previene que valores sensibles (claves API, tokens, contraseñas) sean enviados a proveedores de LLM. Cuando está habilitado, los secretos se reemplazan con marcadores de posición deterministas antes de salir del proceso, y se restauran en los argumentos de llamadas a herramientas devueltos por el modelo.

## Habilitación

Habilitado por defecto. Puede alternarse a través de la interfaz `/settings` o directamente en `config.yml`:

```yaml
secrets:
  enabled: false
```

## Cómo funciona

1. Al iniciar la sesión, los secretos se recopilan de dos fuentes:
   - **Variables de entorno** que coinciden con patrones comunes de secretos (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, etc.) con valores >= 8 caracteres
   - **Archivos `secrets.yml`** (ver más abajo)

2. Los mensajes salientes al LLM tienen todos los valores secretos reemplazados con marcadores de posición como `<<$env:S0>>`, `<<$env:S1>>`, etc.

3. Los argumentos de llamadas a herramientas devueltos por el modelo se recorren en profundidad y los marcadores de posición se restauran a los valores originales antes de la ejecución.

Dos modos controlan lo que sucede con cada secreto:

| Modo | Comportamiento | Reversible |
|---|---|---|
| `obfuscate` (predeterminado) | Reemplazado con marcador de posición indexado `<<$env:SN>>` | Sí (desofuscado en argumentos de herramientas) |
| `replace` | Reemplazado con cadena determinista de la misma longitud | No (unidireccional) |

## secrets.yml

Defina entradas de secretos personalizadas en YAML. Se verifican dos ubicaciones:

| Nivel | Ruta | Propósito |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Secretos compartidos entre todos los proyectos |
| Proyecto | `<cwd>/.xcsh/secrets.yml` | Secretos específicos del proyecto |

Las entradas de proyecto sobrescriben las entradas globales con `content` coincidente.

### Esquema

Cada entrada en el arreglo tiene estos campos:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `type` | `"plain"` o `"regex"` | Sí | Estrategia de coincidencia |
| `content` | string | Sí | El valor secreto (plain) o patrón regex (regex) |
| `mode` | `"obfuscate"` o `"replace"` | No | Predeterminado: `"obfuscate"` |
| `replacement` | string | No | Reemplazo personalizado (solo modo replace) |
| `flags` | string | No | Banderas regex (solo tipo regex) |

### Ejemplos

#### Secretos de texto plano

```yaml
# Obfuscar una clave API específica (modo predeterminado)
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
# Obfuscar cualquier clave de estilo AWS
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

Las entradas regex siempre escanean globalmente (la bandera `g` se aplica automáticamente). La sintaxis literal de regex `/patrón/banderas` es compatible como alternativa a los campos separados `content` + `flags`. Las barras escapadas dentro del patrón (`\\/`) se manejan correctamente.

#### Modo replace con regex

```yaml
# Reemplazo unidireccional de cadenas de conexión (no reversible)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interacción con la detección de variables de entorno

Las variables de entorno siempre se recopilan primero. Las entradas definidas en archivos se agregan después, por lo que las entradas de archivo pueden cubrir secretos que no están en variables de entorno (archivos de configuración, valores codificados directamente, etc.). Si el mismo valor aparece en ambos, el modo de la entrada del archivo tiene precedencia.

## Archivos clave

- `src/secrets/index.ts` -- carga, fusión, recopilación de variables de entorno
- `src/secrets/obfuscator.ts` -- clase `SecretObfuscator`, generación de marcadores de posición, ofuscación de mensajes
- `src/secrets/regex.ts` -- análisis y compilación de literales regex
- `src/config/settings-schema.ts` -- definición de la configuración `secrets.enabled`
