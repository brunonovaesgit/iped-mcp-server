import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AuditLog } from "./audit-log.js";
import { getConfig } from "./config.js";
import { IpedClient } from "./iped-client.js";

const config = getConfig();
const iped = new IpedClient(config);
const audit = new AuditLog(config.auditLog);
const server = new McpServer({ name: "iped-mcp-server", version: "0.1.0" });
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

server.tool("list_cases", "List the IPED sources currently available to the server.", {}, async () => {
  const sources = await iped.listSources(); await audit.write("list_cases"); return result(sources);
});
server.tool("search_evidence", "Search an IPED case and return references to matching evidence items.", { query: z.string().min(1), sourceId: z.string().optional(), limit: z.number().int().positive().optional() }, async ({query,sourceId,limit}) => {
  const search = await iped.search(query,sourceId,limit); await audit.write("search_evidence",{query,sourceId,returned:search.matches.length,truncated:search.truncated}); return result(search);
});
server.tool("get_evidence", "Read the indexed metadata for one evidence item.", { sourceId:z.string().min(1), itemId:z.number().int().nonnegative() }, async ({sourceId,itemId}) => {
  const evidence=await iped.getEvidence(sourceId,itemId); await audit.write("get_evidence",{sourceId,itemId}); return result(evidence);
});
server.tool("get_evidence_text", "Read the text extracted by IPED for one evidence item.", { sourceId:z.string().min(1), itemId:z.number().int().nonnegative() }, async ({sourceId,itemId}) => {
  const evidence=await iped.getText(sourceId,itemId); await audit.write("get_evidence_text",{sourceId,itemId,returnedCharacters:evidence.text.length,truncated:evidence.truncated}); return result(evidence);
});
server.tool("list_bookmarks", "List bookmarks already present in the IPED case.", {}, async () => {
  const bookmarks=await iped.listBookmarks(); await audit.write("list_bookmarks"); return result(bookmarks);
});
await audit.write("server_started",{ipedUrl:config.ipedUrl});
await server.connect(new StdioServerTransport());
