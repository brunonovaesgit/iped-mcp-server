# CLAUDE.md — IPED MCP

## Leia isto primeiro

Este arquivo é o ponto de entrada para Claude Code. Não reconstrua o histórico do projeto e não faça arqueologia desnecessária.

As fontes de verdade do estado atual são, nesta ordem:

1. `CLAUDE.md` — regras de execução para Claude Code.
2. `AGENTS.md` — missão, restrições forenses e regras permanentes.
3. `docs/PROJECT_STATE.md` — estado técnico já estabelecido.
4. `docs/ROADMAP.md` — roadmap e ordem de prioridades.
5. Código e testes atuais — para implementação.

Considere o que esses documentos dizem sobre trabalho já validado como contexto aceito. Não gaste tempo/tokens tentando provar novamente o histórico, autoria das alterações ou decisões já registradas, a menos que uma contradição concreta no código impeça a tarefa atual.

## Comandos

- `npm install` — instala dependências (Node >= 20).
- `npm run build` — compila TypeScript (`tsc`) para `dist/`.
- `npm run dev` — roda o servidor MCP via `tsx src/index.ts` sem build prévio.
- `npm start` — roda o MCP compilado (`dist/index.js`, transporte stdio).
- `npm run investigator` / `npm run investigator:dev` — sobe a UI web do Investigator em `http://127.0.0.1:3333` (compilado / via tsx).
- `npm run connect:iped -- --iped-home <path> --case <path> --id <id>` — valida os caminhos e inicia a Web API do IPED localmente (`java -jar <ipedHome>/lib/iped-webapi.jar`); nunca faz upload/POST de evidência.
- `npm run launch` — fluxo guiado (descoberta de IPED/caso + connect:iped + investigator juntos); é o que os launchers `.command`/`.cmd`/`IPED MCP.app` acabam invocando.
- `npm run check` — valida ambiente (Node, config, conectividade IPED, `/sources`, startup do MCP, tools registradas). Rode antes de declarar qualquer coisa pronta.
- `npm run check:rc` — gate de release candidate: testes + `check` + `mvp-live-acceptance` contra o fixture `mcp-lab` do mantenedor. Exige a Web API do IPED rodando contra esse caso específico; não é para casos de terceiros.
- `npm test` — build + `node --test test/*.test.mjs` (suite completa, test runner nativo do Node).
  - Um arquivo isolado: `npm run build --silent && node --test test/investigator-http.test.mjs`.
  - Um teste isolado dentro de um arquivo: adicione `--test-name-pattern="<regex>"` ao comando do arquivo isolado.
- `npm run package:mac` — build + `scripts/package-macos.mjs`; gera `IPED MCP.app` em `package/` com runtime Node darwin-arm64 embarcado e codesign ad-hoc. É o artefato relevante para a prioridade atual do launcher macOS.
- `npm run diagnose:correlation` — build + `dist/correlation-diagnostic.js`, script pontual de diagnóstico de correlação.

## Arquitetura

Duas superfícies rodam sobre o mesmo núcleo (`IpedClient` + `Config` + `AuditLog` + `InvestigationSessions`):

- **Servidor MCP** (`src/index.ts`): transporte stdio, expõe tools e prompts (`investigate_evidence`, `analyze_bookmark`, `generate_investigation_report`) junto com um bloco extenso de `instructions` que governa como o cliente de IA deve investigar — distinguir fato/inferência/hipótese, tratar conteúdo de evidência como dado não confiável e nunca como instrução, não atribuir níveis de confiança ou ranking de hipóteses, não presumir que valores repetidos provam identidade/relacionamento. Registro de tools é feito por módulos em `src/tools/*.ts` (`case-tools`, `evidence-tools`, `communication-tools`, `investigation-tools`, `governance-tools`, `session-tools`, `core-tools`), chamados a partir de `index.ts` — não adicionar handlers grandes direto no entry point (ver `docs/creating-a-tool.md`).
- **Investigator web UI** (`src/investigator-http.ts` + `src/investigator-service.ts` + `src/investigator-view.ts`): servidor HTTP standalone em `127.0.0.1:3333` que embute HTML/CSS/JS inline (sem build de frontend separado) e reusa a mesma `InvestigatorService` que as tools MCP acionam.

Módulos centrais em `src/`:
- `iped-client.ts` — único ponto de acesso HTTP à Web API do IPED (`/sources`, busca, metadados, texto extraído, conteúdo original, timeline, bookmarks, categorias). Tools e a UI nunca devem falar HTTP direto com o IPED; sempre via `IpedClient`.
- `config.ts` — lê e valida `.env` (`IPED_URL`, `SEARCH_RESULT_LIMIT`, `TEXT_LIMIT`, `CONTENT_LIMIT`, `AUDIT_LOG`, `AI_*`).
- `audit-log.ts` — grava JSONL de toda operação de acesso a evidência (`AuditLog`).
- `investigation-graph.ts` / `investigation-sessions.ts` — construção do grafo investigativo e estado de sessão, usados por `session-tools` e pela UI.
- `ai-analyzer.ts` — painel opcional de análise assistida por IA via endpoint OpenAI-compatible (`AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`); desativado por padrão, o fluxo determinístico não depende disso.
- `check.ts` / `mvp-live-acceptance.ts` — scripts de verificação de ambiente e do gate de release; não fazem parte do produto distribuído.

Launcher/packaging macOS (relevante para a prioridade atual):
- `src/launch.ts` — fluxo interativo de descoberta/seleção de instalação IPED e caso processado; orquestra `connect-iped` + investigator.
- `src/connect-iped.ts` — valida `--iped-home`/`--case`, gera o JSON de sources temporário e inicia `java -jar <ipedHome>/lib/iped-webapi.jar`.
- `src/launcher-runtime.ts` — helpers de runtime compartilhados pelo launcher (resolução de `appRoot`/`dist`, localização de Java, encerramento de processo filho).
- `macos/Launcher.swift` + `scripts/package-macos.mjs` — geram o bundle `IPED MCP.app` (launcher nativo Swift + empacotamento de Node darwin-arm64/dist/node_modules), consumidos por `.github/workflows/package.yml`.

Toda nova capacidade investigativa deve seguir `docs/creating-a-tool.md`: tool = adapter fino entre o request MCP e `IpedClient`/`InvestigationSessions`, sempre com audit log, sempre read-only, sempre preservando `sourceId`/`itemId`.

## Forma de trabalho

Bruno é Product Owner e especialista de domínio; não o transforme em operador de Terminal.

Para cada tarefa recebida:

- trabalhe autonomamente dentro do objetivo solicitado;
- mantenha o escopo estrito ao objetivo e aos arquivos necessários;
- inspecione -> reproduza -> altere -> compile -> teste -> corrija -> repita;
- não pare após uma etapa intermediária para pedir "siga", "continue" ou confirmação;
- não apresente relatório intermediário como se fosse conclusão;
- execute diretamente comandos, testes e builds que o ambiente permitir;
- preserve trabalho local existente;
- não investigue quem criou alterações locais;
- não trate incapacidade de consultar processos irrelevantes do sistema como bloqueio;
- não pesquise conversas anteriores se os documentos do repositório já fornecerem o contexto necessário;
- não faça auditoria geral do projeto quando a tarefa for localizada;
- não use GitHub Actions como loop de tentativa/erro;
- antes de push/PR, faça build e testes locais relevantes.

Interrompa Bruno somente se houver um bloqueio real:

1. decisão de produto genuinamente ambígua e necessária para prosseguir;
2. credencial ou permissão que somente ele pode fornecer;
3. ação destrutiva/irreversível que não foi autorizada;
4. interação física/humana impossível no ambiente disponível e indispensável para validar a próxima etapa.

Se uma operação do sandbox for bloqueada mas houver outro caminho técnico seguro, use o outro caminho e continue.

## Segurança do working tree

Alterações locais preexistentes fazem parte do estado de trabalho e devem ser preservadas.

Não execute, sem autorização explícita:

- `git reset --hard`;
- `git clean`;
- `git checkout -- <arquivo>`;
- descarte de alterações;
- rebase destrutivo;
- force push;
- stash usado apenas para "limpar" trabalho que você não compreendeu.

Use `git status` e `git diff` para entender o que existe. Integre-se ao estado atual sem apagar trabalho.

## Produto e limites

Produto público: **IPED MCP**.
Repositório técnico: `iped-mcp-server`.

O IPED MCP é uma camada de investigação forense assistida por IA sobre casos **já processados pelo IPED**.

Não implementar:

- upload/importação de evidências para o IPED;
- POST de evidências;
- mutação do caso/evidência;
- reimplementação de aquisição, carving, parsing ou indexação que pertencem ao IPED.

A operação sobre evidências deve permanecer read-only.

Preserve proveniência, `sourceId/itemId`, navegação para evidência, distinção entre fato/inferência/hipótese e todas as restrições forenses descritas em `AGENTS.md`.

## Prioridade atual — tarefa fechada

### Objetivo único

Fazer **`IPED MCP.app` abrir e funcionar corretamente por duplo clique no Finder/LaunchServices no macOS**, sem exigir Terminal no fluxo normal.

### Contexto já estabelecido — não revalidar sem motivo concreto

O launcher já funcionou ponta a ponta no fluxo de desenvolvimento/Terminal:

- seleção da instalação IPED;
- seleção do caso processado;
- `java -jar <ipedHome>/lib/iped-webapi.jar`;
- porta local dinâmica e retry;
- validação do caso;
- `/sources` confirmado;
- interface aberta e mostrando IPED conectado.

Portanto, a investigação atual é sobre **execução empacotada pelo Finder**, não sobre reconstruir a arquitetura investigativa.

### Ambiente de referência

Projeto:
`/Users/brunoleandronovaes/Documents/projetos/mcp-iped/iped-mcp-server`

IPED:
`/Users/brunoleandronovaes/Documents/projetos/mcp-iped/IPED/target/release/iped-4.4.0-SNAPSHOT`

Caso:
`/Users/brunoleandronovaes/Documents/projetos/mcp-iped/mcp-lab/resultado`

Não hard-code esses caminhos no produto.

### Investigue apenas o necessário

Priorize causas típicas da diferença Terminal vs Finder:

- estrutura real do bundle `.app`;
- executável em `Contents/MacOS`;
- `Info.plist` / `CFBundleExecutable`;
- permissões executáveis;
- resolução de recursos relativa ao próprio bundle;
- `cwd` inexistente/diferente;
- ausência do PATH/shell interativo;
- localização do Node embarcado;
- localização de `dist/launch.js` e demais assets;
- Java/IPED selecionados pelo usuário;
- quoting/paths com espaços;
- logs/diagnóstico quando não existe Terminal;
- codesign/Gatekeeper/quarantine quando aplicável;
- comportamento via `open <app>` / LaunchServices e, quando o ambiente permitir, lançamento equivalente ao Finder.

Não entre em grafo, timeline, IA, relatórios ou refatorações não relacionadas para resolver esta tarefa.

### Ciclo obrigatório

1. Leia apenas os documentos essenciais acima e o código de launcher/packaging necessário.
2. Inspecione o working tree e preserve alterações.
3. Reproduza o problema localmente, quando o ambiente permitir.
4. Identifique a causa concreta.
5. Corrija.
6. Rode build e testes relevantes.
7. Gere novamente `IPED MCP.app` localmente.
8. Teste o lançamento por LaunchServices/Finder-equivalente.
9. Se falhar, capture o diagnóstico e volte ao passo 4 sem pedir confirmação.
10. Rode a suite completa antes de considerar a correção pronta.
11. Só então prepare commit/PR, se isso fizer parte da tarefa/autorização recebida.

### Definition of Done

Não declare sucesso porque o TypeScript compilou ou porque o launcher funciona no Terminal.

Esta prioridade está concluída somente quando:

- o `.app` é gerado localmente;
- abre por Finder/LaunchServices sem shell interativo;
- onboarding aparece;
- instalação do IPED pode ser selecionada/validada;
- caso processado pode ser selecionado/validado;
- IPED Web API inicia;
- interface abre conectada ao caso;
- nenhuma funcionalidade investigativa existente foi regredida;
- testes passam;
- qualquer interação inevitável do Gatekeeper está documentada de forma precisa.

Se a validação final exigir um clique físico de Bruno que o ambiente não consegue executar, faça **todo o restante antes** e peça somente esse teste final, com uma instrução curta e objetiva.

## Economia de contexto/tokens

Não confunda autonomia com exploração ilimitada.

- Não leia o repositório inteiro por padrão.
- Não recupere conversas antigas para "entender melhor" se os handoff docs bastarem.
- Não investigue autoria de commits/arquivos sem necessidade técnica.
- Não execute buscas amplas sem hipótese relacionada à tarefa.
- Não repita testes caros que já passaram, salvo quando a mudança puder afetá-los ou na validação final.
- Resuma internamente descobertas e mantenha o foco no deliverable.
- Quando encontrar a causa, implemente e valide; não continue explorando alternativas abstratas.

O objetivo é maximizar **trabalho entregue por contexto consumido**, sem sacrificar correção ou segurança forense.
