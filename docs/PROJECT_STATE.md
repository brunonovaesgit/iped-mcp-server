# IPED MCP — Estado do Projeto

## Estado resumido
O launcher já foi validado ponta a ponta quando executado pelo fluxo de desenvolvimento: seleção do IPED, seleção do caso, inicialização da Web API, confirmação de /sources e abertura da interface. O problema conhecido prioritário é que as versões .app testadas pelo mantenedor não abriram de forma confiável com dois cliques no Finder; funcionaram pelo Terminal.

A arquitetura é deliberadamente read-only: o MCP consulta um caso já processado pelo IPED. Não existe e não deve ser criado fluxo de ingestão de evidência via POST.

## Launcher
Histórico relevante:
- diagnóstico do launcher;
- correção para java -jar lib/iped-webapi.jar;
- validação de caso por index/data;
- porta local dinâmica;
- retry em colisão de porta;
- suporte a /sources retornando array ou {data:[...]}.
Um teste real confirmou /sources com o caso "resultado" e a UI mostrou IPED conectado.

## Resposta investigativa
A resposta direta determinística para listagens pode apresentar Item, Tipo, Caminho e Referência. O tipo prefere metadados IPED (Content-Type/contentType/type), usando extensão apenas como fallback.
Quando a busca é limitada/truncada, a UI deve explicitar resposta parcial.

## Proveniência implementada
Há navegação read-only para evidência a partir de:
- resposta direta;
- observações de síntese;
- findings;
- ambiguidades de retrieval;
- findings assistidos por IA;
- leads/correlações;
- nós/relações do grafo;
- timeline;
- painel principal de evidência.
A referência fundamental usa sourceId/itemId.

## Grafo
Comportamento implementado:
- painel visual full-width;
- sem max-height normal restritivo;
- layouts automáticos aproximados: <=18 radial, <=60 grid, >60 wide;
- layouts manuais: Radial, Grade, Ampla, Evidências × entidades;
- canvas lógico proporcional, sem node cap;
- zoom comum aproximadamente 0.35–2.5 e fit-to-view podendo reduzir mais;
- SVG redimensiona dimensões renderizadas mantendo viewBox lógico estável para permitir scroll sem clipping;
- Ctrl/Cmd+wheel zoom;
- drag do canvas para pan/scroll;
- clique em nó destaca vizinhança;
- detalhe de nó/aresta permite navegar para evidência;
- busca não destrutiva por label/kind/entityType;
- match único centraliza; múltiplos usam seletor; Enter percorre; Escape limpa;
- seletor distingue tipo do nó;
- minimapa completo/clicável, overlay persistente, retângulo de viewport sincronizado;
- fullscreen inclui shell + minimapa;
- layout Evidências × entidades usa lanes adaptativas por tipo forense com rótulos;
- CSS de impressão/PDF evita clipping e tenta escalar o grafo completo.

Não regredir esses comportamentos ao corrigir o launcher.

## Timeline
Timeline expandida foi deduplicada e passou a usar ordenação cronológica global. Eventos permitem navegação à evidência.

## Cliente IPED
O cliente de busca suporta limite solicitado e metadados de truncamento/total disponível. A investigação recupera propriedades, texto, entidades e comunicação, além de nome/path/fileType/hash/timeline. Constrói entidades recorrentes, participantes, links cross-evidence, duplicatas, grafo e timeline.

## Testes existentes
O repositório contém suites para analyzer de IA, configuração, graph, sessions, HTTP/UI, service/view, IPED client e security boundaries. Rode a suite completa antes de considerar uma mudança pronta.

## Packaging
O workflow de package monta app macOS arm64, inclui Node darwin-arm64, dist, node_modules/package e faz ad-hoc codesign. O nome público foi alterado para IPED MCP / IPED-MCP / iped-mcp.
O problema de duplo clique deve ser reproduzido e corrigido localmente no macOS antes de depender do workflow.

## GitHub Actions
Muitas merges rápidas geraram uma fila grande de CI/package. Foi adicionada concurrency com cancel-in-progress em CI e package. Não usar Actions como loop de desenvolvimento.

## Decisões de produto
- Produto público: IPED MCP.
- macOS primeiro; outros sistemas depois.
- facilidade de instalação/uso é requisito de adoção.
- o perito deve conseguir selecionar a pasta correta e receber validação clara.
- grafo é essencial.
- não recriar processamento que o IPED já executa bem.
- evolução comercial deve concentrar-se na camada investigativa, proveniência, governança e experiência.

## Critério de pronto da prioridade atual
Não declarar o launcher macOS pronto apenas porque compila ou roda no Terminal.
Pronto significa: pacote .app gerado localmente, iniciado pelo Finder/LaunchServices sem shell interativo, onboarding funcional, IPED selecionado, caso validado e interface aberta/conectada. Se alguma etapa exigir interação humana inevitável (por exemplo, Gatekeeper), documentar precisamente o comportamento e minimizar o atrito.
