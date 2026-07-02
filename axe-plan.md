# Axe — Plan de ejecución

Fork de [qwen-code](https://github.com/QwenLM/qwen-code) con rename completo a `axe` y port de features de Spectre (fork previo de kimi-code).

**Fuente de features:** `spectre-features-port-guide.md`
**Excluido:** Context7 (ya cubierto por MCP server externo)

---

## Fase 0 — Setup inicial

> **Gestor de paquetes:** npm para install (workspace hoisting requerido por tsc). `bun` disponible para correr scripts (`bun run dev`, etc.)

- [x] Clonar qwen-code como base del fork
- [x] Crear commit inicial (`chore: initial qwen-code import`)
- [ ] `npm install` — instalar dependencias (npm real, no el shim de bun)

---

## Fase 1 — Rename: qwen → axe

Cambios de identidad: binario, directorio global, directorio de proyecto, env vars, package names.

### 1.1 Punto central del nombre de directorio

- [ ] `packages/core/src/utils/paths.ts` — `QWEN_DIR = '.qwen'` → `'.axe'`

### 1.2 Variables de entorno

- [ ] `packages/core/src/config/storage.ts`
  - `QWEN_HOME` → `AXE_HOME`
  - `QWEN_RUNTIME_DIR` → `AXE_RUNTIME_DIR`
  - `SKILL_PROVIDER_CONFIG_DIRS = ['.qwen', ...]` → `['.axe', ...]`
  - Fallback `'.qwen'` en tmpdir → `'.axe'`

### 1.3 Binario CLI

- [ ] `package.json` raíz — `"bin": { "qwen": ... }` → `"axe"`
- [ ] `packages/cli/package.json` — `"bin": { "qwen": ... }` → `"axe"`
- [ ] `packages/core/package.json` — `"name"` y referencias `@qwen-code/...`

### 1.4 Package names (monorepo)

- [ ] `package.json` raíz — `"name": "@qwen-code/qwen-code"` → `"@axe/axe"`
- [ ] `packages/cli/package.json` — `"name"` → `"@axe/cli"`
- [ ] `packages/core/package.json` — `"name"` → `"@axe/core"`
- [ ] Actualizar cross-references entre paquetes en todos los `package.json`

### 1.5 Strings en código fuente

- [ ] `packages/cli/src/` — referencias al comando `qwen` en strings visibles al usuario
- [ ] `packages/core/src/` — referencias a `~/.qwen` en strings de tool descriptions / docstrings expuestos al modelo
- [ ] `integration-tests/` — referencias al binario `qwen` en los test runners

### 1.6 AGENTS.md y docs internas

- [ ] `AGENTS.md` — actualizar referencias al comando `qwen` y directorio `.qwen`
- [ ] `README.md` — cosmético, actualizar nombre y referencias de instalación

### 1.7 Scripts y esbuild

- [ ] `scripts/cli-entry.js` — comentarios internos
- [ ] `esbuild.config.js` — verificar que no hardcodea `qwen`
- [ ] `scripts/` generales — verificar referencias al binario

### 1.8 Verificación post-rename

- [ ] `npm run build` — sin errores de compilación
- [ ] `npm run typecheck` — sin errores de tipos
- [ ] Smoke test: `node packages/cli/dist/index.js --version` responde como `axe`

---

## Fase 2 — Tool input repair layer

**Referencia:** Spectre `spectre-features-port-guide.md` §5
**Por qué primero:** Qwen malforma tool-calls; esto es la base para que todo lo demás funcione bien.

Mapeo de archivos (Spectre → axe):
- `packages/agent-core/src/tools/args-repair.ts` → `packages/core/src/tools/args-repair.ts`
- `packages/agent-core/src/loop/tool-call.ts` (integración) → localizar el equivalente en `packages/core/src/`

### Tasks

- [ ] Localizar en `packages/core/src/` dónde se validan y ejecutan tool-calls (equivalente de `loop/tool-call.ts`)
- [ ] Crear `packages/core/src/tools/args-repair.ts` con las 4 reparaciones:
  - `stripNullOptionals` — `null` en campos opcionales
  - `parseStringifiedJson` — string que empieza `[`/`{` donde se espera array/obj
  - `wrapBareStringToArray` — string donde se espera array
  - `unwrapObjectToArray` — `{"0":"a","1":"b"}` donde se espera array
- [ ] Integrar `repairToolArgs(args, ajvErrors)` en el loop de ejecución de tools (solo cuando falla validación — fast path)
- [ ] Unit tests para los 4 casos de reparación
- [ ] Verificar que el repair se loguea/trackea (telemetría o al menos un `logger.debug`)

---

## Fase 3 — Fix JSON Schema en tool params

**Referencia:** Spectre `spectre-features-port-guide.md` §6
**Por qué acá:** Fix puntual, bajo riesgo, elimina rechazos de gateways OpenAI-compatible.

Mapeo:
- `packages/kosong/src/providers/openai-common.ts` → localizar la capa de generación de ContentGenerator/tool schema en `packages/core/src/`

### Tasks

- [ ] Localizar en `packages/core/src/` dónde se serializa el schema de tools para la API (equivalente de `openai-common.ts`)
- [ ] Implementar `ensureObjectRootParameters(params)` — si no tiene campo `type`, prepende `type: "object"`
- [ ] Aplicar en los wires OpenAI-compatible (no en Anthropic)
- [ ] Smoke test: verificar que tool-calls llegan bien formadas contra un gateway OpenAI-compatible

---

## Fase 4 — SDD + KnowledgeService

**Referencia:** Spectre `spectre-features-port-guide.md` §1
**Qué es:** Flujo Spec-Driven Development de 8 pasos en el system prompt + OKF en disco + KnowledgeService que indexa `sdd/` + Tool `Knowledge` + slash commands `/sdd-setup` y `/sdd-status`.

Mapeo:
- `packages/agent-core/src/profile/default/system.md` → system prompt en `packages/core/src/core/prompts.ts` o archivo `.md` equivalente
- `packages/agent-core/src/services/knowledge/` → `packages/core/src/services/knowledge/`
- `packages/agent-core/src/tools/builtin/knowledge/` → `packages/core/src/tools/knowledge/`
- `apps/kimi-code/src/tui/commands/sdd.ts` → `packages/cli/src/ui/commands/sdd.ts`

### Tasks

- [ ] Localizar dónde vive el system prompt principal en `packages/core/src/`
- [ ] Agregar el harness SDD de 8 pasos al system prompt (con render condicional si no hay `sdd/`)
- [ ] Definir el formato OKF (tipos `Proposal`, `Decision`, `Task`, frontmatter YAML)
- [ ] Crear `packages/core/src/services/knowledge/knowledgeService.ts` — camina hasta `sdd/`, parsea frontmatter, genera summary
- [ ] Crear types e interfaz (`IKnowledgeService`)
- [ ] Conectar el summary al system prompt como variable de template (`{{ AXE_KNOWLEDGE }}`)
- [ ] Crear tool `Knowledge` en `packages/core/src/tools/knowledge/` — búsqueda línea-a-línea, schema `{ query, type? }`
- [ ] Cablear en la sesión: inicializar KnowledgeService antes de renderizar el prompt
- [ ] Crear slash command `/sdd-setup` en `packages/cli/src/ui/commands/sdd.ts` — scaffolding del bundle OKF
- [ ] Crear slash command `/sdd-status` — verifica core files + `AGENTS.md`
- [ ] Registrar los slash commands en el registry
- [ ] Tests unitarios para `knowledgeService` (parseo de frontmatter, generación de summary)

---

## Fase 5 — Reference tool

**Referencia:** Spectre `spectre-features-port-guide.md` §2
**Qué es:** El modelo busca en el código fuente real de las deps instaladas (git clone > node_modules > npm pack). Almacena en `~/.axe/references/`.

Mapeo:
- `packages/agent-core/src/services/reference/` → `packages/core/src/services/reference/`
- `packages/agent-core/src/tools/builtin/reference/` → `packages/core/src/tools/reference/`
- `packages/agent-core/src/project/detect.ts` → `packages/core/src/project/detect.ts`
- `packages/agent-core/src/project/dependencies.ts` → `packages/core/src/project/dependencies.ts`
- `apps/kimi-code/src/tui/commands/references.ts` → `packages/cli/src/ui/commands/references.ts`

### Tasks

- [ ] Crear `packages/core/src/project/detect.ts` — `findProjectRoot`, `detectMonorepo` (pnpm/turbo/nx/lerna/npm/yarn/bun), `getActiveWorkspace`
- [ ] Crear `packages/core/src/project/dependencies.ts` — parseo de deps, pinning de versiones, exclusión de devDeps/workspace:/file:/git+
- [ ] Crear `packages/core/src/services/reference/referenceService.ts`:
  - Pipeline git-first: git clone → node_modules local → npm pack
  - Storage en `~/.axe/references/manifest.json` + dirs por `<pkg>/<ver>`
  - Cap 50MB, concurrencia background 3, dedup via `inFlight`
  - Monorepo-aware (`scanDirs` con workspace activo primero)
- [ ] Crear tool `Reference` — input `{ package, query }`, búsqueda ripgrep OR-tokenizada
  - `buildSearchPattern` — multi-word → OR regex
  - spawn ripgrep `--json -S --max-count 25`
  - Cap `MAX_SEARCH_RESULTS = 40`, timeout 10s
  - `writeEmptyExplanation` para 0 resultados (4 casos)
- [ ] Wiring de arranque no bloqueante: `initialize(cwd)` + `warmupPromise` + `injectReferencesWhenWarm()`
- [ ] Inyectar summary en system prompt como `{{ AXE_REFERENCES }}`
- [ ] Crear slash command `/references` en `packages/cli/src/ui/commands/references.ts`:
  - Panel con estados `✓` / `○` / `✗`, columnas `pkg@ver | files | size | source`
  - `/references refresh [pkg]` — con diálogo de confirmación
  - `/references clear [pkg]`
- [ ] Tests unitarios para `buildSearchPattern` y `resolveDependencyVersion`

---

## Fase 6 — Subagent profiles + stack

**Referencia:** Spectre `spectre-features-port-guide.md` §3
**Prerequisito:** Verificar si qwen-code ya tiene un mecanismo de subagent profiles antes de implementar.

### Tasks

- [ ] Auditar `packages/core/src/` — ¿existe ya un sistema de profiles/subagents?
- [ ] Si existe: mapear los profiles de Spectre al sistema existente
- [ ] Si no existe: diseñar el mecanismo mínimo (YAML profiles con `extends`, `tools`, `promptVars`)
- [ ] Crear profiles: `agent`, `coder`, `explore`, `plan`
- [ ] Crear profile `stack` — tools: `WebSearch, FetchURL, Read, Glob, Grep, Reference, Knowledge`. Prompt: research de libs/versiones/compatibilidad, grounding contra lockfiles reales, no editar archivos
- [ ] Resolver cadena `extends` en `resolveAgentProfiles()`
- [ ] Tests de resolución de profiles

---

## Notas de arquitectura

- **`packages/core`** es el equivalente de `packages/agent-core` + `packages/kosong` de Spectre
- **`packages/cli`** es el equivalente de `apps/kimi-code/src/tui`
- El patrón de 4 capas se mantiene: **Service** → **system prompt** → **Tool** → **slash command**
- Variables de template en system prompt: cambiar prefijo `KIMI_` → `AXE_`
- Directorio de datos: `~/.spectre/` → `~/.axe/`
