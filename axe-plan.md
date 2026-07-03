# Axe — Plan de ejecución

Fork de [qwen-code](https://github.com/QwenLM/qwen-code) con rename completo a `axe` y port de features de Spectre (fork previo de kimi-code).

**Fuente de features:** `spectre-features-port-guide.md`
**Excluido:** Context7 (ya cubierto por MCP server externo)

---

## Fase 0 — Setup inicial

> **Gestor de paquetes:** npm para install (workspace hoisting requerido por tsc). `bun` disponible para correr scripts (`bun run dev`, etc.)

- [x] Clonar qwen-code como base del fork
- [x] Crear commit inicial (`chore: initial qwen-code import`)
- [x] `npm install` — instalar dependencias (npm real, no el shim de bun)

---

## Fase 1 — Rename: qwen → axe

Cambios de identidad: binario, directorio global, directorio de proyecto, env vars, package names.

### 1.1 Punto central del nombre de directorio

- [x] `packages/core/src/utils/paths.ts` — `QWEN_DIR = '.qwen'` → `'.axe'`

### 1.2 Variables de entorno

- [x] `packages/core/src/config/storage.ts`
  - `QWEN_HOME` → `AXE_HOME`
  - `QWEN_RUNTIME_DIR` → `AXE_RUNTIME_DIR`
  - `SKILL_PROVIDER_CONFIG_DIRS = ['.qwen', ...]` → `['.axe', ...]`
  - Fallback `'.qwen'` en tmpdir → `'.axe'`

### 1.3 Binario CLI

- [x] `package.json` raíz — `"bin": { "qwen": ... }` → `"axe"`
- [x] `packages/cli/package.json` — `"bin": { "qwen": ... }` → `"axe"`
- [x] `packages/core/package.json` — `"name"` y referencias `@qwen-code/...`

### 1.4 Package names (monorepo)

- [x] `package.json` raíz — `"name": "@qwen-code/qwen-code"` → `"@axe/axe"`
- [x] `packages/cli/package.json` — `"name"` → `"@axe/cli"`
- [x] `packages/core/package.json` — `"name"` → `"@axe/core"`
- [x] Actualizar cross-references entre paquetes en todos los `package.json`

### 1.5 Strings en código fuente

- [x] `packages/cli/src/` — referencias al comando `qwen` en strings visibles al usuario
- [x] `packages/core/src/` — referencias a `~/.qwen` en strings de tool descriptions / docstrings expuestos al modelo
- [x] `integration-tests/` — referencias al binario `qwen` en los test runners

### 1.6 AGENTS.md y docs internas

- [x] `AGENTS.md` — actualizar referencias al comando `qwen` y directorio `.qwen`
- [ ] `README.md` — cosmético, actualizar nombre y referencias de instalación

### 1.7 Scripts y esbuild

- [x] `scripts/cli-entry.js` — comentarios internos
- [x] `esbuild.config.js` — verificar que no hardcodea `qwen`
- [x] `scripts/` generales — verificar referencias al binario

### 1.8 Verificación post-rename

- [x] `npm run build` — sin errores de compilación
- [x] `tsc --build` de `@axe/cli` — verde (deuda de `serve/` arreglada: 19 errores `string | string[]` de `req.params` con Express 5 @types → helper `routeParam` en `server/request-helpers.ts`)
- [x] Smoke test: `node packages/cli/dist/index.js --help` responde `Usage: axe`

### 1.9 Limpieza de deuda de rename (completada en sesión de Fase 4)

Criterio del usuario: lo que importa es que `~/.axe` y `AXE_HOME` funcionen para configurar cosas; lo interno no-visible no hace falta tocarlo.

Bloqueadores del bundle (arreglados):
- [x] `packages/channels/qqbot` sin `dist/` → `bun run --cwd packages/channels/qqbot build` (los otros 5 channels ya lo tenían)
- [x] `web-templates/src/export-html/build.mjs` — `@qwen-code/webui` → `@axe/webui`
- [x] Renombrado `QwenOAuthProgress.tsx`/`.test.tsx` → `AxeOAuthProgress.*` (export e imports ya eran Axe)
- [x] `esbuild.config.js` alias `@qwen-code/web-templates` → `@axe/web-templates`
- [x] **Bundle esbuild verde** (`node esbuild.config.js` exit 0) + core `tsc` exit 0 + CLI `--help` OK

Env vars user-facing (rename completado — antes inconsistente: storage.ts usaba AXE_HOME pero cli/settings/environment/etc. leían QWEN_HOME):
- [x] `QWEN_HOME` → `AXE_HOME` y `QWEN_RUNTIME_DIR` → `AXE_RUNTIME_DIR` en TODO el source (~13 archivos: core/cli/vscode-ide-companion/channels/desktop) + tests dependientes. `storage.test` verde (126). **OJO:** NO se tocan `QWEN_SYSTEM_MD`, `QWEN_CODE_*`, `QWEN_CODE_MEMORY_LOCAL` (intencionalmente QWEN_)
- [x] `autoMode.ts` — regex de paths protegidos `.qwen/` → `.axe/` (mantiene filename `qwen.local.md`)
- [x] `variables.ts` — reemplazo `.claude`→`.axe` (era `.qwen`) + `INSTALL_METADATA_FILENAME`
- [x] Loop skill `SKILL.md` + comentarios — `.qwen/loop.md` → `.axe/loop.md`
- [x] Tests dependientes arreglados: permissions (1326), variables, extensionManager (110), client (428), loop (172). Mock `telemetry/loggers.js` (faltaba `logStartSession`) arreglado con importOriginal spread en client.test + extensionManager.test

Fallos restantes (~90, BEHAVIORAL/internos — fuera de scope por criterio del usuario): `logger.test` (formato de log interno), `write-file` (escritura/error-type), `agent-headless` (spies), y misceláneos chicos. No afectan `~/.axe`/`AXE_HOME` ni el bundle. Triage aparte si hiciera falta.

---

## Fase 2 — Tool input repair layer

**Referencia:** Spectre `spectre-features-port-guide.md` §5
**Por qué primero:** Qwen malforma tool-calls; esto es la base para que todo lo demás funcione bien.

Mapeo de archivos (Spectre → axe):
- `packages/agent-core/src/tools/args-repair.ts` → `packages/core/src/tools/args-repair.ts`
- `packages/agent-core/src/loop/tool-call.ts` (integración) → localizar el equivalente en `packages/core/src/`

### Hallazgo de arquitectura (divergencia del plan original)

qwen-code **ya tiene** una capa de coerción in-place más sofisticada que el `args-repair.ts` de Spectre, dentro de `packages/core/src/utils/schemaValidator.ts`. `SchemaValidator.validate(schema, data)` muta `data` en el lugar cuando la validación AJV falla, aplicando 4 pasos documentados con un invariante de orden estricto:

1. `fixBooleanValues` — `"true"`/`"false"` → `true`/`false`
2. `fixStringValues` — number/boolean → string
3. `fixStringifiedJsonValues` — `'["a"]'` → `["a"]` (≈ `parseStringifiedJson` de Spectre, más completo: recursa arrays/objetos anidados)
4. `fixNumericValues` — `"3"` → `3`

Se llama desde `BaseDeclarativeTool.validateToolParams()` (`tools.ts:401`) — el fast path (solo corre coerción tras un fallo de AJV) ya existe.

**Decisión:** en vez de crear un `args-repair.ts` paralelo que duplicaría `parseStringifiedJson` y competiría con este sistema, se agregaron las **3 reparaciones faltantes de Spectre como pasos nuevos (5–7)** en `schemaValidator.ts`, reutilizando sus helpers (`getAcceptedTypes`, `resolvePropSchema`, guardas anti prototype-pollution).

### Tasks

- [x] Localizar dónde se validan tool-calls → `schemaValidator.ts` (llamado desde `tools.ts:401`)
- [x] `parseStringifiedJson` — ya presente como `fixStringifiedJsonValues` (no re-implementar)
- [x] `stripNullOptionals` — pass 5: borra `null` en campos opcionales que no aceptan null (respeta `required` y nullable explícito)
- [x] `wrapBareStringToArray` — pass 6: string bare → `[value]` donde se espera array (skip de strings JSON-looking, ya cubiertas por pass 3)
- [x] `unwrapObjectToArray` — pass 7: `{"0":"a","1":"b"}`/`{}` → array donde se espera array (solo índices contiguos zero-based)
- [x] Integración en el fast path (los pasos 5–7 corren tras fallo de AJV, antes de re-validar) + comentario de invariante de orden actualizado
- [x] Unit tests para los 3 casos nuevos + tests de no-coerción (18 casos nuevos, 290 tests verdes)
- [x] Logging via `debugLogger.debug` en cada reparación (consistente con los pasos existentes)

---

## Fase 3 — Fix JSON Schema en tool params

**Referencia:** Spectre `spectre-features-port-guide.md` §6
**Por qué acá:** Fix puntual, bajo riesgo, elimina rechazos de gateways OpenAI-compatible.

Mapeo:
- `packages/kosong/src/providers/openai-common.ts` → localizar la capa de generación de ContentGenerator/tool schema en `packages/core/src/`

Mapeo real (axe):
- `packages/kosong/src/providers/openai-common.ts` → `packages/core/src/core/openaiContentGenerator/converter.ts` (`convertGeminiToolsToOpenAI`, único wire OpenAI-family; lo usan todos los providers: dashscope, deepseek, qwen, minimax, zai, mistral, mimo, modelscope, default)
- La función `ensureObjectRootParameters` vive en `packages/core/src/utils/schemaConverter.ts` (junto a `convertSchema`, reutilizable y testeable)
- Anthropic tiene su propio path (`anthropicContentGenerator/converter.ts`, usa `input_schema`) — NO recibe el fix

### Tasks

- [x] Localizar la serialización de tool schema → `convertGeminiToolsToOpenAI` en `openaiContentGenerator/converter.ts`
- [x] Implementar `ensureObjectRootParameters(params)` en `schemaConverter.ts` — si el root no tiene `type` string, prepende `type: "object"` (no-mutante, idéntico a Spectre)
- [x] Aplicar tras `convertSchema` en el wire OpenAI-compatible (no en Anthropic)
- [x] Unit tests de `ensureObjectRootParameters` (5 casos) + integration tests en el converter (oneOf root → type prepended; type existente → sin duplicar). 328 tests verdes, tsc exit 0
- Nota: para `type` array root (`["object","null"]`) el spread re-aplica el array — fiel a Spectre; no es un caso real en params de tools

---

## Fase 4 — SDD + KnowledgeService

**Referencia:** Spectre `spectre-features-port-guide.md` §1
**Qué es:** Flujo Spec-Driven Development de 8 pasos en el system prompt + OKF en disco + KnowledgeService que indexa `sdd/` + Tool `Knowledge` + slash commands `/sdd-setup` y `/sdd-status`.

Mapeo:
- `packages/agent-core/src/profile/default/system.md` → system prompt en `packages/core/src/core/prompts.ts` o archivo `.md` equivalente
- `packages/agent-core/src/services/knowledge/` → `packages/core/src/services/knowledge/`
- `packages/agent-core/src/tools/builtin/knowledge/` → `packages/core/src/tools/knowledge/`
- `apps/kimi-code/src/tui/commands/sdd.ts` → `packages/cli/src/ui/commands/sdd.ts`

Mapeo real (axe) — sin motor de templating; el prompt es un template literal en TS:
- System prompt: `getCoreSystemPrompt()` en `packages/core/src/core/prompts.ts` (concatenación de strings, sin `{{ }}`)
- Ensamblado final: `client.ts:getMainSessionSystemInstruction()` llama a `getCoreSystemPrompt`
- Servicio: instanciado en `Config.initialize()` (tras `refreshHierarchicalMemory`, antes de `geminiClient.initialize()`), getter `config.getKnowledgeService()`
- Tool registry: `registerLazy` en `config.ts:createToolRegistry()`; nombres en `tool-names.ts`
- Slash commands: `SlashCommand` literal + registro en `BuiltinCommandLoader.ts` (array `allDefinitions`)
- Frontmatter: lib `yaml` ya presente; wrapper `utils/yaml-parser.ts` (`parse`)

### Tasks

- [x] Localizar el system prompt → `prompts.ts:getCoreSystemPrompt` (template literal, sin templating engine)
- [x] Agregar el harness SDD de 8 pasos al prompt — embebido en el cuerpo del template (no como suffix, para no romper el invariante "sin separador `---`"). Render condicional: índice de conocimiento si hay `sdd/`, hint `/sdd-setup` si no. Exportado como `getSddHarness()`
- [x] Definir OKF (tipos `Proposal`/`Decision`/`Task`, frontmatter YAML) en `services/knowledge/types.ts`
- [x] `services/knowledge/knowledgeService.ts` — walk-up a `sdd/`, parseo de frontmatter (skip index.md/log.md/_template), `getSummary()` agrupado por tipo, `search()` línea-a-línea cap 30
- [x] Types + interfaz `IKnowledgeService` + barrel `index.ts` + export en `core/index.ts`
- [x] Conectar summary al prompt: 4º param `knowledgeSummary` de `getCoreSystemPrompt`, pasado desde `client.ts` vía `getKnowledgeService()?.getSummary()`
- [x] Tool `Knowledge` en `tools/knowledge.ts` — schema `{ query, type? }`, búsqueda vía servicio, `writeEmptyExplanation` para 0 resultados. `ToolNames.KNOWLEDGE` + registro `registerLazy`
- [x] Cableado en sesión: `KnowledgeService` init en `Config.initialize()` antes del geminiClient + getter
- [x] Slash command `/sdd-setup` — scaffold OKF (index.md, log.md, proposal.md, decisions/_template.md, tasks/_template.md); idempotente (skip existentes)
- [x] Slash command `/sdd-status` — checklist core files + `AGENTS.md` con `✓`/`✗`, cuenta decisions/tasks
- [x] Registro de ambos commands en `BuiltinCommandLoader`
- [x] Tests: knowledgeService (7), Knowledge tool (5), SDD harness prompt (4) — todos verdes; 30 snapshots de prompt regenerados
- [x] Verificación: core builds clean (tsc exit 0). NOTA: el bundle completo (`npm run build`) y ~280 tests fallan por **deuda pre-existente de Fase 1** (rename qwen→axe incompleto: `@axe/channel-qqbot`, `@axe/web-templates`, `AxeOAuthProgress.js`, strings `qwen-loop`). Verificado que NO son de Fase 4 (stash de client.ts → falla idéntica; ningún fallo referencia knowledge/sdd/prompts)

---

## Fase 5 — Reference tool

**Referencia:** Spectre `spectre-features-port-guide.md` §2
**Qué es:** El modelo busca en el código fuente real de la versión exacta instalada de cada dependencia (en vez de alucinar APIs). Almacena en `~/.axe/references/`.

**Decisiones tomadas (esta sesión):**
- Pipeline de indexado: **git-first** (paridad Spectre) — mejor grounding (repo upstream con `src`/tests reales, no `dist` transpilado)
- Monorepo: **workspaces comunes** — `package.json#workspaces` (npm/yarn/bun) + `pnpm-workspace.yaml` (no turbo/nx/lerna por ahora)

**Mapeo de arquitectura (Spectre → axe):**
- `packages/agent-core/src/project/{detect,dependencies}.ts` → `packages/core/src/project/{detect,dependencies}.ts`
- `packages/agent-core/src/services/reference/` → `packages/core/src/services/reference/`
- `packages/agent-core/src/tools/builtin/reference/` → `packages/core/src/tools/reference.ts` (tool inline, como `knowledge.ts`)
- `apps/kimi-code/src/tui/commands/references.ts` → `packages/cli/src/ui/commands/referencesCommand.ts`

**Reuso vs. construyo (auditado):**

| Capa | REUSO (ya existe) | CONSTRUYO |
|---|---|---|
| Project root | `utils/projectRoot.ts:findProjectRoot()` (walk-up a `.git`) | — |
| Monorepo | — | `detectMonorepo` (workspaces + pnpm-workspace.yaml), `getActiveWorkspace` |
| Deps/lockfiles | `utils/yaml-parser.ts` (pnpm-lock), `JSON.parse` (package.json) | parseo deps+peerDeps, pinning de versiones |
| ripgrep | `utils/ripgrepUtils.ts:runRipgrep()`/`resolveRipgrep()` (rg bundled, path-agnostic) | `buildSearchPattern` OR-tokenizado |
| Storage `~/.axe` | `config/storage.ts:Storage.getGlobalQwenDir()` (respeta `AXE_HOME`) | `getGlobalReferencesDir()` estático + schema `manifest.json` |
| mkdir | patrón `ensureProjectTempDirExists()` (fs.mkdirSync recursive) | — |
| Init background | patrón `config.ts:startMcpDiscoveryInBackground()` (Pattern B: promise guardada + `waitForReady()`) | `warmup()` de ReferenceService |
| Subprocess | `utils/shell-utils.ts:execCommand()` (execFile, sin shell) | (invocaciones git clone / npm view / npm pack) |
| Prompt inject | 5º param en `getCoreSystemPrompt` + getter en Config + `getReferencesBlock()` (igual patrón que `getSddHarness`) | `getSummary()` |

### Tasks

- [x] `packages/core/src/project/detect.ts` — re-exporta `findProjectRoot` (reuso), `detectMonorepo` (workspaces npm/yarn/bun forma array + `{packages:[]}` + pnpm-workspace.yaml, con expansor de globs `*`/`**` y patrones de negación `!`), `getActiveWorkspace` (dir más profundo que contiene cwd)
- [x] `packages/core/src/project/dependencies.ts` — `parseDependencies` (deps + peerDeps, excluye dev/optional, dedup por installName con dep>peer), `resolveDependencyVersion` (desenvuelve aliases `npm:` incl. scoped, rechaza `workspace:`/`file:`/`link:`/`git+`/`github:`/`http(s):`), `cleanVersion` (quita `^`/`~`/`>=`/`v`, rangos compuestos → primer comparador, `*`/`x`/`1.x`/vacío → `latest`)
- [x] `packages/core/src/services/reference/{types,referenceService,index}.ts`:
  - Pipeline git-first: `npm view <pkg>@<ver> repository.url` → `normalizeGitUrl` → `git clone --depth 1 --single-branch` probando `v<ver>`/`<ver>`/default; fallback node_modules local (`fsp.cp` dereference, filtrando `node_modules`/`.git`); fallback `npm pack --json` + `tar -xzf`
  - Storage `~/.axe/references/` (`Storage.getGlobalReferencesDir()`, respeta `AXE_HOME`) con `manifest.json` (schema `{version, references: {"<pkg>@<ver>": {package, version, source, repo?, clonedAt, indexedAt, size, fileCount, status, error?, cachePath?}}}`)
  - Cap `MAX_INDEX_BYTES = 50MB` (borra + `status:error` si excede), `BACKGROUND_INDEX_CONCURRENCY = 3` (worker pool), dedup via `inFlight: Map`, errores persistidos (`status:error`) para no reintentar (salvo `force`)
  - Monorepo-aware: `moduleResolveRoots = [activeWorkspace, repoRoot]`; deps leídas de activeWorkspace + repoRoot mergeadas
  - Métodos extra para el slash command: `getManifest()`, `clear(pkg?)`
- [x] Tool `Reference` (`tools/reference.ts`, patrón `knowledge.ts`) — input `{ package, query }`, `ToolNames.REFERENCE`/`ToolDisplayNames.REFERENCE` + `registerLazy`:
  - `buildSearchPattern`: 1 término → passthrough (regex); N términos → `escapeRegExp` join `|` (en `referenceService.ts`, exportado + testeado)
  - `runRipgrep(['--json','-S','--max-count','25','-e',pattern,cachePath])`, `parseRipgrepMatches` → rel path, cap `MAX_SEARCH_RESULTS = 40`
  - Explicaciones para 0 resultados: `not-a-dependency` (lista pkgs activos) / `pending` / `errored` (con detalle) / miss real
- [x] Wiring no bloqueante: `ReferenceService` en `Config.initialize()` (tras KnowledgeService; `initialize(cwd)` popula `activePackages` sincrónico rápido; `void warmup()` fire-and-forget salvo bare/safe mode) + getter `getReferenceService()` + registro tool en `createToolRegistry`
- [x] Inyectar summary en system prompt: 5º param `referencesSummary` de `getCoreSystemPrompt` + `getReferencesBlock()` (patrón `getSddHarness`), fed desde `client.ts:getMainSessionSystemInstruction` vía `getReferenceService()?.getSummary()`. Summary lista pkgs activos con estado (indexed/indexing…/unavailable) — útil desde el arranque sin necesitar `injectReferencesWhenWarm` (simplificación vs. plan; el reminder diferido queda como mejora futura)
- [x] Slash command `/references` (`referencesCommand.ts`, registrado en `BuiltinCommandLoader`):
  - Panel estados `✓` (indexed) / `○` (pending) / `✗` (error), fila `pkg@ver — files · size · source`, footer `N/M indexed · X MB · cache`
  - `/references refresh [pkg]` — `confirm_action` (patrón `context.overwriteConfirmed`) antes de descargar; reindexado `force`
  - `/references clear [pkg]`
- [x] Tests unitarios (36 casos, verdes): `cleanVersion`/`resolveDependencyVersion`/`parseDependencies` (dependencies.test), `detectMonorepo` (array/object/pnpm/negación) + `getActiveWorkspace` (detect.test), `buildSearchPattern`/`escapeRegExp`/`normalizeGitUrl` + `referenceService` (resolución de deps, index local, manifest read/write, dedup `inFlight`, error sticky, search vía ripgrep mock, clear) con mocks de `execCommand`/`runRipgrep` y `AXE_HOME` temp
- Verificación: `tsc -p packages/core` exit 0; `tsc --noEmit -p packages/cli` sin errores nuevos (solo warning pre-existente `baseUrl` deprecation); prompts snapshots (124) intactos
- Test general (post-implementación): bundle `npm run bundle` verde (Reference tool sale como chunk lazy propio `reference-*.js`), smoke `node dist/cli.js --version/--help` OK. Suite completa del core: 101 fallos = baseline pre-existente documentado (≈97 en run doble), 28119 passed. **Cero regresiones netas.**
- FIX de regresión introducida y corregida: al agregar `getReferenceService()` en `client.ts:getMainSessionSystemInstruction`, el mock de Config en `client.test.ts` no tenía el método → `TypeError: getReferenceService is not a function` rompía 428 tests. Arreglado agregando `getReferenceService: vi.fn().mockReturnValue(undefined)` al mock (junto a `getKnowledgeService`) + el 5º arg `undefined` en la aserción `toHaveBeenCalledWith` de getCoreSystemPrompt. Gotcha: cualquier método nuevo en Config que se llame desde el hot path del client necesita entrar en ese mock.

### Build completo (para instalar) — hallazgos

- `bun run build` (todos los paquetes) falla en 2 lugares de **deuda pre-existente NO relacionada a Fase 5**:
  1. **`serve/` (19 errores de tipos)** — ARREGLADO. Express 5 tipa `req.params[key]` como `string | string[]` (`ParamsDictionary` index signature en `@types/express-serve-static-core@5`). 19 sitios lo pasaban a sinks `string`. Fix: helper `routeParam(value): string` en `packages/cli/src/serve/server/request-helpers.ts` (normaliza array→[0]), aplicado en permission.ts, session.ts, workspace-auth.ts, workspace-extensions.ts, workspace-agents.ts, workspace-remember.ts, request-helpers.ts. `tsc --build` de cli → 0 errores.
  2. **`web-shell` (218 errores)** — NO arreglado, fuera de scope. Es la UI web de `axe serve`; `@axe/webui/daemon-react-sdk` no exporta lo que espera + implicit-any masivo. Deuda de UI pre-existente enorme, ajena al CLI.
- **SOLUCIÓN para instalar**: `build.js` ya tiene flag `--cli-only` que saltea `webui`/`web-shell`/`vscode-ide-companion`/`chrome-extension` (comentados como "IDE/web use only"). Comando: **`bun run build -- --cli-only && bun run bundle`** → verde end-to-end. Bundle `dist/cli.js`, smoke `--version`=0.19.5 / `--help`=Usage: axe OK.
- OJO con `npm install -g .`: el hook `prepare` corre `build && bundle` (build completo, sin `--cli-only`) → fallaría por web-shell. Para instalar global sin arreglar web-shell hay que saltear prepare o ajustar el hook a `--cli-only`.

---

## Fase 6 — Subagent profiles

**Referencia:** Spectre `spectre-features-port-guide.md` §3

### HALLAZGO (auditado esta sesión): el sistema de subagents/profiles YA EXISTE y está completo.

Este fork NO es qwen-code vanilla — tiene un sistema de subagents tipo Claude Code, totalmente funcional. **No hay que construir infraestructura.**

- **Un profile = archivo `.md` con frontmatter YAML** (el cuerpo del markdown es el system prompt del subagente).
- **Discovery + precedencia**: `session` (in-memory) → `<proyecto>/.axe/agents/*.md` → `~/.axe/agents/*.md` → extensiones → **built-ins** (hardcoded en `packages/core/src/subagents/builtin-agents.ts`, `BuiltinAgentRegistry`). Shadowing por nombre (mayor prioridad gana).
- **Schema del frontmatter** (`subagents/agent-frontmatter-schema.ts` + `types.ts`): `name` (req), `description` (req, se expone al modelo), `tools` (allow-list, acepta CSV o array; nombres internos `read_file` o display `ReadFile`), `disallowedTools` (deny-list, soporta `mcp__server`), `model` (`inherit`/`fast`/`<id>`/`authType:<id>`), `approvalMode`, `permissionMode` (compat CC), `maxTurns`, `runConfig`, `color`, `background`, `mcpServers`, `hooks`.
- **Enforcement de tools**: allow-list en `agent-core.ts:prepareTools()`; `EXCLUDED_TOOLS_FOR_SUBAGENTS` (Agent, Task*, Cron*, Team*, Workflow, worktree…) siempre bloqueado.
- **System prompt**: el cuerpo del `.md` ES el system prompt (reemplaza, no augmenta el del padre); soporta `${variable}` templating vía `ContextState`; se le appendea la memoria `AXEMD`/`QWEN.md`.
- **Invocación**: tool `Agent` (`tools/agent/agent.ts`) con `subagent_type`; publica dinámicamente el `enum` de profiles disponibles + sus `description` al modelo. Refresca vía `addChangeListener`.
- **Built-ins actuales**: `general-purpose` (default, todos los tools), `Explore` (read-only search, model `fast`), `statusline-setup`. También existe el tipo `Plan`.
- **NO hay `extends`/herencia** (cada profile es autocontenido). NO hay watch de FS en tiempo real (refresca en CRUD). Formato YAML puro NO soportado (debe ser `.md` con frontmatter).

### Mapeo de los profiles de Spectre → estado en axe

| Spectre | Estado en axe |
|---|---|
| `agent` (loop principal) | N/A — es el agente principal, no un subagente |
| `explore` | ✅ ya existe (built-in `Explore`) |
| `plan` | ✅ ya existe (tipo `Plan`) |
| `coder` | el agente principal ya codea; no se agrega (no pedido) |
| `stack` | ❌ **ELIMINADO** — dependía de Context7 como fuente autoritativa, y Context7 ya está excluido del fork. Sin Context7 el `stack` pierde su razón de ser; no se implementa. |

### Conclusión

**Fase 6 = sin trabajo de implementación.** El mecanismo de profiles ya cubre "profiles con tools restringidos + prompt custom" (drop de un `.md` en `.axe/agents/` o `~/.axe/agents/`). Los profiles útiles de Spectre ya existen (`Explore`, `Plan`) o no aplican (`agent`, `coder`) o se eliminaron (`stack`/Context7).

- [x] Auditar sistema de profiles/subagents → existe y está completo (ver hallazgo arriba)
- [x] Mapear profiles de Spectre → `explore`/`plan` ya existen; `stack` eliminado (Context7); `coder`/`agent` no aplican
- [N/A] Construir mecanismo, crear `stack`, resolver `extends` — no aplica

---

## Notas de arquitectura

- **`packages/core`** es el equivalente de `packages/agent-core` + `packages/kosong` de Spectre
- **`packages/cli`** es el equivalente de `apps/kimi-code/src/tui`
- El patrón de 4 capas se mantiene: **Service** → **system prompt** → **Tool** → **slash command**
- Variables de template en system prompt: cambiar prefijo `KIMI_` → `AXE_`
- Directorio de datos: `~/.spectre/` → `~/.axe/`
