import type { Config } from "./config.js";

interface SearchResponse { data?: Array<{ source: string; ids: number[] }>; }
export interface EvidenceReference { sourceId: string; itemId: number; }

export class IpedClient {
  constructor(private readonly config: Config) {}
  listSources(): Promise<unknown> { return this.getJson("/sources"); }
  listBookmarks(): Promise<unknown> { return this.getJson("/bookmarks"); }
  getBookmarkEvidence(bookmark: string): Promise<unknown> { return this.getJson(`/bookmarks/${encodeURIComponent(bookmark)}`); }
  listCategories(): Promise<unknown> { return this.getJson("/categories"); }
  async getCaseContext(sourceId?: string) {
    const [sources, categories, bookmarks] = await Promise.all([
      this.listSources(),
      this.listCategories(),
      this.listBookmarks()
    ]);

    return {
      sourceId,
      sources,
      categories,
      bookmarks
    };
  }

  async checkClaimEvidence(
    classification: "FACT" | "INFERENCE" | "HYPOTHESIS",
    claim: string,
    references: EvidenceReference[]
  ) {
    const evidence = await Promise.all(
      references.map(reference =>
        this.getEvidence(reference.sourceId, reference.itemId)
      )
    );

    const hashGroups = new Map<string, EvidenceReference[]>();

    for (const item of evidence) {
      const hash = item.properties.hash?.[0];

      if (!hash) {
        continue;
      }

      const group = hashGroups.get(hash) ?? [];

      group.push({
        sourceId: item.sourceId,
        itemId: item.itemId
      });

      hashGroups.set(hash, group);
    }

    const duplicateGroups = [...hashGroups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([hash, items]) => ({
        hash,
        items
      }));

    return {
      classification,
      claim,
      references,
      referencesVerified: true,
      duplicateGroups,
      independentEvidenceCount:
        references.length -
        duplicateGroups.reduce(
          (duplicates, group) => duplicates + group.items.length - 1,
          0
        ),
      semanticSupportValidated: false
    };
  }

  async buildEvidenceLedger(
    claims: Array<{
      classification: "FACT" | "INFERENCE" | "HYPOTHESIS";
      statement: string;
      factBasis?: "DOCUMENT_STATEMENT" | "OBSERVED_METADATA";
      evidence: EvidenceReference[];
      limitation?: string;
    }>
  ) {
    const entries = [];

    for (const claim of claims) {
      if (claim.classification === "FACT" && !claim.factBasis) {
        throw new Error(
          "FACT claims must identify whether they are a DOCUMENT_STATEMENT or OBSERVED_METADATA"
        );
      }

      if (claim.classification !== "FACT" && claim.factBasis) {
        throw new Error(
          "factBasis can only be used with FACT claims"
        );
      }

      const validation = await this.checkClaimEvidence(
        claim.classification,
        claim.statement,
        claim.evidence
      );

      entries.push({
        classification: claim.classification,
        statement: claim.statement,
        ...(claim.factBasis ? { factBasis: claim.factBasis } : {}),
        evidence: claim.evidence,
        limitation: claim.limitation,
        referencesVerified: validation.referencesVerified,
        duplicateGroups: validation.duplicateGroups,
        independentEvidenceCount: validation.independentEvidenceCount,
        semanticSupportValidated: false
      });
    }

    return {
      entries,
      entryCount: entries.length
    };
  }

  async search(query: string, sourceId?: string, requestedLimit?: number) {
    const limit = Math.min(requestedLimit ?? this.config.searchResultLimit, this.config.searchResultLimit);
    const response = await this.getJson<SearchResponse>("/search", { q: query, sourceID: sourceId });
    const matches: EvidenceReference[] = [];
    for (const group of response.data ?? []) {
      for (const itemId of group.ids ?? []) {
        if (matches.length === limit) return { query, sourceId, matches, truncated: true };
        matches.push({ sourceId: group.source, itemId });
      }
    }
    return { query, sourceId, matches, truncated: false };
  }

  async getEvidence(sourceId: string, itemId: number) {
    const doc = await this.getJson<{ source: string; id: number; luceneId?: number; properties?: Record<string,string[]>; bookmarks?: string[]; selected?: boolean }>(`/sources/${encodeURIComponent(sourceId)}/docs/${itemId}`);
    return { sourceId: doc.source, itemId: doc.id, luceneId: doc.luceneId, bookmarks: doc.bookmarks ?? [], selected: doc.selected ?? false, properties: doc.properties ?? {} };
  }

  async getText(sourceId: string, itemId: number) {
    const response = await this.request(`/sources/${encodeURIComponent(sourceId)}/docs/${itemId}/text`);
    const text = await response.text();
    const truncated = text.length > this.config.textLimit;
    return { sourceId, itemId, text: truncated ? text.slice(0, this.config.textLimit) : text, truncated };
  }

  async getContent(sourceId: string, itemId: number) {
    const response = await this.request(
      `/sources/${encodeURIComponent(sourceId)}/docs/${itemId}/content`
    );

    const contentLength = Number(response.headers.get("content-length"));

    if (
      Number.isFinite(contentLength) &&
      contentLength > this.config.contentLimit
    ) {
      await response.body?.cancel();

      throw new Error(
        `Evidence content is too large to return through MCP (${contentLength} bytes, limit ${this.config.contentLimit})`
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.length > this.config.contentLimit) {
      throw new Error(
        `Evidence content is too large to return through MCP (${bytes.length} bytes, limit ${this.config.contentLimit})`
      );
    }

    const disposition = response.headers.get("content-disposition") ?? "";
    const filename =
      disposition.match(/filename="([^"]+)"/)?.[1] ?? `item-${itemId}`;

    return {
      sourceId,
      itemId,
      filename,
      mimeType:
        response.headers.get("content-type") ?? "application/octet-stream",
      size: bytes.length,
      data: bytes.toString("base64")
    };
  }

  private evidenceEntitiesFromProperties(
    sourceId: string,
    itemId: number,
    properties: Record<string, string[]>
  ) {
    const entities: Array<{
      type: string;
      value: string;
      searchQuery: string;
    }> = [];

    for (const [property, values] of Object.entries(properties)) {
      if (!property.startsWith("Regex:") || !values?.length) {
        continue;
      }

      const type = property.slice("Regex:".length);

      if (!type) {
        continue;
      }

      for (const value of values) {
        const escapedValue = value
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');

        entities.push({
          type,
          value,
          searchQuery: `Regex\\:${type}:"${escapedValue}"`
        });
      }
    }

    return {
      evidence: { sourceId, itemId },
      entities
    };
  }

  async getEvidenceEntities(sourceId: string, itemId: number) {
    const evidence = await this.getEvidence(sourceId, itemId);

    return this.evidenceEntitiesFromProperties(
      sourceId,
      itemId,
      evidence.properties
    );
  }

  async getRelatedEvidence(sourceId: string, itemId: number) {
    const evidence = await this.getEvidence(sourceId, itemId);
    const properties = evidence.properties;

    let parent: EvidenceReference | null = null;
    const parentId = properties.parentId?.[0];

    if (parentId && /^\d+$/.test(parentId)) {
      parent = {
        sourceId,
        itemId: Number(parentId)
      };
    }

    const childrenSearch = await this.search(
      `parentId:${itemId}`,
      sourceId
    );

    const children = childrenSearch.matches.filter(
      item => item.itemId !== itemId
    );

    let sameHash: EvidenceReference[] = [];
    let sameHashTruncated = false;

    const hash = properties.hash?.[0];

    if (hash) {
      const sameHashSearch = await this.search(
        `hash:${hash}`,
        sourceId
      );

      sameHash = sameHashSearch.matches.filter(
        item => item.itemId !== itemId
      );

      sameHashTruncated = sameHashSearch.truncated;
    }

    return {
      evidence: { sourceId, itemId },
      parent,
      children,
      childrenTruncated: childrenSearch.truncated,
      sameHash,
      sameHashTruncated
    };
  }

  async inspectEvidence(sourceId: string, itemId: number) {
    const [evidence, text, entities, related] = await Promise.all([
      this.getEvidence(sourceId, itemId),
      this.getText(sourceId, itemId),
      this.getEvidenceEntities(sourceId, itemId),
      this.getRelatedEvidence(sourceId, itemId)
    ]);

    return {
      evidence,
      text,
      entities: entities.entities,
      related: {
        parent: related.parent,
        children: related.children,
        childrenTruncated: related.childrenTruncated,
        sameHash: related.sameHash,
        sameHashTruncated: related.sameHashTruncated
      }
    };
  }

  async followEvidenceLeads(sourceId: string, itemId: number) {
    const entities = await this.getEvidenceEntities(sourceId, itemId);

    const leads = [];

    for (const entity of entities.entities) {
      const search = await this.search(entity.searchQuery, sourceId);

      leads.push({
        type: entity.type,
        value: entity.value,
        searchQuery: entity.searchQuery,
        matches: search.matches.filter(
          match =>
            match.sourceId !== sourceId ||
            match.itemId !== itemId
        ),
        truncated: search.truncated
      });
    }

    return {
      origin: {
        sourceId,
        itemId
      },
      leads
    };
  }

  async getEvidenceConnections(sourceId: string, itemId: number) {
    const origin = await this.getEvidence(sourceId, itemId);
    const entities = await this.getEvidenceEntities(sourceId, itemId);

    const connections = [];

    for (const entity of entities.entities) {
      const search = await this.search(entity.searchQuery, sourceId);

      const matches = search.matches.filter(
        match =>
          match.sourceId !== sourceId ||
          match.itemId !== itemId
      );

      if (matches.length === 0) {
        continue;
      }

      connections.push({
        entity: {
          type: entity.type,
          value: entity.value
        },
        evidence: matches,
        truncated: search.truncated
      });
    }

    return {
      origin: {
        sourceId,
        itemId,
        name: origin.properties.name?.[0],
        path: origin.properties.path?.[0]
      },
      connections
    };
  }

  private communicationParticipantsFromProperties(
    sourceId: string,
    itemId: number,
    properties: Record<string, string[]>
  ) {
    const values = (key: string) =>
      properties[key]?.filter(value => value !== "") ?? [];

    const participantValues = (prefix: string) => {
      const rawValues = values(prefix);
      const ids = values(`${prefix}:id`);
      const names = values(`${prefix}:name`);
      const phoneNumbers = values(`${prefix}:phoneNumber`);
      const usernames = values(`${prefix}:username`);

      const count = Math.max(
        rawValues.length,
        ids.length,
        names.length,
        phoneNumbers.length,
        usernames.length
      );

      return Array.from({ length: count }, (_, index) => ({
        value: rawValues[index],
        id: ids[index],
        name: names[index],
        phoneNumber: phoneNumbers[index],
        username: usernames[index]
      }));
    };

    return {
      evidence: { sourceId, itemId },
      from: participantValues("Communication:From"),
      to: participantValues("Communication:To"),
      conversation: {
        id: properties["Conversation:id"]?.[0],
        name: properties["Conversation:Name"]?.[0],
        type: properties["Conversation:Type"]?.[0]
      }
    };
  }

  async getCommunicationParticipants(
    sourceId: string,
    itemId: number
  ) {
    const evidence = await this.getEvidence(sourceId, itemId);

    return this.communicationParticipantsFromProperties(
      sourceId,
      itemId,
      evidence.properties
    );
  }

  async getCommunicationNetwork(
    items: EvidenceReference[]
  ) {
    const communications = [];
    const participants = new Map<
      string,
      {
        value: string;
        evidence: EvidenceReference[];
      }
    >();

    for (const reference of items) {
      const communication =
        await this.getCommunicationParticipants(
          reference.sourceId,
          reference.itemId
        );

      const allParticipants = [
        ...communication.from,
        ...communication.to
      ];

      if (allParticipants.length === 0) {
        continue;
      }

      communications.push(communication);

      for (const participant of allParticipants) {
        const value =
          participant.value ??
          participant.id ??
          participant.phoneNumber ??
          participant.username ??
          participant.name;

        if (!value) {
          continue;
        }

        const existing = participants.get(value);

        if (existing) {
          if (
            !existing.evidence.some(
              item =>
                item.sourceId === reference.sourceId &&
                item.itemId === reference.itemId
            )
          ) {
            existing.evidence.push(reference);
          }

          continue;
        }

        participants.set(value, {
          value,
          evidence: [reference]
        });
      }
    }

    return {
      communications,
      participants: [...participants.values()]
    };
  }

  async investigateCommunications(
    query: string,
    sourceId?: string,
    requestedLimit?: number
  ) {
    const limit = Math.min(
      requestedLimit ?? 20,
      this.config.searchResultLimit
    );

    const search = await this.search(
      query,
      sourceId,
      limit
    );

    const network = await this.getCommunicationNetwork(
      search.matches
    );

    return {
      query,
      sourceId,
      matchedEvidence: search.matches,
      matchedEvidenceTruncated: search.truncated,
      communications: network.communications,
      participants: network.participants
    };
  }

  async investigateRelationship(
    leftQuery: string,
    rightQuery: string,
    sourceId?: string,
    requestedLimit?: number
  ) {
    const limit = Math.min(
      requestedLimit ?? 20,
      this.config.searchResultLimit
    );

    const [leftSearch, rightSearch] = await Promise.all([
      this.search(leftQuery, sourceId, limit),
      this.search(rightQuery, sourceId, limit)
    ]);

    const referenceKey = (reference: EvidenceReference) =>
      `${reference.sourceId}:${reference.itemId}`;

    const rightKeys = new Set(
      rightSearch.matches.map(referenceKey)
    );

    const sharedEvidence = leftSearch.matches.filter(
      reference => rightKeys.has(referenceKey(reference))
    );

    const connections = [];

    for (const left of leftSearch.matches) {
      const evidenceConnections =
        await this.getEvidenceConnections(
          left.sourceId,
          left.itemId
        );

      for (const connection of evidenceConnections.connections) {
        const matches = connection.evidence.filter(
          reference => rightKeys.has(referenceKey(reference))
        );

        if (matches.length === 0) {
          continue;
        }

        connections.push({
          from: left,
          via: connection.entity,
          to: matches
        });
      }
    }

    const participantMatchesQuery = (
      participant: {
        value?: string;
        id?: string;
        name?: string;
        phoneNumber?: string;
        username?: string;
      },
      query: string
    ) => {
      const expected = query.trim().toLocaleLowerCase();

      return [
        participant.value,
        participant.id,
        participant.name,
        participant.phoneNumber,
        participant.username
      ].some(
        value =>
          value?.trim().toLocaleLowerCase() === expected
      );
    };

    const communicationMentions = [];

    for (const reference of leftSearch.matches) {
      const communication =
        await this.getCommunicationParticipants(
          reference.sourceId,
          reference.itemId
        );

      for (const side of ["from", "to"] as const) {
        for (const participant of communication[side]) {
          if (!participantMatchesQuery(participant, rightQuery)) {
            continue;
          }

          communicationMentions.push({
            evidence: reference,
            matchedQuery: rightQuery,
            side,
            participant,
            conversation: communication.conversation
          });
        }
      }
    }

    for (const reference of rightSearch.matches) {
      const communication =
        await this.getCommunicationParticipants(
          reference.sourceId,
          reference.itemId
        );

      for (const side of ["from", "to"] as const) {
        for (const participant of communication[side]) {
          if (!participantMatchesQuery(participant, leftQuery)) {
            continue;
          }

          communicationMentions.push({
            evidence: reference,
            matchedQuery: leftQuery,
            side,
            participant,
            conversation: communication.conversation
          });
        }
      }
    }

    return {
      left: {
        query: leftQuery,
        evidence: leftSearch.matches,
        truncated: leftSearch.truncated
      },
      right: {
        query: rightQuery,
        evidence: rightSearch.matches,
        truncated: rightSearch.truncated
      },
      sharedEvidence,
      connections,
      communicationMentions
    };
  }

  async investigateEntity(
    query: string,
    sourceId?: string,
    requestedLimit?: number
  ) {
    const limit = Math.min(
      requestedLimit ?? 20,
      this.config.searchResultLimit
    );

    const initialSearch = await this.search(
      query,
      sourceId,
      limit
    );

    const evidence = [];
    const connections = new Map<
      string,
      {
        type: string;
        value: string;
        evidence: EvidenceReference[];
        truncated: boolean;
      }
    >();

    const communicationParticipants = new Map<
      string,
      {
        value: string;
        evidence: EvidenceReference[];
      }
    >();

    for (const reference of initialSearch.matches) {
      const item = await this.getEvidence(
        reference.sourceId,
        reference.itemId
      );

      const entities = this.evidenceEntitiesFromProperties(
        reference.sourceId,
        reference.itemId,
        item.properties
      );

      const participants =
        this.communicationParticipantsFromProperties(
          reference.sourceId,
          reference.itemId,
          item.properties
        );

      evidence.push({
        sourceId: reference.sourceId,
        itemId: reference.itemId,
        name: item.properties.name?.[0],
        path: item.properties.path?.[0],
        entities: entities.entities,
        communication: participants
      });

      for (const participant of [
        ...participants.from,
        ...participants.to
      ]) {
        const value =
          participant.value ??
          participant.id ??
          participant.phoneNumber ??
          participant.username ??
          participant.name;

        if (!value) {
          continue;
        }

        const existing = communicationParticipants.get(value);

        if (existing) {
          if (
            !existing.evidence.some(
              item =>
                item.sourceId === reference.sourceId &&
                item.itemId === reference.itemId
            )
          ) {
            existing.evidence.push(reference);
          }

          continue;
        }

        communicationParticipants.set(value, {
          value,
          evidence: [reference]
        });
      }

      for (const entity of entities.entities) {
        const key = `${entity.type}\u0000${entity.value}`;

        if (connections.has(key)) {
          continue;
        }

        const search = await this.search(
          entity.searchQuery,
          reference.sourceId
        );

        connections.set(key, {
          type: entity.type,
          value: entity.value,
          evidence: search.matches,
          truncated: search.truncated
        });
      }
    }

    return {
      query,
      sourceId,
      initialEvidence: evidence,
      connections: [...connections.values()],
      communicationParticipants:
        [...communicationParticipants.values()],
      initialSearchTruncated: initialSearch.truncated
    };
  }

  async investigateEvidence(
    query: string,
    sourceId?: string,
    requestedLimit?: number
  ) {
    const limit = Math.min(
      requestedLimit ?? 10,
      this.config.searchResultLimit
    );

    const search = await this.search(
      query,
      sourceId,
      limit
    );

    const evidence = [];

    for (const reference of search.matches) {
      const item = await this.getEvidence(
        reference.sourceId,
        reference.itemId
      );

      let text: {
        sourceId: string;
        itemId: number;
        text: string;
        truncated: boolean;
      } | undefined;
      let textError: string | undefined;

      try {
        text = await this.getText(
          reference.sourceId,
          reference.itemId
        );
      } catch (error) {
        textError =
          error instanceof Error
            ? error.message
            : String(error);
      }

      const entities = this.evidenceEntitiesFromProperties(
        reference.sourceId,
        reference.itemId,
        item.properties
      );

      const communication =
        this.communicationParticipantsFromProperties(
          reference.sourceId,
          reference.itemId,
          item.properties
        );

      evidence.push({
        sourceId: reference.sourceId,
        itemId: reference.itemId,
        name: item.properties.name?.[0],
        path: item.properties.path?.[0],
        hash: item.properties.hash?.[0],
        text: text?.text,
        textTruncated: text?.truncated ?? false,
        textAvailable: text !== undefined,
        ...(textError ? { textError } : {}),
        entities: entities.entities,
        communication
      });
    }

    const duplicateGroups = new Map<
      string,
      EvidenceReference[]
    >();

    const entities = new Map<
      string,
      {
        type: string;
        value: string;
        evidence: EvidenceReference[];
      }
    >();

    const communicationParticipants = new Map<
      string,
      {
        value: string;
        evidence: EvidenceReference[];
      }
    >();

    const addReference = (
      collection: EvidenceReference[],
      reference: EvidenceReference
    ) => {
      if (
        collection.some(
          item =>
            item.sourceId === reference.sourceId &&
            item.itemId === reference.itemId
        )
      ) {
        return;
      }

      collection.push(reference);
    };

    for (const item of evidence) {
      const reference = {
        sourceId: item.sourceId,
        itemId: item.itemId
      };

      if (item.hash) {
        const group = duplicateGroups.get(item.hash) ?? [];
        addReference(group, reference);
        duplicateGroups.set(item.hash, group);
      }

      for (const entity of item.entities) {
        const key = `${entity.type}\u0000${entity.value}`;
        const existing = entities.get(key);

        if (existing) {
          addReference(existing.evidence, reference);
          continue;
        }

        entities.set(key, {
          type: entity.type,
          value: entity.value,
          evidence: [reference]
        });
      }

      for (const participant of [
        ...item.communication.from,
        ...item.communication.to
      ]) {
        const value =
          participant.value ??
          participant.id ??
          participant.phoneNumber ??
          participant.username ??
          participant.name;

        if (!value) {
          continue;
        }

        const existing =
          communicationParticipants.get(value);

        if (existing) {
          addReference(existing.evidence, reference);
          continue;
        }

        communicationParticipants.set(value, {
          value,
          evidence: [reference]
        });
      }
    }

    const recurringEntities = [...entities.values()]
      .filter(entity => entity.evidence.length > 1);

    const recurringCommunicationParticipants =
      [...communicationParticipants.values()]
        .filter(participant => participant.evidence.length > 1);

    const crossEvidenceLinks = [];

    for (const entity of recurringEntities) {
      for (let left = 0; left < entity.evidence.length; left += 1) {
        for (
          let right = left + 1;
          right < entity.evidence.length;
          right += 1
        ) {
          crossEvidenceLinks.push({
            left: entity.evidence[left],
            right: entity.evidence[right],
            via: {
              kind: "INDEXED_ENTITY" as const,
              type: entity.type,
              value: entity.value
            }
          });
        }
      }
    }

    for (const participant of recurringCommunicationParticipants) {
      for (
        let left = 0;
        left < participant.evidence.length;
        left += 1
      ) {
        for (
          let right = left + 1;
          right < participant.evidence.length;
          right += 1
        ) {
          crossEvidenceLinks.push({
            left: participant.evidence[left],
            right: participant.evidence[right],
            via: {
              kind: "COMMUNICATION_PARTICIPANT" as const,
              value: participant.value
            }
          });
        }
      }
    }

    const duplicateEvidence = [...duplicateGroups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([hash, items]) => ({
        hash,
        evidence: items
      }));

    const evidenceBySource = new Map<
      string,
      EvidenceReference[]
    >();

    for (const item of evidence) {
      const group = evidenceBySource.get(item.sourceId) ?? [];

      group.push({
        sourceId: item.sourceId,
        itemId: item.itemId
      });

      evidenceBySource.set(item.sourceId, group);
    }

    const scope = {
      sources: [...evidenceBySource.entries()].map(
        ([sourceId, items]) => ({
          sourceId,
          evidenceCount: items.length
        })
      ),
      spansMultipleSources: evidenceBySource.size > 1,
      sourceSpecified: sourceId !== undefined
    };

    return {
      query,
      sourceId,
      matchedEvidence: evidence,
      matchedEvidenceTruncated: search.truncated,
      scope,
      entities: [...entities.values()],
      recurringEntities,
      communicationParticipants:
        [...communicationParticipants.values()],
      recurringCommunicationParticipants,
      crossEvidenceLinks,
      duplicateEvidence,
      investigationLeads: {
        recurringEntities,
        recurringCommunicationParticipants,
        crossEvidenceLinks,
        duplicateEvidence
      }
    };
  }

  async traceEntityPaths(
    query: string,
    sourceId?: string,
    depth = 2,
    requestedLimit?: number
  ) {
    const maxDepth = Math.min(Math.max(depth, 1), 3);
    const limit = Math.min(
      requestedLimit ?? 20,
      this.config.searchResultLimit
    );

    const initialSearch = await this.search(
      query,
      sourceId,
      limit
    );

    type PathStep = {
      sourceId: string;
      itemId: number;
      via?: {
        type: string;
        value: string;
      };
    };

    const paths: PathStep[][] = [];
    const visited = new Set<string>();

    const walk = async (
      reference: EvidenceReference,
      path: PathStep[],
      currentDepth: number,
      via?: {
        type: string;
        value: string;
      }
    ) => {
      const evidenceKey =
        `${reference.sourceId}:${reference.itemId}`;

      if (path.some(
        step =>
          step.sourceId === reference.sourceId &&
          step.itemId === reference.itemId
      )) {
        return;
      }

      const nextPath = [
        ...path,
        {
          sourceId: reference.sourceId,
          itemId: reference.itemId,
          ...(via ? { via } : {})
        }
      ];

      paths.push(nextPath);

      if (currentDepth >= maxDepth) {
        return;
      }

      const expansionKey =
        `${evidenceKey}:${currentDepth}`;

      if (visited.has(expansionKey)) {
        return;
      }

      visited.add(expansionKey);

      const entities = await this.getEvidenceEntities(
        reference.sourceId,
        reference.itemId
      );

      for (const entity of entities.entities) {
        const search = await this.search(
          entity.searchQuery,
          reference.sourceId,
          limit
        );

        for (const match of search.matches) {
          if (
            match.sourceId === reference.sourceId &&
            match.itemId === reference.itemId
          ) {
            continue;
          }

          await walk(
            match,
            nextPath,
            currentDepth + 1,
            {
              type: entity.type,
              value: entity.value
            }
          );
        }
      }
    };

    for (const reference of initialSearch.matches) {
      await walk(reference, [], 1);
    }

    return {
      query,
      sourceId,
      depth: maxDepth,
      initialEvidence: initialSearch.matches,
      initialSearchTruncated: initialSearch.truncated,
      paths
    };
  }

  async getTimeline(items: EvidenceReference[]) {
    const events: Array<{
      sourceId: string;
      itemId: number;
      name?: string;
      path?: string;
      event: string;
      timestamp: string;
    }> = [];

    for (const item of items) {
      const evidence = await this.getEvidence(item.sourceId, item.itemId);
      const properties = evidence.properties;

      const addEvent = (event: string, timestamp?: string) => {
        if (!timestamp) return;

        events.push({
          sourceId: item.sourceId,
          itemId: item.itemId,
          name: properties.name?.[0],
          path: properties.path?.[0],
          event,
          timestamp
        });
      };

      addEvent("created", properties.created?.[0]);
      addEvent("modified", properties.modified?.[0]);
      addEvent("accessed", properties.accessed?.[0]);
      addEvent("changed", properties.changed?.[0]);
    }

    events.sort((a, b) => {
      const aTime = Date.parse(a.timestamp);
      const bTime = Date.parse(b.timestamp);

      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return a.timestamp.localeCompare(b.timestamp);
      }

      return aTime - bTime;
    });

    return {
      items: items.length,
      events
    };
  }

  private async getJson<T = unknown>(path: string, parameters: Record<string,string|undefined> = {}): Promise<T> {
    return (await this.request(path, parameters)).json() as Promise<T>;
  }

  private async request(path: string, parameters: Record<string,string|undefined> = {}): Promise<Response> {
    const url = new URL(path, this.config.ipedUrl);
    for (const [name,value] of Object.entries(parameters)) if (value !== undefined) url.searchParams.set(name,value);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`IPED request failed: ${response.status} ${response.statusText}`);
    return response;
  }
}
