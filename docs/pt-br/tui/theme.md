---
title: Referência de Temas
description: >-
  Referência de temas TUI com tokens de cor, configurações de fonte e
  personalização de temas.
sidebar:
  order: 3
  label: Temas
i18n:
  sourceHash: 7e962a7da157
  translator: machine
---

# Referência de Temas

Este documento descreve como o sistema de temas funciona no agente de codificação atualmente: esquema, carregamento, comportamento em tempo de execução e modos de falha.

## O que o sistema de temas controla

O sistema de temas gerencia:

- tokens de cor de primeiro plano/segundo plano utilizados em toda a TUI
- adaptadores de estilo markdown (`getMarkdownTheme()`)
- adaptadores de seletor/editor/lista de configurações (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- preset de símbolos + substituições de símbolos (`unicode`, `nerd`, `ascii`)
- cores de realce de sintaxe utilizadas pelo realçador nativo (`@f5-sales-demo/pi-natives`)
- cores dos segmentos da linha de status

Implementação principal: `src/modes/theme/theme.ts`.

## Estrutura do JSON de tema

Os arquivos de tema são objetos JSON validados contra o esquema em tempo de execução em `theme.ts` (`ThemeJsonSchema`) e espelhados por `src/modes/theme/theme-schema.json`.

Campos de nível superior:

- `name` (obrigatório)
- `colors` (obrigatório; todos os tokens de cor são obrigatórios)
- `vars` (opcional; variáveis de cor reutilizáveis)
- `export` (opcional; cores para exportação HTML)
- `symbols` (opcional)
  - `preset` (opcional: `unicode | nerd | ascii`)
  - `overrides` (opcional: substituições de chave/valor para `SymbolKey`)

Os valores de cor aceitam:

- string hexadecimal (`"#RRGGBB"`)
- índice de 256 cores (`0..255`)
- string de referência a variável (resolvida através de `vars`)
- string vazia (`""`) significando padrão do terminal (`\x1b[39m` fg, `\x1b[49m` bg)

## Tokens de cor obrigatórios (atual)

Todos os tokens abaixo são obrigatórios em `colors`.

### Texto principal e bordas (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### Blocos de fundo (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### Texto de mensagem/ferramenta (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Diff de ferramenta + realce de sintaxe (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### Bordas de modo/pensamento (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### Cores dos segmentos da linha de status (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## Tokens opcionais

### Seção `export` (opcional)

Utilizada para auxiliares de temas na exportação HTML:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

Se omitida, o código de exportação deriva os valores padrão a partir das cores do tema resolvidas.

### Seção `symbols` (opcional)

- `symbols.preset` define um conjunto de símbolos padrão no nível do tema.
- `symbols.overrides` pode substituir valores individuais de `SymbolKey`.

Precedência em tempo de execução:

1. substituição `symbolPreset` nas configurações (se definida)
2. `symbols.preset` no JSON do tema
3. fallback `"unicode"`

Chaves de substituição inválidas são ignoradas e registradas em log (`logger.debug`).

## Fontes de temas integrados vs. personalizados

Ordem de busca de temas (`loadThemeJson`):

1. temas integrados embutidos (`defaults/xcsh-dark.json` e `defaults/xcsh-light.json` compilados em `defaultThemes`)
2. arquivo de tema personalizado: `<customThemesDir>/<name>.json`

O diretório de temas personalizados vem de `getCustomThemesDir()`:

- padrão: `~/.xcsh/agent/themes`
- substituído por `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` retorna os nomes integrados + personalizados mesclados, ordenados, com os integrados tendo precedência em caso de colisão de nomes.

## Carregamento, validação e resolução

Para arquivos de tema personalizados:

1. leitura do JSON
2. análise do JSON
3. validação contra `ThemeJsonSchema`
4. resolução recursiva de referências em `vars`
5. conversão dos valores resolvidos para ANSI de acordo com o modo de capacidade do terminal

Comportamento de validação:

- tokens de cor obrigatórios ausentes: mensagem de erro explícita agrupada
- tipos/valores de token incorretos: erros de validação com caminho JSON
- arquivo de tema desconhecido: `Theme not found: <name>`

Comportamento de referência a variáveis:

- suporta referências aninhadas
- lança exceção em referência a variável inexistente
- lança exceção em referências circulares

## Comportamento do modo de cores do terminal

Detecção do modo de cores (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => truecolor
- `WT_SESSION` => truecolor
- `TERM` em `dumb`, `linux`, ou vazio => 256color
- caso contrário => truecolor

Comportamento de conversão:

- hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- numérico -> ANSI `38;5` / `48;5`
- `""` -> redefinição padrão de fg/bg

## Comportamento de alternância em tempo de execução

### Tema inicial (`initTheme`)

`main.ts` inicializa o tema com as configurações:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

A seleção automática do slot de tema utiliza a detecção de fundo por `COLORFGBG`:

- analisa o índice de fundo a partir de `COLORFGBG`
- `< 8` => slot escuro (`theme.dark`)
- `>= 8` => slot claro (`theme.light`)
- falha na análise => slot escuro

Padrões atuais do esquema de configurações:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### Alternância explícita (`setTheme`)

- carrega o tema selecionado
- atualiza o singleton global `theme`
- opcionalmente inicia o observador de arquivos
- aciona o callback `onThemeChange`

Em caso de falha:

- reverte para o tema integrado `dark`
- retorna `{ success: false, error }`

### Alternância de pré-visualização (`previewTheme`)

- aplica o tema de pré-visualização temporário ao `theme` global
- **não** altera as configurações persistidas por si só
- retorna sucesso/erro sem substituição por fallback

A interface de configurações utiliza isso para pré-visualização ao vivo e restaura o tema anterior ao cancelar.

## Observadores e recarga ao vivo

Quando o observador está habilitado (`setTheme(..., true)` / inicialização interativa):

- observa apenas o caminho de arquivo personalizado `<customThemesDir>/<currentTheme>.json`
- os temas integrados efetivamente não são observados
- evento `change` no arquivo: tenta recarregar (com debounce)
- evento `rename`/exclusão no arquivo: reverte para `dark`, fecha o observador

O modo automático também instala um listener para `SIGWINCH` e pode reavaliar o mapeamento de slots escuro/claro quando o estado do terminal muda.

## Comportamento do modo para daltonismo

`colorBlindMode` altera apenas um token em tempo de execução:

- `toolDiffAdded` é ajustado em HSV (verde deslocado em direção ao azul)
- o ajuste é aplicado somente quando o valor resolvido é uma string hexadecimal

Os demais tokens permanecem inalterados.

## Onde as configurações de tema são persistidas

As configurações relacionadas ao tema são persistidas pelo `Settings` no YAML de configuração global:

- caminho: `<agentDir>/config.yml`
- diretório padrão do agente: `~/.xcsh/agent`
- arquivo padrão efetivo: `~/.xcsh/agent/config.yml`

Chaves persistidas:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

Existe migração legada: o antigo `theme: "name"` simples é migrado para `theme.dark` ou `theme.light` aninhado com base na detecção de luminância.

## Criando um tema personalizado (prático)

1. Crie o arquivo no diretório de temas personalizados, por exemplo, `~/.xcsh/agent/themes/my-theme.json`.
2. Inclua `name`, `vars` opcional e **todos** os tokens obrigatórios em `colors`.
3. Opcionalmente, inclua `symbols` e `export`.
4. Selecione o tema em Configurações (`Display -> Dark theme` ou `Display -> Light theme`) dependendo de qual slot automático você deseja.

Esqueleto mínimo. Cada chave em `colors` é obrigatória — o validador em tempo de execução
(`additionalProperties: false`) rejeita tanto chaves ausentes quanto chaves desconhecidas.
Para as implementações de referência fornecidas, consulte
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
e [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

A linha de status possui dois sistemas de cor paralelos documentados na issue #242:

- Cores de texto em hexadecimal (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) controlam a renderização sem powerline.
- Índices de paleta de 256 cores (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  controlam o preenchimento dos segmentos powerline. Eles são independentes das chaves hexadecimais acima —
  ambos devem ser definidos.

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileXcshBg": "accent",
    "statusLineProfileXcshFg": 231
  }
}
```

## Testando temas personalizados

Utilize este fluxo de trabalho:

1. Inicie o modo interativo (observador habilitado desde a inicialização).
2. Abra as configurações e pré-visualize os valores do tema (`previewTheme` ao vivo).
3. Para arquivos de tema personalizados, edite o JSON durante a execução e confirme o recarregamento automático ao salvar.
4. Teste as superfícies críticas:
   - renderização de markdown
   - blocos de ferramentas (pendente/sucesso/erro)
   - renderização de diff (adicionado/removido/contexto)
   - legibilidade da linha de status
   - mudanças nas bordas do nível de pensamento
   - cores de borda nos modos bash/python
5. Valide ambos os presets de símbolos se o seu tema depender da largura/aparência dos glifos.

## Restrições e ressalvas reais

- Todos os tokens de `colors` são obrigatórios para temas personalizados.
- `export` e `symbols` são opcionais.
- `$schema` no JSON do tema é informativo; a validação em tempo de execução é aplicada pelo esquema TypeBox compilado no código.
- A falha de `setTheme` reverte para `dark`; a falha de `previewTheme` não substitui o tema atual.
- Erros de recarga do observador de arquivos mantêm o tema atualmente carregado até que um recarregamento bem-sucedido ocorra ou o caminho de fallback seja acionado.
