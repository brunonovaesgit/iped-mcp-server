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
