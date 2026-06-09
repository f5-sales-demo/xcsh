---
title: Documentação do xcsh
description: >-
  CLI de desenvolvimento com IA, agente de codificação TypeScript e camada
  nativa Rust para sessões de longa duração, suporte a MCP e empacotamento de
  plataforma.
sidebar:
  order: 0
  label: Visão Geral
i18n:
  sourceHash: b9288f42bf46
  translator: machine
---

xcsh é uma CLI de desenvolvimento com IA, com um agente de codificação TypeScript e uma
camada nativa Rust (`pi-natives`). Ele estende a linha open-source
[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) com um
runtime reforçado, sessões de longa duração com navegação em árvore e compactação,
uma ferramenta Python IPython, suporte completo a MCP, um sistema de skills e
empacotamento de plataforma para Linux, macOS e Windows.

## Por onde começar

- **[Contextos F5 XC](/runtime-tools/context-command)** — conecte-se a tenants do F5 Distributed Cloud.
  Crie contextos, alterne entre eles, gerencie namespaces e credenciais.
- **Configuração** — como o xcsh descobre, resolve e organiza configurações em camadas.
- **Runtime e Ferramentas** — os runtimes bash / notebook / resolve tool e a
  superfície de comandos slash.
- **Sessões** — log de entradas append-only, navegação em árvore, compactação e o
  sistema de memória autônoma.
- **Nativos (Rust)** — arquitetura do addon N-API `pi-natives` que
  alimenta shell / PTY / mídia / busca.
- **MCP** — configuração, internos do protocolo, ciclo de vida do runtime e como
  criar servidores e ferramentas.
- **Extensões, Skills e Plugins** — criação, carregamento, regras de correspondência, o
  marketplace e o instalador de plugins.
- **Provedores e Modelos** — configuração de modelos, internos de streaming e o
  runtime Python / IPython.
- **TUI** — temas, o comando `/tree` e hooks de integração para
  extensões e ferramentas personalizadas.

## Como esta documentação está organizada

Cada grupo de nível superior na barra lateral corresponde a um subsistema do agente. Dentro
de um grupo, as páginas vão de "visão geral" a "internos", para que você possa parar de ler
quando tiver contexto suficiente para a tarefa em questão.
