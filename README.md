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
