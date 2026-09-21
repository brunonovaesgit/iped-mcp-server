import type { AuditLog } from "./audit-log.js";
import type { IpedClient } from "./iped-client.js";
import type { InvestigationSessions } from "./investigation-sessions.js";
import {
  buildCaseSelection,
  buildInvestigationResultState,
  buildInvestigationWorkspace,
  buildInvestigatorHome
} from "./investigator-view.js";

export class InvestigatorService {
  constructor(
    private readonly iped: IpedClient,
    private readonly investigations: InvestigationSessions,
    private readonly audit: AuditLog
  ) {}

  private async sources(sourceId?: string) {
    const context = await this.iped.getCaseContext(sourceId);
    const sources = Array.isArray(context.sources) ? context.sources : [];

    return sources.flatMap(source => {
      if (
        !source ||
        typeof source !== "object" ||
        !("id" in source) ||
        typeof source.id !== "string"
      ) {
        return [];
      }

      const label =
        "name" in source && typeof source.name === "string"
          ? source.name
          : undefined;

      return [{ id: source.id, ...(label ? { label } : {}) }];
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
    const resultState = buildInvestigationResultState({
      evidenceCount: state.evidence.length,
      openLeadCount: state.leads.filter(
        lead => lead.status === "OPEN"
      ).length,
      progress
    });
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
      workspace: buildInvestigationWorkspace({
        investigationId: session.id,
        question: session.question,
        focus: state.focus,
        sourceId: session.sourceId,
        view: investigatorView,
        resultState
      })
    };
  }
}
