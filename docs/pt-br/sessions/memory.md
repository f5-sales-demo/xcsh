---
title: Memória Autônoma
description: >-
  Sistema de memória autônoma para persistir preferências do usuário, contexto
  de projeto e feedback entre sessões.
sidebar:
  order: 7
  label: Memória autônoma
i18n:
  sourceHash: 2aa9f516aa1e
  translator: machine
---

# Memória Autônoma

Quando habilitado, o agente extrai automaticamente conhecimento durável de sessões anteriores e injeta um resumo compacto em cada nova sessão. Com o tempo, ele constrói um armazenamento de memória com escopo de projeto — decisões técnicas, fluxos de trabalho recorrentes, armadilhas — que se mantém sem esforço manual.

Desabilitado por padrão. Habilite via `/settings` ou `config.yml`:

```yaml
memories:
  enabled: true
```

## Uso

### O que é injetado

No início da sessão, se um resumo de memória existir para o projeto atual, ele é injetado no prompt do sistema como um bloco de **Memory Guidance**. O agente é instruído a:

- Tratar a memória como contexto heurístico — útil para processos e decisões anteriores, não como fonte autoritativa sobre o estado atual do repositório.
- Citar o caminho do artefato de memória quando a memória alterar o plano, e combiná-lo com evidências do repositório atual antes de agir.
- Preferir o estado do repositório e as instruções do usuário quando conflitarem com a memória; tratar memória conflitante como obsoleta.

### Lendo artefatos de memória

O agente pode ler arquivos de memória diretamente usando URLs `memory://` com a ferramenta `read`:

| URL | Conteúdo |
|---|---|
| `memory://root` | Resumo compacto injetado na inicialização |
| `memory://root/MEMORY.md` | Documento completo de memória de longo prazo |
| `memory://root/skills/<name>/SKILL.md` | Um playbook de habilidade gerado |

### Comando slash `/memory`

| Subcomando | Efeito |
|---|---|
| `view` | Mostra o payload de injeção de memória atual |
| `clear` / `reset` | Exclui todos os dados de memória e artefatos gerados |
| `enqueue` / `rebuild` | Força a consolidação a ser executada na próxima inicialização |

## Como funciona

As memórias são construídas por um pipeline em segundo plano que é executado na inicialização ou acionado manualmente via comando slash.

**Fase 1 — extração por sessão:** Para cada sessão passada que foi alterada desde o último processamento, um modelo lê o histórico da sessão e extrai sinais duráveis: decisões técnicas, restrições, falhas resolvidas, fluxos de trabalho recorrentes. Sessões muito recentes, muito antigas ou atualmente ativas são ignoradas. Cada extração produz um bloco de memória bruto e uma sinopse curta para aquela sessão.

**Fase 2 — consolidação:** Após a extração, uma segunda passagem do modelo lê todas as extrações por sessão e produz três saídas escritas em disco:

- `MEMORY.md` — um documento de memória de longo prazo curado
- `memory_summary.md` — o texto compacto injetado no início da sessão
- `skills/` — playbooks procedurais reutilizáveis, cada um em seu próprio subdiretório

A Fase 2 usa um lease para evitar execução dupla quando múltiplos processos iniciam simultaneamente. Diretórios de habilidades obsoletos de execuções anteriores são removidos automaticamente.

Toda saída é verificada em busca de segredos antes de ser escrita em disco.

### Comportamento de extração

O comportamento de extração e consolidação de memória é inteiramente orientado por arquivos de prompt estáticos em `src/prompts/memories/`.

| Arquivo | Propósito | Variáveis |
|---|---|---|
| `stage_one_system.md` | Prompt do sistema para extração por sessão | — |
| `stage_one_input.md` | Template de turno do usuário envolvendo o conteúdo da sessão | `{{thread_id}}`, `{{response_items_json}}` |
| `consolidation.md` | Prompt para consolidação entre sessões | `{{raw_memories}}`, `{{rollout_summaries}}` |
| `read_path.md` | Orientação de memória injetada em sessões ativas | `{{memory_summary}}` |

### Seleção de modelo

A memória utiliza o sistema de roles de modelo.

| Fase | Role | Propósito |
|---|---|---|
| Fase 1 (extração) | `default` | Extração de conhecimento por sessão |
| Fase 2 (consolidação) | `smol` | Síntese entre sessões |

Se `smol` não estiver configurado, a Fase 2 recorre ao role `default`.

## Configuração

| Configuração | Padrão | Descrição |
|---|---|---|
| `memories.enabled` | `false` | Chave principal |
| `memories.maxRolloutAgeDays` | `30` | Sessões mais antigas que este valor não são processadas |
| `memories.minRolloutIdleHours` | `12` | Sessões ativas mais recentemente que este valor são ignoradas |
| `memories.maxRolloutsPerStartup` | `64` | Limite de sessões processadas em uma única inicialização |
| `memories.summaryInjectionTokenLimit` | `5000` | Máximo de tokens do resumo injetado no prompt do sistema |

Ajustes adicionais (concorrência, durações de lease, orçamentos de tokens) estão disponíveis na configuração para uso avançado.

## Arquivos principais

- `src/memories/index.ts` — orquestração do pipeline, injeção, tratamento de comandos slash
- `src/memories/storage.ts` — fila de trabalhos e registro de threads com suporte a SQLite
- `src/prompts/memories/` — templates de prompts de memória
- `src/internal-urls/memory-protocol.ts` — handler de URLs `memory://`
