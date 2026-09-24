# IPED MCP — Roadmap

## Visão
Transformar o IPED MCP de um conector/protótipo em um motor de investigação forense assistida por IA, mantendo o IPED como motor de processamento e fonte forense. A longo prazo, o núcleo investigativo pode aceitar outros conectores, sem tornar o IPED descartável ou duplicar suas capacidades.

## Épico 1 — Produto utilizável
Objetivo: experiência macOS confiável para um perito não desenvolvedor.
- Corrigir lançamento por duplo clique no Finder.
- Tornar runtime independente de PATH, cwd e shell.
- Validar descoberta/seleção do IPED.
- Validar seleção de raiz de caso e subpasta iped.
- Diagnósticos compreensíveis, sem exigir Terminal.
- Packaging reproduzível.
- Gatekeeper/codesign/notarização: definir estratégia de distribuição.
- Smoke test real com caso processado.
- Documentar instalação mínima.

Definition of Done: baixar/descompactar/abrir -> selecionar IPED -> selecionar caso -> investigar, sem comandos de Terminal no caminho normal.

## Épico 2 — Investigation Engine
Não copiar aquisição/processamento do AXIOM. Usar o IPED.
Fortalecer:
- busca investigativa;
- entidades e normalização;
- relações;
- timeline;
- grafo adaptativo para volumes grandes;
- correlação cross-evidence;
- findings/leads;
- perguntas em linguagem natural;
- separação fato/inferência/hipótese;
- provenance/evidence navigation transversal;
- avaliação de qualidade e regressão;
- tratamento de prompt injection/conteúdo hostil;
- modelos locais/offline e independência de fornecedor quando tecnicamente viável.

## Épico 3 — Produto profissional
- relatórios forenses e exportação defensável;
- audit trail completo de consultas, fontes, modelos e respostas;
- perfis/configuração de modelos;
- gestão de casos/sessões;
- templates de investigação;
- observabilidade e diagnósticos;
- atualização segura;
- Windows e Linux conforme demanda;
- documentação e treinamento.

## Épico 4 — Enterprise/Government
- deployment on-premise/air-gapped;
- RBAC/SSO;
- colaboração e segregação de casos;
- políticas de retenção/auditoria;
- gestão central de modelos;
- suporte/SLA;
- controles organizacionais e compliance.

## Épico 5 — Plataforma/conectores
Somente após estabilizar o núcleo.
Separar o Investigation Engine da implementação específica de IPED por uma interface de fonte forense. IPED continua como primeiro conector. Avaliar conectores adicionais (por exemplo Autopsy) com base em demanda e APIs reais.

## Não fazer agora
- Não reimplementar aquisição forense, carving, parsing ou indexação já resolvidos pelo IPED.
- Não criar ingestão de evidências no MCP.
- Não perseguir paridade total com Magnet AXIOM feature por feature.
- Não ampliar sistemas operacionais antes de estabilizar macOS.
- Não sacrificar proveniência por uma resposta de IA mais “bonita”.
- Não limitar grafos silenciosamente para mascarar problemas de layout/performance.

## Ordem imediata
1. Finder/double-click macOS.
2. Smoke test local real.
3. Robustez/regressão do Investigation Engine.
4. Relatórios + auditoria.
5. IA local/offline.
6. Produto profissional.
7. Outros conectores/plataformas.
