import type { Claim } from "./claims.js";
import type { InvestigationNote, StoredInvestigation } from "./investigation-store.js";
import type { EvidenceReference } from "./iped-client.js";

/**
 * Draft investigation report. The output is a standalone HTML document that
 * opens in any browser (print or save as PDF) and in Word or LibreOffice for
 * editing. It is a draft for the examiner to review: it restates what the
 * examiner recorded and what IPED returned, and adds no new conclusions.
 */

export interface ReportEvidence extends EvidenceReference {
  name?: string;
  path?: string;
  hash?: string;
  bookmarks?: string[];
  found: boolean;
}

export interface ReportAuditEntry {
  timestamp: string;
  action: string;
  details?: string;
}

export interface ReportInput {
  record: StoredInvestigation;
  evidence: ReportEvidence[];
  audit: ReportAuditEntry[];
  generatedAt: string;
}

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string
  );

const CLAIM_GROUPS: Array<[Claim["classification"], string]> = [
  ["FACT", "Fatos"],
  ["INFERENCE", "Inferências"],
  ["HYPOTHESIS", "Hipóteses"]
];
const BASIS: Record<string, string> = {
  DOCUMENT_STATEMENT: "declaração em documento",
  OBSERVED_METADATA: "metadado observado"
};

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
}

/** Collects every evidence reference mentioned by the investigation, claims and notes. */
export function collectReferences(record: StoredInvestigation, sourceIds: string[]): EvidenceReference[] {
  const seen = new Map<string, EvidenceReference>();
  const add = (ref: EvidenceReference | undefined) => {
    if (!ref || typeof ref.sourceId !== "string" || !Number.isInteger(Number(ref.itemId))) return;
    const normalized = { sourceId: ref.sourceId, itemId: Number(ref.itemId) };
    seen.set(`${normalized.sourceId}:${normalized.itemId}`, normalized);
  };
  const workspace = record.workspace as { panels?: { evidence?: EvidenceReference[] } } | undefined;
  (workspace?.panels?.evidence ?? []).forEach(add);
  for (const claim of record.claims ?? []) {
    claim.supporting.forEach(add);
    claim.contradicting.forEach(add);
  }
  for (const note of record.notes ?? []) noteReferences(note.text, sourceIds).forEach(add);
  return [...seen.values()];
}

export function noteReferences(text: string, sourceIds: string[]): EvidenceReference[] {
  const refs: EvidenceReference[] = [];
  for (const sourceId of sourceIds) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${sourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)(?![A-Za-z0-9_])`, "g");
    for (const match of text.matchAll(pattern)) refs.push({ sourceId, itemId: Number(match[2]) });
  }
  return refs;
}

function evidenceLabel(ref: EvidenceReference, byKey: Map<string, ReportEvidence>): string {
  const key = `${ref.sourceId}:${ref.itemId}`;
  const item = byKey.get(key);
  if (!item?.found) return `<span class="missing">${esc(key)} (não encontrada no caso)</span>`;
  return `<code>${esc(key)}</code>${item.name ? ` ${esc(item.name)}` : ""}`;
}

function claimsSection(claims: Claim[], byKey: Map<string, ReportEvidence>): string {
  if (!claims.length) {
    return `<p class="empty">Nenhuma afirmação foi registrada no quadro de afirmações.</p>`;
  }
  return CLAIM_GROUPS.map(([kind, title]) => {
    const group = claims.filter(claim => claim.classification === kind);
    if (!group.length) return "";
    return `<h3>${title}</h3><ol class="claims">${group
      .map(claim => {
        const v = claim.verification;
        const list = (refs: EvidenceReference[]) =>
          refs.length ? `<ul>${refs.map(ref => `<li>${evidenceLabel(ref, byKey)}</li>`).join("")}</ul>` : `<p class="empty">Nenhuma.</p>`;
        return `<li class="claim">
  <p class="statement">${esc(claim.statement)}</p>
  ${claim.factBasis ? `<p class="meta">Base do fato: ${esc(BASIS[claim.factBasis] ?? claim.factBasis)}</p>` : ""}
  <p class="label">Evidências a favor</p>${list(claim.supporting)}
  ${claim.contradicting.length ? `<p class="label">Evidências contra</p>${list(claim.contradicting)}` : ""}
  ${claim.limitation ? `<p class="meta">Limitação: ${esc(claim.limitation)}</p>` : ""}
  ${
    v
      ? `<p class="check">Verificação estrutural em ${esc(formatDate(v.checkedAt))}: ${
          v.referencesVerified ? "todas as referências foram encontradas no caso" : "há referências não encontradas no caso"
        }; ${esc(v.independentSupportingCount)} evidência(s) independente(s) a favor de ${esc(v.supportingCount)} confirmada(s).</p>${
          v.warnings.length ? `<ul class="warnings">${v.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""
        }`
      : ""
  }
</li>`;
      })
      .join("")}</ol>`;
  }).join("");
}

function notesSection(notes: InvestigationNote[]): string {
  if (!notes.length) return `<p class="empty">Nenhuma nota foi registrada no caderno de análise.</p>`;
  return notes
    .map(
      note => `<div class="note"><p class="meta">${esc(formatDate(note.createdAt))}${
        note.updatedAt !== note.createdAt ? ` · editada em ${esc(formatDate(note.updatedAt))}` : ""
      }</p><p class="noteText">${esc(note.text)}</p></div>`
    )
    .join("");
}

export function buildReportHtml(input: ReportInput): string {
  const { record, evidence, audit, generatedAt } = input;
  const workspace = (record.workspace ?? {}) as {
    analysis?: { headline?: string; observations?: Array<{ text?: string; evidence?: EvidenceReference[] }>; communication?: string; limitation?: string };
    panels?: {
      retrievalAmbiguities?: Array<{ description?: string; candidates?: Array<{ value?: string; evidence?: EvidenceReference[] }> }>;
      valueVariations?: Array<{ type?: string; description?: string }>;
    };
  };
  const byKey = new Map(evidence.map(item => [`${item.sourceId}:${item.itemId}`, item]));
  const analysis = workspace.analysis ?? {};
  const ambiguities = workspace.panels?.retrievalAmbiguities ?? [];
  const variations = workspace.panels?.valueVariations ?? [];
  const followUps = record.questions.slice(1);
  const lastActivity = [
    record.updatedAt,
    ...(record.notes ?? []).map(note => note.updatedAt),
    ...(record.claims ?? []).flatMap(claim => [claim.updatedAt, claim.verification?.checkedAt ?? ""])
  ]
    .filter(Boolean)
    .sort()
    .at(-1);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Rascunho de relatório · ${esc(record.title.slice(0, 80))}</title>
<style>
  body{font-family:Georgia,"Times New Roman",serif;color:#1c1c1c;max-width:820px;margin:40px auto;padding:0 28px;line-height:1.55;font-size:15px}
  h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:34px 0 10px;padding-bottom:4px;border-bottom:1px solid #ccc}h3{font-size:15.5px;margin:20px 0 6px}
  .draft{border:2px solid #b45309;color:#7c2d12;background:#fff7ed;padding:10px 14px;font-family:system-ui,sans-serif;font-size:13.5px;margin:16px 0}
  .meta{color:#555;font-size:13px;margin:2px 0}.label{font-weight:bold;margin:8px 0 2px;font-size:13.5px}.empty{color:#666;font-style:italic}
  .statement{font-weight:bold;margin:0 0 4px}.check{font-size:13px;color:#333;margin:8px 0 2px}.warnings{color:#7c2d12;font-size:13px}
  .claims>li{margin-bottom:16px}.note{border-left:3px solid #999;padding:2px 0 2px 12px;margin:12px 0}.noteText{white-space:pre-wrap;margin:4px 0}
  .missing{color:#a33a2a;text-decoration:line-through}code{font-family:Menlo,Consolas,monospace;font-size:12.5px;background:#f2f2f2;padding:1px 4px}
  table{border-collapse:collapse;width:100%;font-size:12.5px;font-family:system-ui,sans-serif}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f2f2f2}
  .questions li{margin:4px 0}footer{margin-top:40px;font-size:12px;color:#666}
  @media print{body{margin:0;max-width:none}.draft{break-inside:avoid}h2{break-after:avoid}}
</style>
</head>
<body>
<h1>Rascunho de relatório de análise</h1>
<p class="meta">Gerado pelo IPED MCP em ${esc(formatDate(generatedAt))} (horário de Brasília)</p>
<p class="meta">Fonte do caso: ${esc(record.sourceId ?? "não informada")} · Investigação ${esc(record.id)}</p>
<p class="meta">Iniciada em ${esc(formatDate(record.createdAt))} · última atividade em ${esc(formatDate(lastActivity))}</p>
<div class="draft"><strong>RASCUNHO — requer revisão do perito.</strong> Este documento reúne o que foi registrado na investigação e o que o IPED retornou. Ele não substitui o laudo, não valida o conteúdo das evidências e não acrescenta conclusões. Toda afirmação deve ser conferida nos itens citados.</div>

<h2>1. Pergunta investigativa</h2>
<p>${esc(record.questions[0] ?? record.title)}</p>
${followUps.length ? `<p class="label">Perguntas de acompanhamento</p><ol class="questions">${followUps.map(q => `<li>${esc(q)}</li>`).join("")}</ol>` : ""}

<h2>2. Achados observados</h2>
${analysis.headline ? `<p>${esc(analysis.headline)}</p>` : `<p class="empty">Sem síntese registrada.</p>`}
${(analysis.observations ?? [])
  .map(obs => `<p>${esc(obs.text)}${obs.evidence?.length ? ` <span class="meta">(${obs.evidence.map(ref => esc(`${ref.sourceId}:${ref.itemId}`)).join(", ")})</span>` : ""}</p>`)
  .join("")}
${analysis.communication ? `<p>${esc(analysis.communication)}</p>` : ""}
${
  ambiguities.length
    ? `<h3>Ambiguidades na busca</h3>${ambiguities
        .map(group => `<p>${esc(group.description)}</p><ul>${(group.candidates ?? [])
          .map(c => `<li>${esc(c.value)} — ${(c.evidence ?? []).map(ref => `<code>${esc(`${ref.sourceId}:${ref.itemId}`)}</code>`).join(" ")}</li>`)
          .join("")}</ul>`)
        .join("")}`
    : ""
}
${variations.length ? `<h3>Variações de valor observadas</h3><ul>${variations.map(v => `<li>${esc(v.type)}: ${esc(v.description)}</li>`).join("")}</ul>` : ""}
${analysis.limitation ? `<p class="meta">${esc(analysis.limitation)}</p>` : ""}

<h2>3. Afirmações</h2>
<p class="meta">A verificação de cada afirmação é estrutural: confirma que os itens citados existem no caso e trata conteúdo idêntico (mesmo hash) como uma única fonte. Ela não avalia se o conteúdo prova a afirmação.</p>
${claimsSection(record.claims ?? [], byKey)}

<h2>4. Caderno de análise</h2>
${notesSection(record.notes ?? [])}

<h2>5. Evidências referenciadas</h2>
${
  evidence.length
    ? `<table><thead><tr><th>Referência</th><th>Nome</th><th>Caminho</th><th>Hash</th><th>Marcadores do IPED</th></tr></thead><tbody>${evidence
        .map(item =>
          item.found
            ? `<tr><td><code>${esc(`${item.sourceId}:${item.itemId}`)}</code></td><td>${esc(item.name)}</td><td>${esc(item.path)}</td><td>${esc(item.hash)}</td><td>${esc((item.bookmarks ?? []).join(", "))}</td></tr>`
            : `<tr><td><code>${esc(`${item.sourceId}:${item.itemId}`)}</code></td><td colspan="4" class="missing">Não encontrada no caso no momento da geração.</td></tr>`
        )
        .join("")}</tbody></table>`
    : `<p class="empty">Nenhuma evidência referenciada.</p>`
}

<h2>6. Rastreabilidade</h2>
<p class="meta">Operações registradas no log de auditoria do IPED MCP para esta investigação.</p>
${
  audit.length
    ? `<table><thead><tr><th>Data e hora</th><th>Operação</th><th>Detalhes</th></tr></thead><tbody>${audit
        .map(entry => `<tr><td>${esc(formatDate(entry.timestamp))}</td><td>${esc(entry.action)}</td><td>${esc(entry.details)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="empty">Nenhuma operação encontrada no log de auditoria.</p>`
}

<h2>7. Limitações</h2>
<ul>
  <li>Os achados derivam do que o IPED indexou e extraiu; itens não processados ou não indexados não aparecem.</li>
  <li>Valores repetidos, participantes de comunicação e caminhos entre itens são observações para correlação, não prova de identidade ou de relação.</li>
  <li>Datas de sistema de arquivos não equivalem a datas de eventos sem evidência adicional.</li>
  <li>A verificação das afirmações é estrutural e não semântica.</li>
  <li>Análises assistidas por IA, quando existentes, são derivadas e devem ser validadas nas evidências citadas.</li>
</ul>
<footer>Documento gerado automaticamente pelo IPED MCP a partir de dados do IPED e de registros do perito. Contém nomes, caminhos, hashes, valores extraídos pelo IPED e anotações do perito: trate-o com o mesmo cuidado dispensado ao caso.</footer>
</body>
</html>`;
}
