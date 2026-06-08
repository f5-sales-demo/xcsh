---
title: Documentación de xcsh
description: >-
  CLI de desarrollo impulsada por IA con agente de codificación TypeScript y
  capa nativa en Rust para sesiones de larga duración, soporte MCP y empaquetado
  de plataforma.
sidebar:
  order: 0
  label: Descripción general
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh es una CLI de desarrollo impulsada por IA con un agente de codificación en TypeScript y una
capa nativa en Rust (`pi-natives`). Extiende la línea de código abierto
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) con un
runtime reforzado, sesiones de larga duración con navegación en árbol y compactación,
una herramienta Python IPython, soporte completo de MCP, un sistema de habilidades y
empaquetado de plataforma dirigido a Linux, macOS y Windows.

## Por dónde empezar

- **[Contextos F5 XC](/runtime-tools/context-command)** — conectarse a tenants de F5 Distributed Cloud.
  Crear contextos, alternar entre ellos, gestionar espacios de nombres y credenciales.
- **Configuración** — cómo xcsh descubre, resuelve y organiza por capas la configuración.
- **Runtime y herramientas** — los runtimes de bash / notebook / herramienta resolve y la
  superficie de comandos con barra diagonal.
- **Sesiones** — registro de entradas de solo adición, navegación en árbol, compactación y el
  sistema de memoria autónomo.
- **Nativos (Rust)** — arquitectura del addon N-API `pi-natives` que
  potencia shell / PTY / media / búsqueda.
- **MCP** — configuración, aspectos internos del protocolo, ciclo de vida del runtime y cómo
  crear servidores y herramientas.
- **Extensiones, habilidades y plugins** — autoría, carga, reglas de coincidencia, el
  marketplace y el instalador de plugins.
- **Proveedores y modelos** — configuración de modelos, aspectos internos del streaming y el
  runtime de Python / IPython.
- **TUI** — temas, el comando `/tree` y hooks de integración para
  extensiones y herramientas personalizadas.

## Cómo está organizado este conjunto de documentación

Cada grupo de nivel superior en la barra lateral corresponde a un subsistema del agente. Dentro
de un grupo, las páginas van desde "descripción general" hasta "aspectos internos", de modo que pueda dejar de leer
cuando tenga suficiente contexto para la tarea que tiene entre manos.
