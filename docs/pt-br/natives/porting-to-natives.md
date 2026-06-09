---
title: Portando para pi-natives (N-API) — Notas de Campo
description: >-
  Notas de campo para migrar código de child_process e shell do Node.js para a
  camada nativa Rust N-API.
sidebar:
  order: 9
  label: Portando para pi-natives
i18n:
  sourceHash: 4f5150286535
  translator: machine
---

# Portando para pi-natives (N-API) — Notas de Campo

Este é um guia prático para mover caminhos críticos para `crates/pi-natives` e conectá-los através dos bindings JS. Ele existe para evitar que as mesmas falhas aconteçam duas vezes.

## Quando portar

Porte quando qualquer uma dessas condições for verdadeira:

- O caminho crítico executa em loops de renderização, atualizações de UI frequentes ou grandes lotes.
- Alocações JS dominam (rotatividade de strings, backtracking de regex, arrays grandes).
- Você já tem uma baseline JS e pode fazer benchmark de ambas as versões lado a lado.
- O trabalho é limitado por CPU ou I/O bloqueante que pode rodar no thread pool do libuv.
- O trabalho é I/O assíncrono que pode rodar no runtime do Tokio (ex.: execução de shell).

Evite portar o que depende de estado exclusivo do JS ou imports dinâmicos. Exports N-API devem ser puros, dados-entram/dados-saem. Trabalhos de longa duração devem passar por `task::blocking` (limitado por CPU/I/O bloqueante) ou `task::future` (I/O assíncrono) com cancelamento.

## Anatomia de um export nativo

**Lado Rust:**

- A implementação fica em `crates/pi-natives/src/<module>.rs`. Se você adicionar um novo módulo, registre-o em `crates/pi-natives/src/lib.rs`.
- Exporte com `#[napi]`; exports em snake_case são convertidos para camelCase automaticamente. Use `js_name` explícito apenas para aliases verdadeiros/nomes não padrão. Use `#[napi(object)]` para structs.
- Use `task::blocking(tag, cancel_token, work)` (veja `crates/pi-natives/src/task.rs`) para trabalho limitado por CPU ou bloqueante. Use `task::future(env, tag, work)` para trabalho assíncrono que precisa do Tokio (ex.: sessões de shell). Passe um `CancelToken` quando você expor `timeoutMs` ou `AbortSignal`.

**Lado JS:**

- `packages/natives/src/bindings.ts` contém a interface base `NativeBindings`.
- `packages/natives/src/<module>/types.ts` define tipos TS e aumenta `NativeBindings` via declaration merging.
- `packages/natives/src/native.ts` importa cada arquivo `<module>/types.ts` para ativar as declarações.
- `packages/natives/src/<module>/index.ts` encapsula o binding `native` de `packages/natives/src/native.ts`.
- `packages/natives/src/native.ts` carrega o addon e `validateNative` valida os exports obrigatórios.
- `packages/natives/src/index.ts` re-exporta o wrapper para chamadores em `packages/*`.

## Checklist de portabilidade

1. **Adicione a implementação Rust**

- Coloque a lógica principal em uma função Rust pura.
- Se for um novo módulo, adicione-o em `crates/pi-natives/src/lib.rs`.
- Exponha com `#[napi]` para que o mapeamento padrão snake_case -> camelCase permaneça consistente.
- Mantenha assinaturas owned e simples: `String`, `Vec<String>`, `Uint8Array`, ou `Either<JsString, Uint8Array>` para entradas grandes de string/bytes.
- Para trabalho limitado por CPU ou bloqueante, use `task::blocking`; para trabalho assíncrono, use `task::future`. Passe um `CancelToken` e chame `heartbeat()` dentro de loops longos.

2. **Conecte os bindings JS**

- Adicione os tipos e o augmentation de `NativeBindings` em `packages/natives/src/<module>/types.ts`.
- Importe `./<module>/types` em `packages/natives/src/native.ts` para acionar o declaration merging.
- Adicione um wrapper em `packages/natives/src/<module>/index.ts` que chama `native`.
- Re-exporte de `packages/natives/src/index.ts`.

3. **Atualize a validação nativa**

- Adicione `checkFn("newExport")` em `validateNative` (`packages/natives/src/native.ts`).

4. **Adicione benchmarks**

- Coloque benchmarks junto ao pacote proprietário (`packages/tui/bench`, `packages/natives/bench`, ou `packages/coding-agent/bench`).
- Inclua uma baseline JS e a versão nativa na mesma execução.
- Use `Bun.nanoseconds()` e uma contagem fixa de iterações.
- Mantenha as entradas do benchmark pequenas e realistas (dados reais vistos no caminho crítico).

5. **Compile o binário nativo**

- `bun --cwd=packages/natives run build`
- Use `bun --cwd=packages/natives run build` e defina `PI_DEV=1` se você quiser diagnósticos do loader durante os testes.

6. **Execute o benchmark**

- `bun run packages/<pkg>/bench/<bench>.ts` (ou `bun --cwd=packages/natives run bench`)

7. **Decida sobre o uso**

- Se o nativo for mais lento, **mantenha o JS** e deixe o export nativo sem uso.
- Se o nativo for mais rápido, troque os pontos de chamada para o wrapper nativo.

## Pontos problemáticos e como evitá-los

### 1) `pi_natives.node` desatualizado impede novos exports

O loader prefere o binário com tag de plataforma em `packages/natives/native` (`pi_natives.<platform>-<arch>.node`). `PI_DEV=1` agora apenas habilita diagnósticos do loader; não muda mais para um nome de arquivo de addon de desenvolvimento separado. Também há um fallback `pi_natives.node`. Binários compilados são extraídos para `~/.xcsh/natives/<version>/pi_natives.<platform>-<arch>.node`. Se qualquer um desses estiver desatualizado, os exports não serão atualizados.

**Correção:** remova o arquivo desatualizado antes de recompilar.

```bash
rm packages/natives/native/pi_natives.linux-x64.node
rm packages/natives/native/pi_natives.node
bun --cwd=packages/natives run build
```

Se você estiver executando um binário compilado, delete o diretório de addon em cache:

```bash
rm -rf ~/.xcsh/natives/<version>
```

Depois verifique se o export existe no binário:

```bash
bun -e 'const tag = `${process.platform}-${process.arch}`; const mod = require(`./packages/natives/native/pi_natives.${tag}.node`); console.log(Object.keys(mod).includes("newExport"));'
```

### 2) Erros de "Missing exports" do `validateNative`

Isso é **bom** — previne incompatibilidades silenciosas. Quando você vir isto:

```
Native addon missing exports ... Missing: visibleWidth
```

significa que seu binário está desatualizado, o nome do export Rust (ou alias explícito quando usado) não corresponde ao nome JS, ou o export nunca foi compilado. Corrija o build e a incompatibilidade de nomes, não enfraqueça a validação.

### 3) Incompatibilidade de assinatura Rust

Mantenha simples e owned. `String`, `Vec<String>`, e `Uint8Array` funcionam. Evite referências como `&str` em exports públicos. Se você precisar de dados estruturados, encapsule-os em structs com `#[napi(object)]`.

### 4) Erros de benchmarking

- Não compare entradas ou alocações diferentes.
- Mantenha JS e nativo usando arrays de entrada idênticos.
- Execute ambos no mesmo arquivo de benchmark para evitar distorções.

## Template de benchmark

```ts
const ITERATIONS = 2000;

function bench(name: string, fn: () => void): number {
 const start = Bun.nanoseconds();
 for (let i = 0; i < ITERATIONS; i++) fn();
 const elapsed = (Bun.nanoseconds() - start) / 1e6;
 console.log(`${name}: ${elapsed.toFixed(2)}ms total (${(elapsed / ITERATIONS).toFixed(6)}ms/op)`);
 return elapsed;
}

bench("feature/js", () => {
 jsImpl(sample);
});

bench("feature/native", () => {
 nativeImpl(sample);
});
```

## Checklist de verificação

- `validateNative` passa (sem exports faltando).
- `NativeBindings` está aumentado em `packages/natives/src/<module>/types.ts` e o wrapper está re-exportado em `packages/natives/src/index.ts`.
- `Object.keys(require(...))` inclui seu novo export.
- Números de benchmark registrados no PR/notas.
- Ponto de chamada atualizado **somente se** o nativo for mais rápido ou igual.

## Regra geral

- Se o nativo for mais lento, **não troque**. Mantenha o export para trabalho futuro, mas a TUI deve permanecer no caminho mais rápido.
- Se o nativo for mais rápido, troque o ponto de chamada e mantenha o benchmark para detectar regressões.
