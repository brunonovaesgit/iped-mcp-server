import type { Config } from "./config.js";

interface SearchResponse { data?: Array<{ source: string; ids: number[] }>; }
export interface EvidenceReference { sourceId: string; itemId: number; }

export class IpedClient {
  constructor(private readonly config: Config) {}
  listSources(): Promise<unknown> { return this.getJson("/sources"); }
  listBookmarks(): Promise<unknown> { return this.getJson("/bookmarks"); }
  getBookmarkEvidence(bookmark: string): Promise<unknown> { return this.getJson(`/bookmarks/${encodeURIComponent(bookmark)}`); }
  listCategories(): Promise<unknown> { return this.getJson("/categories"); }

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
