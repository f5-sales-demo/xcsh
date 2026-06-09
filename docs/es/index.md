---
title: Documentación de xcsh
description: >-
  CLI de desarrollo impulsada por IA con agente de codificación TypeScript y
  capa nativa en Rust para sesiones de larga duración, soporte MCP y empaquetado
  multiplataforma.
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
empaquetado multiplataforma orientado a Linux, macOS y Windows.

## Por dónde empezar

- **[Contextos F5 XC](/runtime-tools/context-command)** — conéctese a tenants de F5 Distributed Cloud.
  Cree contextos, cambie entre ellos, gestione espacios de nombres y credenciales.
- **Configuración** — cómo xcsh descubre, resuelve y aplica capas de configuración.
- **Runtime y herramientas** — los runtimes de bash / notebook / resolve y la
  superficie de comandos con barra diagonal.
- **Sesiones** — registro de entradas de solo adición, navegación en árbol, compactación y el
  sistema de memoria autónoma.
- **Nativos (Rust)** — arquitectura del addon N-API `pi-natives` que
  potencia shell / PTY / multimedia / búsqueda.
- **MCP** — configuración, detalles internos del protocolo, ciclo de vida del runtime y cómo
  crear servidores y herramientas.
- **Extensiones, habilidades y plugins** — creación, carga, reglas de coincidencia, el
  marketplace y el instalador de plugins.
- **Proveedores y modelos** — configuración de modelos, detalles internos de streaming y el
  runtime de Python / IPython.
- **TUI** — temas, el comando `/tree` y hooks de integración para
  extensiones y herramientas personalizadas.

## Cómo está organizado este conjunto de documentación

Cada grupo de nivel superior en la barra lateral corresponde a un subsistema del agente. Dentro
de un grupo, las páginas van desde "descripción general" hasta "detalles internos", de modo que pueda dejar de leer
cuando tenga suficiente contexto para la tarea que tiene entre manos.
