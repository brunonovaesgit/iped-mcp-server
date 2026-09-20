# IPED MCP Server

An MCP server that gives AI assistants read-only investigative access to digital evidence processed by IPED.

It allows an investigator to ask questions in natural language while the AI searches and examines evidence through IPED. Evidence remains in IPED; the MCP server acts as an access and investigation layer.

The project does not require a modified IPED installation.

## What it is for

Instead of manually translating an investigative question into several IPED searches, an investigator can ask questions such as:

> Investigate possible relationships between Carlos Almeida, Orion Tecnologia and payments of R$ 18,750. Identify relevant evidence, contradictions and points that cannot be confirmed.

An MCP-compatible AI client can then use the server to:

- discover the available IPED case;
- search evidence;
- inspect metadata and extracted text;
- examine values already extracted and indexed by IPED;
- follow evidence leads;
- navigate parent, child and duplicate relationships;
- examine file metadata timelines;
- analyze IPED bookmarks;
- identify conflicting evidence;
- keep factual findings traceable to IPED evidence.

The investigator does not need to know MCP tool names, IPED API endpoints, `sourceId`, `itemId` or IPED search syntax to ask an investigative question.

## Investigation model

The project follows a simple separation of responsibilities:

**IPED → evidence processing and indexing**

**AI + MCP → investigation, correlation and explanation**

**Investigator → validation and conclusions**

The MCP server does not replace IPED processing and does not make forensic conclusions on behalf of the investigator.

## Evidence safeguards

The server is read-only with respect to evidence.

Its investigation instructions require AI clients to:

- base factual findings on evidence available through IPED;
- preserve `sourceId` and `itemId` references for factual findings;
- distinguish facts, inferences and unconfirmed hypotheses;
- treat repeated names, identifiers and values as investigative leads rather than proof of a relationship;
- avoid counting identical files as independent corroboration;
- report conflicting evidence instead of resolving conflicts by document count;
- avoid treating file-system timestamps as event dates without supporting evidence;
- state when the available evidence is insufficient;
- leave bookmark curation to the investigator.

Original evidence is never modified by this server.

## Requirements

- Node.js 20 or newer
- IPED with its Web API available
- An MCP-compatible AI client

The server communicates with the standard IPED Web API and does not require patches to IPED.

## Installation

Clone the repository:

```bash
git clone https://github.com/brunonovaesgit/iped-mcp-server.git
cd iped-mcp-server
```

Install dependencies:

```bash
npm install
```

Create the local configuration:

```bash
cp .env.example .env
```

Build the server:

```bash
npm run build
```

## Configuration

The default `.env.example` is:

```env
IPED_URL=http://127.0.0.1:8080
SEARCH_RESULT_LIMIT=50
TEXT_LIMIT=50000
CONTENT_LIMIT=10000000
AUDIT_LOG=./audit/requests.jsonl
```

### `IPED_URL`

Address of the running IPED Web API.

For a local IPED instance:

```env
IPED_URL=http://127.0.0.1:8080
```

### `SEARCH_RESULT_LIMIT`

Maximum number of IPED search references returned to the AI client by one MCP search operation.

Default:

```env
SEARCH_RESULT_LIMIT=50
```

This limits the MCP response size. It does not change how the current IPED Web API executes the underlying search.

### `TEXT_LIMIT`

Maximum number of characters returned from extracted evidence text.

Default:

```env
TEXT_LIMIT=50000
```

### `CONTENT_LIMIT`

Maximum original evidence content size, in bytes, that the MCP server will return.

Default:

```env
CONTENT_LIMIT=10000000
```

### `AUDIT_LOG`

JSONL file used to record MCP evidence-access operations.

Default:

```env
AUDIT_LOG=./audit/requests.jsonl
```

## Running the server

The MCP server currently uses the standard `stdio` transport.

After building:

```bash
npm start
```

In normal use, an MCP client starts this process automatically.

## MCP client configuration

A generic stdio configuration looks like this:

```json
{
  "mcpServers": {
    "iped": {
      "command": "node",
      "args": ["/absolute/path/to/iped-mcp-server/dist/index.js"],
      "env": {
        "IPED_URL": "http://127.0.0.1:8080"
      }
    }
  }
}
```

Replace:

```text
/absolute/path/to/iped-mcp-server
```

with the directory where the repository was cloned.

Using an absolute path is recommended.

The exact location of the MCP configuration file depends on the AI client.

## First investigation

With IPED Web API running and the MCP server configured in the AI client, start a new conversation and ask an investigative question normally.

For example:

> Investigate evidence related to Carlos Almeida and Orion Tecnologia. Identify relevant documents, relationships, contradictions and anything that cannot be confirmed from the available evidence.

The investigator should not need to specify which MCP tools to use.

The server provides investigation instructions to the MCP client so that a compatible AI agent can discover the case, search evidence, inspect relevant items and follow evidence-backed leads.

## Available investigation capabilities

The server currently exposes MCP tools for:

- case and source discovery;
- evidence search;
- evidence metadata;
- extracted evidence text;
- original evidence content;
- structured values extracted by IPED;
- consolidated evidence inspection;
- evidence lead navigation;
- parent, child and duplicate relationships;
- file metadata timelines;
- IPED categories;
- bookmark discovery;
- bookmarked evidence.

These are implementation capabilities. They are not intended to become commands that an investigator must learn.

## Investigation prompts

The server also provides reusable MCP prompts.

### `investigate_evidence`

Starts an investigation from a natural-language question.

### `analyze_bookmark`

Starts an investigation from evidence already selected in an IPED bookmark.

### `generate_investigation_report`

Produces a structured investigative report grounded in evidence available through IPED.

Using these prompts is optional. The server also provides investigation instructions during the MCP connection so that normal conversations can use the investigative workflow without requiring the investigator to select a prompt first.

## Audit trail

MCP operations are recorded as JSON Lines.

Example:

```json
{
  "timestamp": "2026-09-20T19:46:47.007Z",
  "serverSessionId": "e1658727-65eb-4752-b742-d6ece0a18eb4",
  "sequence": 2,
  "action": "inspect_evidence",
  "sourceId": "case-01",
  "itemId": 18372
}
```

The audit trail records access performed through the MCP server. It does not modify IPED evidence.

`serverSessionId` currently identifies an MCP server process/session; it should not be interpreted as a forensic case identifier or as a complete human investigation identifier.

## Current limitations

The project is under active development.

Important current limitations include:

- the server depends on capabilities exposed by the existing IPED Web API;
- search result limiting currently protects the MCP/AI context size but does not make the underlying IPED search itself paginated;
- file metadata timelines are not the same as semantic event timelines;
- structured entity navigation depends on values extracted and indexed by IPED;
- optional IPED NER features are not required by this project;
- AI-generated analysis must still be reviewed by the investigator.

Future IPED improvements may allow more efficient search pagination and additional forensic capabilities, but this MCP server is designed to remain usable with a standard IPED installation.

## Development

Run the TypeScript development server with:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Before committing:

```bash
npm run build
git diff --check
```

## Project status

Current version: **0.1.0**

The current milestone focuses on a read-only investigative workflow over evidence already processed by IPED.

The project is not intended to replace IPED or the forensic examiner. Its purpose is to make evidence already available in IPED easier to investigate through MCP-compatible AI clients.
