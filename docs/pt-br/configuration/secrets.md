---
title: Ofuscação de Segredos
description: >-
  Pipeline de ofuscação de segredos que redige valores sensíveis dos logs de
  sessão e saídas.
sidebar:
  order: 3
  label: Segredos
i18n:
  sourceHash: 1d9dc101c614
  translator: machine
---

# Ofuscação de Segredos

Previne que valores sensíveis (chaves de API, tokens, senhas) sejam enviados para provedores de LLM. Quando habilitado, os segredos são substituídos por placeholders determinísticos antes de saírem do processo, e restaurados nos argumentos de chamadas de ferramentas retornados pelo modelo.

## Habilitando

Habilitado por padrão. Alterne via a interface `/settings` ou diretamente no `config.yml`:

```yaml
secrets:
  enabled: false
```

## Como funciona

1. Na inicialização da sessão, os segredos são coletados de duas fontes:
   - **Variáveis de ambiente** que correspondem a padrões comuns de segredos (`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, etc.) com valores >= 8 caracteres
   - **Arquivos `secrets.yml`** (veja abaixo)

2. Mensagens enviadas ao LLM têm todos os valores de segredos substituídos por placeholders como `<<$env:S0>>`, `<<$env:S1>>`, etc.

3. Argumentos de chamadas de ferramentas retornados pelo modelo são percorridos em profundidade e os placeholders são restaurados para os valores originais antes da execução.

Dois modos controlam o que acontece com cada segredo:

| Modo | Comportamento | Reversível |
|---|---|---|
| `obfuscate` (padrão) | Substituído por placeholder indexado `<<$env:SN>>` | Sim (desofuscado nos argumentos de ferramentas) |
| `replace` | Substituído por string determinística de mesmo comprimento | Não (unidirecional) |

## secrets.yml

Defina entradas de segredos personalizados em YAML. Dois locais são verificados:

| Nível | Caminho | Propósito |
|---|---|---|
| Global | `~/.xcsh/agent/secrets.yml` | Segredos para todos os projetos |
| Projeto | `<cwd>/.xcsh/secrets.yml` | Segredos específicos do projeto |

Entradas de projeto sobrescrevem entradas globais com `content` correspondente.

### Esquema

Cada entrada no array possui estes campos:

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `type` | `"plain"` ou `"regex"` | Sim | Estratégia de correspondência |
| `content` | string | Sim | O valor do segredo (plain) ou padrão regex (regex) |
| `mode` | `"obfuscate"` ou `"replace"` | Não | Padrão: `"obfuscate"` |
| `replacement` | string | Não | Substituição personalizada (somente modo replace) |
| `flags` | string | Não | Flags de regex (somente tipo regex) |

### Exemplos

#### Segredos simples (plain)

```yaml
# Obfuscar uma chave de API específica (modo padrão)
- type: plain
  content: sk-proj-abc123def456

# Substituir uma senha de banco de dados por uma string fixa
- type: plain
  content: hunter2
  mode: replace
  replacement: "********"
```

#### Segredos com regex

```yaml
# Obfuscar qualquer chave no estilo AWS
- type: regex
  content: "AKIA[0-9A-Z]{16}"

# Correspondência sem distinção de maiúsculas/minúsculas com flags explícitas
- type: regex
  content: "api[_-]?key\\s*=\\s*\\w+"
  flags: "i"

# Sintaxe de literal regex (padrão e flags em uma única string)
- type: regex
  content: "/bearer\\s+[a-zA-Z0-9._~+\\/=-]+/i"
```

Entradas regex sempre fazem varredura global (a flag `g` é aplicada automaticamente). A sintaxe de literal regex `/padrão/flags` é suportada como alternativa aos campos separados `content` + `flags`. Barras escapadas dentro do padrão (`\\/`) são tratadas corretamente.

#### Modo replace com regex

```yaml
# Substituição unidirecional de strings de conexão (não reversível)
- type: regex
  content: "postgres://[^\\s]+"
  mode: replace
  replacement: "postgres://***"
```

## Interação com detecção de variáveis de ambiente

Variáveis de ambiente são sempre coletadas primeiro. Entradas definidas em arquivo são adicionadas depois, de modo que entradas de arquivo podem cobrir segredos que não existem em variáveis de ambiente (arquivos de configuração, valores hardcoded, etc.). Se o mesmo valor aparecer em ambos, o modo da entrada do arquivo tem precedência.

## Arquivos principais

- `src/secrets/index.ts` -- carregamento, mesclagem, coleta de variáveis de ambiente
- `src/secrets/obfuscator.ts` -- classe `SecretObfuscator`, geração de placeholders, ofuscação de mensagens
- `src/secrets/regex.ts` -- análise e compilação de literais regex
- `src/config/settings-schema.ts` -- definição da configuração `secrets.enabled`
