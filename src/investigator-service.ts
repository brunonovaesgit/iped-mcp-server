import type { AiAnalysis, AiAnalyzer } from "./ai-analyzer.js";
import type { AuditLog } from "./audit-log.js";
import type { IpedClient } from "./iped-client.js";
import type { InvestigationSessions } from "./investigation-sessions.js";
import {
  buildCaseSelection,
  buildInvestigationResultState,
  buildInvestigationWorkspace,
  buildInvestigatorHome,
  enrichInvestigatorView,
  filterInvestigatorViewEvidence
} from "./investigator-view.js";

export class InvestigatorService {
  constructor(
    private readonly iped: IpedClient,
    private readonly investigations: InvestigationSessions,
    private readonly audit: AuditLog,
    private readonly ai?: AiAnalyzer
  ) {}

  private async sources(sourceId?: string) {
    const context = await this.iped.getCaseContext(sourceId);
    const rawSources = context.sources;
    const sources = Array.isArray(rawSources)
      ? rawSources
      : rawSources &&
          typeof rawSources === "object" &&
          "data" in rawSources &&
          Array.isArray(rawSources.data)
        ? rawSources.data
        : [];

    return sources.flatMap(source => {
      if (
        !source ||
        typeof source !== "object" ||
        !("id" in source) ||
        typeof source.id !== "string"
      ) {
        return [];
      }

      const labelCandidates = ["name", "label", "description", "path"];
      const label = labelCandidates
        .map(key =>
          key in source && typeof source[key] === "string"
            ? source[key]
            : undefined
        )
        .find(Boolean);

      return [{
        id: source.id,
        label: label ?? "Fonte do caso"
      }];
    });
  }

  async home(sourceId?: string, investigationId?: string) {
    try {
      const sources = await this.sources(sourceId);
      const selection = buildCaseSelection({
        sources,
        requestedSourceId: sourceId
      });
      const session = investigationId
        ? this.investigations.get(investigationId)
        : undefined;

      if (investigationId && !session) {
        throw new Error(
          `Unknown investigation session: ${investigationId}`
        );
      }

      const progress = session
        ? this.investigations.progress(session.id)
        : undefined;
      const home = {
        ...buildInvestigatorHome({
          caseAvailable: sources.length > 0,
          sourceId: selection.selectedSourceId,
          activeInvestigation:
            session && progress
              ? {
                  id: session.id,
                  question: session.question,
                  focus: session.focus,
                  evidenceCount: session.evidence.length,
                  openLeadCount: session.leads.filter(
                    lead => lead.status === "OPEN"
                  ).length,
                  status: progress.status
                }
              : undefined
        }),
        sourceSelection: selection
      };

      await this.audit.write("get_investigator_home", {
        investigationId,
        sourceId,
        status: home.status,
        sourceCount: sources.length,
        sourceSelectionStatus: selection.status,
        activeInvestigation: Boolean(session)
      });

      return home;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Unknown investigation session:")
      ) {
        throw error;
      }

      await this.audit.write("get_investigator_home_unavailable", {
        investigationId,
        sourceId,
        error: error instanceof Error ? error.message : String(error)
      });

      return buildInvestigatorHome({
        caseAvailable: false,
        sourceId
      });
    }
  }

  async begin(question: string, sourceId?: string) {
    const sources = await this.sources(sourceId);
    const selection = buildCaseSelection({
      sources,
      requestedSourceId: sourceId
    });

    if (selection.status !== "SOURCE_SELECTED") {
      await this.audit.write("begin_investigation_needs_source", {
        question,
        requestedSourceId: sourceId,
        sourceSelectionStatus: selection.status,
        sourceCount: sources.length
      });

      return {
        status: "SOURCE_SELECTION_REQUIRED" as const,
        question,
        sourceSelection: selection
      };
    }

    const session = this.investigations.start(
      question,
      selection.selectedSourceId
    );
    const investigation = await this.iped.investigateEvidence(
      question,
      selection.selectedSourceId
    );
    const state = this.investigations.record(session.id, {
      query: question,
      evidence: investigation.matchedEvidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId
      })),
      leads: [
        ...investigation.recurringEntities.map(entity => ({
          type: entity.type,
          value: entity.value,
          evidence: entity.evidence
        })),
        ...investigation.recurringCommunicationParticipants.map(
          participant => ({
            type: "COMMUNICATION_PARTICIPANT",
            value: participant.value,
            evidence: participant.evidence
          })
        )
      ]
    });
    const progress = this.investigations.progress(session.id);
    const resultState = {
      ...buildInvestigationResultState({
        evidenceCount: state.evidence.length,
        openLeadCount: state.leads.filter(
          lead => lead.status === "OPEN"
        ).length,
        progress
      }),
      evidenceSearchTruncated: investigation.matchedEvidenceTruncated,
      evidenceSearchAvailable: investigation.matchedEvidenceAvailable
    };
    const investigatorView = {
      ...investigation.investigatorView,
      overview: {
        ...investigation.investigatorView.overview,
        openLeadCount: state.leads.filter(
          lead => lead.status === "OPEN"
        ).length
      },
      sections: {
        ...investigation.investigatorView.sections,
        leads: state.leads.map(lead => ({
          ...lead,
          action: lead.status === "OPEN"
            ? "EXPLORE_LEAD"
            : undefined
        })),
        progress
      }
    };

    const aiAnalysis: AiAnalysis | undefined = this.ai
      ? await this.ai.analyze({
          question,
          evidence: investigation.matchedEvidence.map(item => ({
            sourceId: item.sourceId,
            itemId: item.itemId,
            name: item.name,
            path: item.path,
            text: item.text
          }))
        }).catch(error => ({
          enabled: false,
          reason: error instanceof Error ? error.message : String(error)
        }))
      : undefined;

    if (aiAnalysis) {
      await this.audit.write(
        aiAnalysis.enabled
          ? "ai_analysis_accepted"
          : "ai_analysis_not_presented",
        {
          investigationId: session.id,
          model: aiAnalysis.model,
          reason: aiAnalysis.reason,
          citedReferences: aiAnalysis.validation?.citedReferences,
          evidenceCount: investigation.matchedEvidence.length
        }
      );
    }

    await this.audit.write("begin_investigation", {
      investigationId: session.id,
      question,
      sourceId: session.sourceId,
      evidenceCount: state.evidence.length,
      openLeadCount: state.leads.filter(
        lead => lead.status === "OPEN"
      ).length
    });

    return {
      status: "INVESTIGATION_READY" as const,
      workspace: {
        ...buildInvestigationWorkspace({
          investigationId: session.id,
          question: session.question,
          focus: state.focus,
          sourceId: session.sourceId,
          view: investigatorView,
          resultState
        }),
        aiAnalysis
      }
    };
  }
  private async analyzeWorkspaceEvidence(input: {
    investigationId: string;
    question: string;
    evidence: Array<{
      sourceId: string;
      itemId: number;
      name?: string;
      path?: string;
      text?: string;
    }>;
    phase: "begin" | "continue" | "lead_expansion";
  }): Promise<AiAnalysis | undefined> {
    if (!this.ai) {
      return undefined;
    }

    const aiAnalysis: AiAnalysis = await this.ai.analyze({
      question: input.question,
      evidence: input.evidence
    }).catch(error => ({
      enabled: false,
      reason: error instanceof Error ? error.message : String(error)
    }));

    await this.audit.write(
      aiAnalysis.enabled
        ? "ai_analysis_accepted"
        : "ai_analysis_not_presented",
      {
        investigationId: input.investigationId,
        phase: input.phase,
        model: aiAnalysis.model,
        reason: aiAnalysis.reason,
        citedReferences: aiAnalysis.validation?.citedReferences,
        evidenceCount: input.evidence.length
      }
    );

    return aiAnalysis;
  }

  async aiDiagnostic(investigationId: string) {
    const session = this.investigations.get(investigationId);
    if (!session) {
      throw new Error(`Unknown investigation session: ${investigationId}`);
    }

    const events = this.audit.entries?.() ?? [];
    const event = [...events].reverse().find(entry =>
      entry.investigationId === investigationId &&
      (entry.action === "ai_analysis_accepted" ||
       entry.action === "ai_analysis_not_presented")
    );

    if (!event) {
      return {
        status: "NO_AI_DIAGNOSTIC" as const,
        message: "Nenhum diagnóstico de IA foi registrado para esta investigação."
      };
    }

    return {
      status: event.action === "ai_analysis_accepted"
        ? "AI_ACCEPTED" as const
        : "AI_REJECTED" as const,
      reason: typeof event.reason === "string" ? event.reason : undefined,
      model: typeof event.model === "string" ? event.model : undefined,
      evidenceCount: event.evidenceCount
    };
  }

  async continue(
    investigationId: string,
    question: string,
    focus?: string
  ) {
    const current = this.investigations.get(investigationId);

    if (!current) {
      throw new Error(
        `Unknown investigation session: ${investigationId}`
      );
    }

    const investigation = await this.iped.investigateEvidence(
      question,
      current.sourceId
    );
    const session = this.investigations.record(investigationId, {
      followUp: question,
      focus: focus ?? question,
      query: question,
      evidence: investigation.matchedEvidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId
      })),
      leads: [
        ...investigation.recurringEntities.map(entity => ({
          type: entity.type,
          value: entity.value,
          evidence: entity.evidence
        })),
        ...investigation.recurringCommunicationParticipants.map(
          participant => ({
            type: "COMMUNICATION_PARTICIPANT",
            value: participant.value,
            evidence: participant.evidence
          })
        )
      ]
    });
    const progress = this.investigations.progress(investigationId);
    const view = enrichInvestigatorView(
      investigation.investigatorView,
      { leads: session.leads, progress }
    );
    const resultState = {
      ...buildInvestigationResultState({
        evidenceCount: investigation.matchedEvidence.length,
        openLeadCount: session.leads.filter(
          lead => lead.status === "OPEN"
        ).length,
        progress
      }),
      evidenceSearchTruncated: investigation.matchedEvidenceTruncated,
      evidenceSearchAvailable: investigation.matchedEvidenceAvailable
    };

    const aiAnalysis = await this.analyzeWorkspaceEvidence({
      investigationId,
      question,
      evidence: investigation.matchedEvidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId,
        name: item.name,
        path: item.path,
        text: item.text
      })),
      phase: "continue"
    });

    await this.audit.write("continue_investigation", {
      investigationId,
      question,
      focus: session.focus,
      evidenceCount: session.evidence.length,
      matchedEvidenceCount: investigation.matchedEvidence.length
    });

    return {
      status: "INVESTIGATION_UPDATED" as const,
      workspace: {
        ...buildInvestigationWorkspace({
          investigationId,
          question: session.question,
          focus: session.focus,
          sourceId: session.sourceId,
          view,
          resultState
        }),
        aiAnalysis
      }
    };
  }

  async exploreLead(
    investigationId: string,
    leadType?: string,
    leadValue?: string
  ) {
    const current = this.investigations.get(investigationId);

    if (!current) {
      throw new Error(
        `Unknown investigation session: ${investigationId}`
      );
    }

    const explicitSelection = Boolean(leadType && leadValue);
    const decision = this.investigations.shouldExpand(investigationId);

    if (!decision.expand) {
      if (
        explicitSelection &&
        !this.investigations.lead(
          investigationId,
          leadType!,
          leadValue!
        )
      ) {
        await this.audit.write("explore_investigation_lead_not_available", {
          investigationId,
          leadType,
          leadValue
        });
        return {
          status: "CORRELATION_NOT_AVAILABLE" as const,
          reason: "REQUESTED_CORRELATION_IS_NOT_OPEN" as const,
          progress: this.investigations.progress(investigationId)
        };
      }

      return {
        status: "INVESTIGATION_STOPPED" as const,
        reason: decision.reason,
        progress: this.investigations.progress(investigationId)
      };
    }
    const selected =
      explicitSelection
        ? this.investigations.lead(
            investigationId,
            leadType!,
            leadValue!
          )
        : undefined;

    if (explicitSelection && !selected) {
      await this.audit.write("explore_investigation_lead_not_available", {
        investigationId,
        leadType,
        leadValue
      });
      return {
        status: "CORRELATION_NOT_AVAILABLE" as const,
        reason: "REQUESTED_CORRELATION_IS_NOT_OPEN" as const,
        progress: this.investigations.progress(investigationId)
      };
    }

    const next = selected
      ? { available: true as const, lead: selected }
      : this.investigations.nextLead(investigationId);

    if (!next.available) {
      return {
        status: "NO_OPEN_LEADS" as const,
        reason: next.reason,
        progress: this.investigations.progress(investigationId)
      };
    }

    const lead = next.lead;
    const priorEvidenceKeys = new Set(
      current.evidence.map(
        reference => `${reference.sourceId}:${reference.itemId}`
      )
    );
    const anchorKeys = new Set(
      lead.evidence.map(
        reference => `${reference.sourceId}:${reference.itemId}`
      )
    );
    const contextValues = new Map<string, { type: string; value: string }>();

    const addContextValue = (type: string, value?: string) => {
      if (!value) return;
      if (type === lead.type && value === lead.value) return;
      contextValues.set(`${type}\u0000${value}`, { type, value });
    };

    const anchorInvestigation = await this.iped.investigateEvidence(
      lead.value,
      current.sourceId
    );
    const anchorEvidenceKeys = new Set(
      lead.evidence.map(
        reference => `${reference.sourceId}:${reference.itemId}`
      )
    );
    const loadedAnchorItems = new Map(
      anchorInvestigation.matchedEvidence
        .filter(item =>
          anchorEvidenceKeys.has(`${item.sourceId}:${item.itemId}`)
        )
        .map(item => [
          `${item.sourceId}:${item.itemId}`,
          item
        ])
    );

    for (const reference of lead.evidence) {
      const key = `${reference.sourceId}:${reference.itemId}`;
      const loaded = loadedAnchorItems.get(key);
      let entities = loaded?.entities ?? [];
      let communication = loaded?.communication;

      if (!loaded) {
        try {
          const metadata = await this.iped.getEvidence(
            reference.sourceId,
            reference.itemId
          );
          const properties = metadata.properties ?? {};
          entities = Object.entries(properties)
            .filter(([name, values]) =>
              name.startsWith("Regex:") && Boolean(values?.length)
            )
            .flatMap(([name, values]) =>
              (values ?? []).map(value => ({
                type: name.slice("Regex:".length),
                value,
                searchQuery: value
              }))
            );
          const participantValues = (prefix: string) => [
            ...(properties[prefix] ?? []),
            ...(properties[`${prefix}:id`] ?? []),
            ...(properties[`${prefix}:name`] ?? []),
            ...(properties[`${prefix}:phoneNumber`] ?? []),
            ...(properties[`${prefix}:username`] ?? [])
          ];
          communication = {
            evidence: { sourceId: reference.sourceId, itemId: reference.itemId },
            from: participantValues("Communication:From").map(value => ({
              value, id: "", name: "", phoneNumber: "", username: ""
            })),
            to: participantValues("Communication:To").map(value => ({
              value, id: "", name: "", phoneNumber: "", username: ""
            })),
            conversation: {
              id: "", name: "", type: ""
            }
          };
        } catch {
          continue;
        }
      }

      for (const entity of entities) {
        addContextValue(entity.type, entity.value);
      }

      for (const participant of [
        ...(communication?.from ?? []),
        ...(communication?.to ?? [])
      ]) {
        addContextValue(
          "COMMUNICATION_PARTICIPANT",
          participant.value ?? participant.id ?? participant.phoneNumber ??
            participant.username ?? participant.name
        );
      }
    }

    const queryValues = [...contextValues.values()];
    const investigations = [anchorInvestigation];
    const seenQueries = new Set<string>([lead.value]);
    for (const context of queryValues) {
      const value = context.value.trim();
      if (!value || seenQueries.has(value)) continue;
      seenQueries.add(value);

      try {
        investigations.push(
          await this.iped.investigateEvidence(value, current.sourceId)
        );
      } catch (error) {
        await this.audit.write("context_correlation_query_failed", {
          investigationId,
          leadType: lead.type,
          leadValue: lead.value,
          contextType: context.type,
          contextValue: value,
          sourceId: current.sourceId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const evidenceByKey = new Map<string, (typeof investigations)[number]["matchedEvidence"][number]>();
    let evidenceSearchTruncated = false;
    let evidenceSearchAvailable = 0;
    for (const candidateInvestigation of investigations) {
      evidenceSearchTruncated ||= Boolean(candidateInvestigation.matchedEvidenceTruncated);
      evidenceSearchAvailable += candidateInvestigation.matchedEvidenceAvailable ??
        candidateInvestigation.matchedEvidence.length;
      for (const item of candidateInvestigation.matchedEvidence) {
        evidenceByKey.set(`${item.sourceId}:${item.itemId}`, item);
      }
    }

    const contextualEvidence = [...evidenceByKey.values()].filter(item => {
      const key = `${item.sourceId}:${item.itemId}`;
      if (priorEvidenceKeys.has(key) || anchorKeys.has(key)) return true;
      return (item.entities ?? []).some(entity =>
        contextValues.has(`${entity.type}\u0000${entity.value}`)
      ) || [...(item.communication?.from ?? []), ...(item.communication?.to ?? [])]
        .some(participant => {
          const value = participant.value ?? participant.id ??
            participant.phoneNumber ?? participant.username ?? participant.name;
          return value
            ? contextValues.has(`COMMUNICATION_PARTICIPANT\u0000${value}`)
            : false;
        });
    });

    const primaryInvestigation = investigations[0];
    const allowedEvidenceKeys = new Set(
      contextualEvidence.map(
        item => `${item.sourceId}:${item.itemId}`
      )
    );
    const filteredLeads = [
      ...investigations.flatMap(item => item.recurringEntities).map(entity => ({
        type: entity.type,
        value: entity.value,
        evidence: entity.evidence.filter(reference =>
          allowedEvidenceKeys.has(
            `${reference.sourceId}:${reference.itemId}`
          )
        )
      })),
      ...investigations.flatMap(item => item.recurringCommunicationParticipants).map(
        participant => ({
          type: "COMMUNICATION_PARTICIPANT",
          value: participant.value,
          evidence: participant.evidence.filter(reference =>
            allowedEvidenceKeys.has(
              `${reference.sourceId}:${reference.itemId}`
            )
          )
        })
      )
    ].filter(item => item.evidence.length > 1);

    const session = this.investigations.record(investigationId, {
      query: lead.value,
      expansion: true,
      expansionQuery: lead.value,
      evidence: contextualEvidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId
      })),
      leads: filteredLeads,
      exploredLead: { type: lead.type, value: lead.value }
    });
    const progress = this.investigations.progress(investigationId);
    const contextualView = filterInvestigatorViewEvidence(
      primaryInvestigation.investigatorView,
      contextualEvidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId
      }))
    );
    const view = enrichInvestigatorView(
      contextualView,
      { leads: session.leads, progress }
    );
    const resultState = {
      ...buildInvestigationResultState({
        evidenceCount: contextualEvidence.length,
        openLeadCount: session.leads.filter(
          item => item.status === "OPEN"
        ).length,
        progress
      }),
      evidenceSearchTruncated,
      evidenceSearchAvailable
    };

    const aiAnalysis = await this.analyzeWorkspaceEvidence({
      investigationId,
      question: session.question,
      evidence: contextualEvidence.map(item => ({
        sourceId: item.sourceId,
        itemId: item.itemId,
        name: item.name,
        path: item.path,
        text: item.text
      })),
      phase: "lead_expansion"
    });

    await this.audit.write("explore_investigation_lead", {
      investigationId,
      leadType: lead.type,
      leadValue: lead.value,
      sourceId: current.sourceId,
      matchedEvidenceCount: evidenceByKey.size,
      contextualEvidenceCount: contextualEvidence.length
    });

    return {
      status: "LEAD_EXPLORED" as const,
      exploredLead: lead,
      workspace: {
        ...buildInvestigationWorkspace({
          investigationId,
          question: session.question,
          focus: session.focus,
          sourceId: session.sourceId,
          view,
          resultState
        }),
        aiAnalysis
      }
    };
  }

  async evidence(sourceId: string, itemId: number) {
    const [metadata, text] = await Promise.all([
      this.iped.getEvidence(sourceId, itemId),
      this.iped.getText(sourceId, itemId).catch(() => undefined)
    ]);

    await this.audit.write("open_investigator_evidence", {
      sourceId,
      itemId,
      textAvailable: Boolean(text)
    });

    const properties = Object.entries(metadata.properties)
      .filter(([, values]) => values?.length)
      .map(([name, values]) => ({ name, values }));

    return {
      reference: { sourceId, itemId },
      name:
        metadata.properties.name?.[0] ??
        metadata.properties.Name?.[0] ??
        `Item ${itemId}`,
      path:
        metadata.properties.path?.[0] ??
        metadata.properties.Path?.[0],
      hash: metadata.properties.hash?.[0],
      bookmarks: metadata.bookmarks,
      selected: metadata.selected,
      text: text?.text,
      textTruncated: text?.truncated ?? false,
      properties
    };
  }

}
