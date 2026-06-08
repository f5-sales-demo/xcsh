---
title: Contextos de F5 XC
description: >-
  Conecte xcsh a tenants de F5 Distributed Cloud -- cree, cambie y administre
  contextos de autenticación.
sidebar:
  order: 1
  label: Contextos de F5 XC
i18n:
  sourceHash: bdaf0fb8837c
  translator: machine
---

# Contextos de F5 XC

xcsh se conecta a F5 Distributed Cloud a través de **contextos** -- conjuntos de credenciales con nombre que vinculan una URL de tenant, un token de API y un namespace. Si ha utilizado `kubectl config use-context` o `kubectx`, el flujo de trabajo es idéntico: cree un contexto, cambie entre ellos por nombre y use `-` para volver al anterior.

## Primeros pasos

### 1. Cree su primer contexto

Necesita tres elementos de su consola de F5 XC: la URL del tenant, un token de API y, opcionalmente, un namespace.

```
/context create production https://acme.console.ves.volterra.io p12k3-your-api-token
```

```
Context 'production' created. Use /context activate production to switch to it.
```

O utilice el asistente guiado si prefiere indicaciones paso a paso:

```
/context wizard
```

### 2. Actívelo

```
/context production
```

```
╭─ production ─────────────────────────────────────────────────╮
│ F5XC_TENANT     acme                                         │
│ F5XC_API_URL    https://acme.console.ves.volterra.io         │
│ F5XC_API_TOKEN  ...oken                                      │
│ Status          Connected (312ms)                            │
├─ Environment ────────────────────────────────────────────────┤
│ F5XC_NAMESPACE  default                                      │
╰──────────────────────────────────────────────────────────────╯
```

Una vez activado, xcsh inyecta las credenciales del tenant en su sesión. El agente ahora puede realizar llamadas a la API de F5 XC, y la línea de estado muestra el contexto activo.

### 3. Agregue más contextos y cambie entre ellos

```
/context create staging https://staging.console.ves.volterra.io p12k3-staging-token
```

Cambie por nombre -- no se necesita un verbo de subcomando:

```
/context staging
```

Vuelva al contexto anterior (estilo `cd -`):

```
/context -
```

Llamar a `/context -` dos veces le devuelve al punto de partida.

### 4. Vea lo que tiene

```
/context
```

```
  production           https://acme.console.ves.volterra.io
* staging              https://staging.console.ves.volterra.io
```

El `*` marca el contexto activo.

## Comandos cotidianos

| Comando | Qué hace |
|---|---|
| `/context` | Listar todos los contextos |
| `/context <name>` | Cambiar a un contexto |
| `/context -` | Cambiar al contexto anterior |
| `/context show` | Mostrar detalles del contexto activo (tokens enmascarados) |
| `/context status` | Mostrar el estado de autenticación actual |

## Ciclo de vida del contexto

| Comando | Qué hace |
|---|---|
| `/context create <name> <url> <token> [namespace]` | Crear un contexto |
| `/context delete <name> --confirm` | Eliminar un contexto (requiere `--confirm`) |
| `/context rename <old> <new>` | Renombrar un contexto |
| `/context validate <name>` | Probar credenciales sin cambiar de contexto |
| `/context export [name] [--include-token]` | Exportar como JSON (tokens enmascarados por defecto) |
| `/context import <path-or-json> [--overwrite]` | Importar desde archivo o JSON en línea |
| `/context wizard` | Configuración interactiva guiada |

## Cambio de namespaces

Cada contexto tiene un namespace predeterminado. Cámbielo sin modificar el contexto:

```
/context namespace system
```

El autocompletado con Tab ofrece nombres de namespace del tenant activo.

## Variables de entorno en contextos

Los contextos pueden llevar variables de entorno adicionales que se inyectan en su sesión al activarse. Útil para configuraciones por tenant que no forman parte del conjunto de credenciales.

```
/context set CUSTOM_HEADER=x-acme-trace
/context set LOG_LEVEL=debug
/context env list
/context unset LOG_LEVEL
```

Alias: `add` = `set`, `remove`/`clear` = `unset`.

## Autocompletado con Tab

Escriba `/context ` y presione Tab. El menú desplegable muestra:

1. **Nombres de contexto** -- con indicaciones de URL del tenant, para que pueda distinguir los tenants
2. **`-`** -- aparece cuando ha cambiado anteriormente, muestra a qué contexto volvería
3. **Subcomandos** -- `list`, `create`, `delete`, etc.

Los nombres de contexto aparecen primero porque cambiar de contexto es la acción más común.

Los autocompletados a nivel de subcomando también funcionan: `/context activate <Tab>` completa nombres de contexto, `/context namespace <Tab>` completa namespaces, `/context unset <Tab>` completa claves de variables de entorno conocidas.

## Reglas de nomenclatura

Los nombres de contexto deben tener entre 1 y 64 caracteres: letras, dígitos, guiones y guiones bajos.

Los nombres que colisionan con subcomandos son rechazados:

```
/context create list https://example.com tok
```

```
Error: Context name 'list' conflicts with a /context subcommand. Choose a different name.
```

El conjunto completo de palabras reservadas: `list`, `show`, `status`, `create`, `delete`, `rename`, `namespace`, `env`, `set`, `unset`, `add`, `remove`, `clear`, `activate`, `validate`, `export`, `import`, `wizard`, `help`. La comparación no distingue entre mayúsculas y minúsculas.

## Sobreescritura por variables de entorno

Si `F5XC_API_URL` y `F5XC_API_TOKEN` están configuradas en el entorno de su shell antes de iniciar xcsh, tienen prioridad sobre cualquier contexto. Esto es útil para pipelines de CI/CD o sesiones puntuales en las que no desea crear un contexto persistente.

Cuando se ejecuta en este modo, `/context` muestra las credenciales obtenidas del entorno con una etiqueta `(via env vars)`.

## Comportamiento del contexto anterior

- **Alcance de sesión**: el contexto anterior se restablece cuando reinicia xcsh. No se persiste en disco.
- **Ping-pong**: `/context -` dos veces le devuelve al punto de partida.
- **Seguro ante mutaciones**: si elimina el contexto anterior, el puntero se limpia. Si lo renombra, el puntero sigue al nuevo nombre.
- **La reactivación es un no-op**: `/context production` cuando ya está en `production` no restablece el puntero anterior.

## Convenciones de diseño

La experiencia de usuario de `/context` sigue:

- **kubectx**: `kubectx <name>` para cambiar, `kubectx -` para el anterior, `kubectx` sin argumentos para listar
- **kubectl**: `kubectl config use-context` para la forma explícita
- **Shell**: `cd -` / `OLDPWD` para el seguimiento del directorio anterior
