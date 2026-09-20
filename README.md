# IPED MCP Server

MCP server for read-only access to digital evidence processed by IPED.

The server exposes IPED evidence to MCP-compatible clients while preserving evidence references through `sourceId` and `itemId`.

## Requirements

- Node.js 20 or newer
- A running IPED Web API
- An MCP-compatible client

## Installation

```bash
git clone https://github.com/brunonovaesgit/iped-mcp-server.git
cd iped-mcp-server
npm install
cp .env.example .env
npm run build
```

### Investigation prompts

`investigate_evidence`

Starts an investigation from a question. The agent searches IPED, inspects relevant evidence and follows relationships when necessary.

`analyze_bookmark`

Starts from evidence already selected by an investigator in an IPED bookmark. The agent analyzes the bookmarked items and may follow evidence-backed relationships to other items in the case.

Both workflows require factual findings to remain traceable to `sourceId` and `itemId` and distinguish facts from inferences and hypotheses.
