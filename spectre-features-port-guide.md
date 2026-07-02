# Spectre — Feature inventory & port guide

Guía técnica de las features agregadas a **Spectre** (fork de `kimi-code`, linaje qwen-code/gemini-cli), para portarlas a otro fork de [qwen-code](https://github.com/QwenLM/qwen-code).

> **Contexto de arquitectura para el port:** Spectre reorganiza el monorepo respecto de qwen-code. Tres piezas clave a mapear:
> - `packages/agent-core` → loop, tools, profiles, services, sesión (en qwen-code ≈ `packages/core`).
> - `packages/kosong` → capa de abstracción de proveedores LLM (Anthropic/OpenAI/Kimi/Google). qwen-code usa su propio `ContentGenerator` — ahí van los fixes de schema.
> - `apps/kimi-code/src/tui` → TUI y slash commands (en qwen-code ≈ `packages/cli`).
>
> Todas las features siguen el mismo patrón de 4 capas: **(1) un Service** que indexa/prepara datos al arranque, **(2) inyección en el system prompt** vía variable de template, **(3) una builtin Tool** que el modelo llama en runtime, y **(4) un slash command TUI** para gestión manual.

---

## Índice

1. [SDD (Spec-Driven Development) + OKF](#1-sdd-spec-driven-development--okf--la-feature-central)
2. [Reference tool — indexación de librerías](#2-reference-tool--indexación-de-librerías-para-grounding)
3. [Subagent profiles + subagent `stack`](#3-subagent-profiles--el-stack-subagent)
4. [Context7 — integración directa por API](#4-context7--integración-directa-por-api-no-mcp)
5. [Tool input repair layer](#5-tool-input-repair-layer)
6. [Fix de JSON Schema en tool params (kosong)](#6-fix-de-json-schema-en-tool-params-kosong--capa-de-proveedores)
7. [Cambios menores portables](#7-cambios-menores-pero-portables)
8. [Orden sugerido para portar](#orden-sugerido-para-portar-a-qwen-code)

---

## 1. SDD (Spec-Driven Development) + OKF — la feature central

Es un flujo de trabajo, no un motor. Vive en **tres capas**.

### a) El "harness" en el system prompt
`packages/agent-core/src/profile/default/system.md` (283 líneas). Define un **flujo conversacional de 8 pasos** que el agente sigue cuando el usuario quiere construir algo:

1. Discovery (una pregunta a la vez)
2. Stack & arquitectura (delega al subagent `stack`)
3. **Proposal** — escribe `sdd/proposal.md`
4. **Archive decision** — al aprobar: mueve a `sdd/decisions/NNN-name.md`, actualiza `log.md` e `index.md`, **limpia `proposal.md`**
5. **Create tasks** — `sdd/tasks/` con criterios Gherkin
6. Acuerdo del primer paso
7. Implementación (TDD)
8. Verificación

Dos reglas duras en el prompt:
- **Espera aprobación explícita antes de escribir código de producción.**
- **Todo lo que se escribe en `sdd/` es en inglés** sin importar el idioma de la conversación (portabilidad client-facing). Esto incluye frontmatter, prosa, headings y Gherkin.

### b) OKF (Open Knowledge Format) — el formato en disco
Cada concepto es un `.md` con frontmatter YAML obligatorio (`type` + `title`, `description`, `status`, `timestamp`) y se cross-linkean formando un grafo. Estructura en la raíz del proyecto:

```
<proyecto>/
  AGENTS.md              (requerido, humano)
  sdd/
    index.md             (dashboard OKF, sin frontmatter — se lee primero al arrancar)
    log.md               (historial append-only, sin frontmatter)
    proposal.md          (type: Proposal — transitorio, se limpia al aprobar)
    decisions/NNN-*.md   (type: Decision — numerado, histórico)
    tasks/*.md           (type: Task — Gherkin acceptance criteria)
```

Tipos y su frontmatter:
- `Proposal` — `title, description, status(draft|in review|approved|archived), timestamp`
- `Decision` — `title, description, resource, tags, status, timestamp, supersedes[]` + secciones `# Decision` / `# Context` / `# Citations`
- `Task` — `title, description, tags, status(pending|in-progress|done), timestamp` + `# Acceptance criteria` (Gherkin) / `# Dependencies`

### c) KnowledgeService + Knowledge tool (motor de recall)
- `packages/agent-core/src/services/knowledge/knowledgeService.ts` — `initialize(cwd)` camina hacia arriba hasta encontrar `sdd/`, parsea el frontmatter de cada concepto (saltea `index.md`/`log.md`). `getSummary()` renderiza el índice agrupado por tipo.
- El summary se inyecta al system prompt como `{{ KIMI_KNOWLEDGE }}` (mapeo en `profile/resolve.ts:164`; render condicional `{% if KIMI_KNOWLEDGE %}` en `system.md`).
- Tool `Knowledge` (`tools/builtin/knowledge/index.ts`): búsqueda de texto línea-a-línea, schema `{ query: string, type?: "Decision"|"Task"|"Proposal" }`, devuelve hasta 30 `{file, line, snippet}`.
- Se instancia en `rpc/core-impl.ts` (`KnowledgeService.createStandalone`) y se cablea a `ToolServices`. Se inicializa en `session/index.ts:bootstrapAgentProfile()` antes de renderizar el prompt (tanto main agent como subagents).

### d) Slash commands
`apps/kimi-code/src/tui/commands/sdd.ts`:
- `/sdd-setup` — scaffolding del bundle (crea `index.md`, `log.md`, `proposal.md` + `decisions/_template.md`, `tasks/_template.md`).
- `/sdd-status` — verifica core files + `AGENTS.md`.

Registro en `commands/registry.ts` (`BUILTIN_SLASH_COMMANDS`, priority 60), dispatch en `commands/dispatch.ts`.

> **Historia:** empezó como CLI pesado (`spectre sdd`), luego se simplificó a estos dos slash commands (commits `7265aa2`, `3994fc7`). El static `stack.md` fue reemplazado por el proposal workflow vivo.

### Archivos clave (SDD)
| File | Rol |
|---|---|
| `apps/kimi-code/src/tui/commands/sdd.ts` | `/sdd-setup` y `/sdd-status`; escribe el bundle OKF |
| `packages/agent-core/src/profile/default/system.md` | Flujo SDD de 8 pasos, schema OKF, regla English-only, inyección `{{ KIMI_KNOWLEDGE }}` |
| `packages/agent-core/src/services/knowledge/knowledgeService.ts` | Indexa `sdd/`, parsea frontmatter, genera summary |
| `packages/agent-core/src/services/knowledge/{knowledge,types,index}.ts` | Interfaz `IKnowledgeService`, tipos, barrel |
| `packages/agent-core/src/tools/builtin/knowledge/index.ts` | Tool `Knowledge` (search) |
| `packages/agent-core/src/profile/{context,resolve,types}.ts` | Cablea el summary a `KIMI_KNOWLEDGE` |

**Para portar:** el flujo SDD es ~90% prompt engineering en `system.md` + templates en `sdd.ts`. El `KnowledgeService` es ~1 archivo. Lo más fácil y de mayor impacto para replicar primero.

---

## 2. Reference tool — indexación de librerías para grounding

La feature más pesada. Deja que el modelo busque en el **código fuente real de la versión exacta instalada** de cada dependencia, en vez de alucinar APIs.

**Archivos:**
- `packages/agent-core/src/services/reference/referenceService.ts` — servicio completo
- `packages/agent-core/src/services/reference/{reference,types,index}.ts` — interfaz, tipos, barrel
- `packages/agent-core/src/tools/builtin/reference/{index.ts,reference.md}` — tool + descripción LLM
- `packages/agent-core/src/project/detect.ts` — `findProjectRoot`, `detectMonorepo`, `getActiveWorkspace`
- `packages/agent-core/src/project/dependencies.ts` — parseo de deps, versiones

### Almacenamiento
`~/.spectre/references/` con `manifest.json` + un dir por `<paquete>/<versión>`.

```json
{
  "version": 1,
  "references": {
    "zod@3.22.4": {
      "package": "zod", "version": "3.22.4",
      "source": "git", "repo": "https://github.com/colinhacks/zod",
      "clonedAt": "...", "indexedAt": "...",
      "size": 204800, "fileCount": 42, "status": "indexed"
    }
  }
}
```

`source` ∈ `git|local|npm`. Errores se persisten con `status:"error"` para no reintentar en cada arranque.

### Pipeline de indexación (git-first — decisión de diseño consciente)
`indexPackage()` prueba en orden, para en el primer éxito:

1. **Git clone (preferido):** `npm view <pkg> repository --json` → URL. Si es cloneable y **no** es subpaquete de monorepo (sin campo `directory`): `git clone --depth 1 --branch v<ver>` → luego `<ver>` → luego default branch. `source: "git"`.
2. **node_modules local (fallback):** para cada root en `moduleResolveRoots`, copia `<root>/node_modules/<pkg>` con `fsp.cp({dereference:true})` (sigue symlinks de pnpm/`.pnpm`), filtrando sub-paths `node_modules`/`.git`. `source: "local"`.
3. **npm pack + tar (último recurso):** `npm pack <pkg>@<ver>` → `tar xzf <tgz> --strip-components 1`. `source: "npm"`.

**Por qué git-first:** `node_modules/<pkg>` == tarball publicado (dist transpilado, `.d.ts`, sin src/tests originales). `git clone` == repo upstream completo → mucho mejor grounding.

Detalles:
- Cap **50 MB** (`MAX_INDEX_BYTES`), aplicado tras clone y antes de copiar node_modules.
- Concurrencia background `BACKGROUND_INDEX_CONCURRENCY = 3`.
- Dedup vía `inFlight: Map<string, Promise>` (misma librería no se indexa dos veces en paralelo).
- **Solo `dependencies` + `peerDependencies`** — `devDependencies` excluidas; también `workspace:`/`file:`/`git+`/`http:`.
- Version pinning: `resolveDependencyVersion` quita prefijos de rango (`^`, `~`, `>=`); `cleanVersion` maneja aliases `npm:`; `*`/`x` → `"latest"`.

### Detección de monorepo (`detectMonorepo`)
Prioridad: `pnpm-workspace.yaml` → `turbo.json` → `nx.json` → `lerna.json` → campo `workspaces` en root `package.json` (cubre **npm/yarn/bun**, soporta forma array y forma yarn-classic `{ packages: [...] }` — fix commit `8cd55ae`).

Para monorepos, `scanDirs = [activeWorkspace, repoRoot, ...allWorkspaceDirs]` con el workspace activo primero (su versión gana ante rangos distintos entre paquetes). `moduleResolveRoots = [activeWorkspace, repoRoot]`.

### Búsqueda (fix OR-tokenize, commit `0c62cfd`)
```ts
export function buildSearchPattern(query: string): string {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length <= 1) return query.trim();     // 1 término → passthrough (permite regex)
  return terms.map(escapeRegExp).join('|');        // N términos → OR regex-escaped
}
```
Antes pasaba `"GlassView GlassContainer"` literal a ripgrep → 0 matches. Invocación:
```ts
spawn(rgBinary, ['--json', '-S', '--max-count', '25', '-e', pattern, cachePath])
```
- `--json` NDJSON, `-S` smart-case, `--max-count 25` por archivo.
- Cap agregado `MAX_SEARCH_RESULTS = 40` (mata el proceso al llegar), timeout `SEARCH_TIMEOUT_MS = 10_000`.
- Con 0 resultados, `writeEmptyExplanation()` diagnostica 4 casos: no en deps activas / pendiente / errored / miss real.

### Tool schema (expuesto al modelo)
Nombre `Reference`. Input:
```json
{
  "package": "zod | react | @tanstack/react-query",
  "query": "símbolo único o identificador; multi-word = OR; single term admite regex"
}
```
Presente en profiles `agent`, `coder`, `explore`, `plan` (**no** en `stack`). Instanciación condicional en `agent/tool/index.ts:427` (`toolServices?.reference && new b.ReferenceTool(...)`).

### Wiring de arranque (no bloqueante)
1. `core-impl.ts` → `ReferenceService.createStandalone(homeDir, logger)` → `ToolServices.reference`.
2. `session/index.ts:bootstrapAgentProfile()` → `await referenceService.initialize(cwd)` (no fatal). Popula `activePackages` y dispara `warmupPromise = indexActiveInBackground()` **sin bloquear**.
3. `prepareSystemPromptContext()` → `getSummary()` (vacío en cold cache) → `{{ KIMI_REFERENCES }}`.
4. Si vacío, `injectReferencesWhenWarm()` (fire-and-forget) hace `await whenWarm()` y luego `agent.context.appendSystemReminder(...)` con las fuentes disponibles.

### UI
`/references` (`apps/kimi-code/src/tui/commands/references.ts`):
- Panel con estados `✓` (indexed) / `○` (pending) / `✗` (error), columnas `pkg@ver | files | size | source`, footer `N/M indexed · X MB`.
- `/references refresh [pkg]` — muestra preview + **diálogo de confirmación** (`ChoicePickerComponent`) antes de descargar.
- `/references clear [pkg]`.

---

## 3. Subagent profiles + el `stack` subagent

Sistema de profiles YAML: `packages/agent-core/src/profile/default/*.yaml`. Cada uno `extends: agent`, hereda `system.md`, overridea `tools:` + inyecta `promptVars.roleAdditional`. `agent.yaml` declara los subagents en un bloque `subagents:`.

Resolución (`profile/resolve.ts`): `resolveAgentProfiles()` camina la cadena `extends`, mergea `promptVars` (padre primero, hijo override), toma `tools` del hijo entero (sin merge), y adjunta el mapa resuelto a `ResolvedAgentProfile.subagents`.

Subagents:
| Nombre | Archivo | Rol |
|---|---|---|
| `agent` | `agent.yaml` | Loop principal (co-pilot) |
| `coder` | `coder.yaml` | SWE general (read+write, Bash, mcp) |
| `explore` | `explore.yaml` | Read-only search |
| `plan` | `plan.yaml` | Arquitectura/planning read-only |
| `stack` | `stack.yaml` | Research de librerías/versiones/compatibilidad (commit `97b1625`) |

**`stack`** — tools: `Context7, WebSearch, FetchURL, Read, Glob, Grep, Reference, Knowledge`. Prompt: usar Context7 como fuente autoritativa (search → id → query), fallback a WebSearch/`npm view`, **grounding contra lockfiles reales** (package.json, pnpm-lock, requirements.txt, go.mod, Cargo.toml…), no editar archivos. Se sacó Context7 del loop principal y quedó **solo acá** para no contaminar cada turno.

> Nota de port: gemini-cli/qwen-code no traía subagents nativos. Revisá si tu fork ya tiene el mecanismo antes de portar profiles.

---

## 4. Context7 — integración directa por API (no MCP)

Commit `bf293f8` reemplazó el MCP server de Context7 por un cliente REST propio.

- `packages/agent-core/src/tools/providers/context7-api.ts` — `Context7ApiProvider`, REST contra `https://context7.com/api/v2`:
  - `searchLibraries(query)` → `GET /libs/search?libraryName=` → hasta 10 libs (id, name, versions).
  - `queryContext(libraryId, query)` → `GET /context?libraryId=&query=&type=txt` → `string[]`.
  - Auth `Bearer {apiKey}`, key desde `[services.context7] api_key` en `~/.spectre/config.toml` o `CONTEXT7_API_KEY`.
- Tool `Context7` (`tools/builtin/context7/index.ts`) — zod discriminated union `operation: search|query`. Diseño de dos pasos (search → id → query).
- `/context7` slash command (`apps/kimi-code/src/tui/commands/context7.ts`) — gestiona la API key (set/change/remove), guarda en `config.toml`.
- Schema config: `config/schema.ts` — `context7: MoonshotServiceConfigSchema.optional()` (`{ apiKey?: string }`).

---

## 5. Tool input repair layer

`packages/agent-core/src/tools/args-repair.ts` — `repairToolArgs(args, ajvErrors): unknown`. Se llama en `loop/tool-call.ts` **solo cuando falla la validación AJV** (fast path sin overhead). Clona los args (nunca muta el original), navega el `instancePath` de cada error AJV y aplica reparaciones dirigidas al tipo esperado:

| Reparación | Trigger | Fix |
|---|---|---|
| `stripNullOptionals` | `null` en objeto | `delete parent[key]` |
| `parseStringifiedJson` | string que empieza `[`/`{` donde se espera array/obj | `JSON.parse` |
| `wrapBareStringToArray` | string donde se espera array | `[value]` |
| `unwrapObjectToArray` | `{"0":"a","1":"b"}` o `{}` donde se espera array | `Object.values` / `[]` |

Devuelve el clon reparado si aplicó algo, si no `null`. Se re-valida; si pasa → `{ kind:'runnable', args:repaired, repaired:true }`, si no → `{ kind:'rejected', repairFailed:true }`. Trackeado en telemetría.

> El comentario apunta a modelos abiertos (DeepSeek, **Qwen**, GLM) que malforman tool-calls. **Muy relevante para tu fork de qwen-code.**

---

## 6. Fix de JSON Schema en tool params (kosong / capa de proveedores)

`packages/kosong/src/providers/openai-common.ts`:
```ts
export function ensureObjectRootParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof parameters['type'] === 'string') return parameters;  // ya tiene type
  return { type: 'object', ...parameters };                        // prepende type:"object"
}
```
Aplicado en los 3 wires OpenAI-family:
- `openai-legacy.ts` — vía `toolToOpenAI()` (que lo llama internamente).
- `openai-responses.ts` — directo: `parameters: ensureObjectRootParameters(tool.parameters)`.
- `kimi.ts` — además `normalizeKimiToolSchema()` rellena `type` en nodos anidados, luego `ensureObjectRootParameters` garantiza el root.

`anthropic.ts` **no** lo usa (Anthropic no requiere root `type`).

> **Causa:** Moonshot/Kimi y proxies OpenAI estrictos rechazan `parameters` con root `oneOf`/`anyOf` sin `type:"object"` (lo que genera zod `discriminatedUnion`). Error: `tools.function.parameters.type is required and must be "object"`. **También relevante para Qwen** contra gateways estrictos.

---

## 7. Cambios menores pero portables

- **Data dir `~/.spectre`** — `config/path.ts:resolveKimiHome()`: `homeDir ?? process.env['KIMI_CODE_HOME'] ?? join(homedir(), '.spectre')`. Bajo ese dir: `config.toml`, `mcp.json`, `credentials/mcp/`, `plugins/managed/{id}/`, `bin/rg`, `skills/`, `references/`. (Fallback cambiado de `~/.kimi-code`, commits `5fdcd74`/`fc9b20b`.)
- **Installer con progreso + resume** — `install.sh` (commit `d7960f8`): flags curl `--progress-bar -C - --retry 3 --retry-delay 2 --connect-timeout 30`. Cambio puro de shell.
- **Removidos** (por si aparecen en el historial): autocommit, `SddWrite` tool, comando `/pr` (commit `6e44d29`).

---

## Orden sugerido para portar a qwen-code

1. **Reference tool** (#2) — mayor impacto en calidad de código. Los prerequisitos casi obligatorios: **repair layer** (#5) y **fix de schema** (#6), porque Qwen malforma tool-calls y puede pegar contra gateways estrictos.
2. **SDD + KnowledgeService** (#1) — casi todo prompt + 1 service + templates. Fácil y alto impacto.
3. **Subagent profiles + `stack` + Context7** (#3, #4) — depende de si tu fork ya tiene sistema de subagents; verificarlo primero.

---

### Referencia rápida de commits
```
0c62cfd fix(reference): OR-tokenize search queries
d7960f8 fix(install): download progress + retry/resume
8cd55ae fix(reference): detect npm/yarn/bun workspaces
7cd83f5 feat(profiles): English-only en sdd/ OKF bundle
97b1625 feat(profiles): stack subagent
a027771 fix(kosong): ensure object root on tool parameters
2064a17 Adopt Open Knowledge Format (OKF) as SDD standard
9a4cc75 feat(reference): richer source indexing + monorepo grounding
ae6d9ef feat(references): confirmation dialog + rich panel UI
ff0de16 fix(tool-repair): scope repairs by expected type
9de0d0e fix(references): curated indexing (skip devDeps, size cap)
0035335 feat(references): lazy + background indexing
f3fba17 feat: dependency reference system for grounded codegen
df30e08 feat: tool input repair layer + telemetry
5fdcd74 feat!: default data dir → ~/.spectre
bf293f8 feat: replace Context7 MCP with direct API integration
```
