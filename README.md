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
- follow evidence-backed correlations;
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
- treat repeated names, identifiers and values as recurring observed values requiring correlation rather than proof of a relationship;
- avoid counting identical files as independent corroboration;
- report conflicting evidence instead of resolving conflicts by document count;
- avoid treating file-system timestamps as event dates without supporting evidence;
- state when the available evidence is insufficient;
- leave bookmark curation to the investigator.

Original evidence is never modified by this server.

The only write the project performs is an examiner-initiated IPED bookmark change from the Investigator interface (see **Examiner bookmarks** below). The MCP server exposes no write tools, so AI clients cannot create or change bookmarks.

## Distribution for non-developers

The project now builds a **self-contained macOS `IPED MCP.app`** in GitHub Actions. It contains the compiled application, locked JavaScript dependencies and a private Node.js runtime used only by the Investigator. A tester therefore does not need Git, TypeScript, a repository clone, `npm install`, or a system-wide Node.js installation after receiving the artifact.

The packaged Node.js runtime is isolated inside the application bundle and does not replace or alter any Node.js installation already present on the examiner's computer. The package deliberately does not bundle or modify IPED, Java or the examiner's evidence. IPED and the forensic case remain outside the application package.

For source-based development, use the requirements below.

## Requirements

There are two layers to prepare: this Node.js project and IPED itself.

### Required for this project

- Git, when installing from source by cloning the repository;
- Node.js 20 or newer, including npm, only for source-based installation/development; the self-contained macOS app includes its own private runtime;
- a standard IPED 4.x environment with its Web API available;
- at least one case already processed by IPED.

An external MCP-compatible AI client is **optional** when using the included Investigator web interface. It is required only if you want to connect this server to another MCP client.

All JavaScript packages used by this project are declared in `package.json` and locked in `package-lock.json`. Running `npm install` installs the project dependencies; no global npm packages are required.

### Required when building IPED 4.x from source

This repository does not vendor or modify IPED. Follow the upstream IPED documentation for the IPED version you use. For the IPED 4.x line used while developing this MVP, upstream documents these build requirements:

- Git;
- Maven;
- Java JDK 11 with JavaFX. Upstream gives Liberica OpenJDK 11 Full JDK as an example;
- `JAVA_HOME` pointing to that Java 11 installation.

IPED 4.x uses Java 11; do not assume that a newer system JDK is compatible with every IPED 4.x component. Optional IPED features can have additional native/Python dependencies; they are IPED features and are not required by this MCP server itself.

Upstream project and build instructions: https://github.com/sepinf-inc/IPED

### Build IPED from source (one reproducible option)

If you do not already have a usable IPED 4.x release:

```bash
git clone https://github.com/sepinf-inc/IPED.git
cd IPED
mvn clean install
```

A successful upstream build creates a release directory under `target/release/`. Use the generated release that matches the IPED source revision you built.

Before building, verify the tools that matter:

```bash
git --version
java -version
mvn -version
node --version
npm --version
```

For the IPED 4.x build described above, `java -version` / `mvn -version` should resolve to Java 11.

### Process a test case in IPED

The MCP layer reads an **already processed IPED case**; it does not replace IPED evidence processing.

Use IPED's own processing instructions and configuration for the evidence format and operating system you are testing. After processing, identify the resulting case/output directory. That processed output directory is the path supplied to the Web API in **Starting the IPED Web API** below.

For first-time IPED use, follow the upstream Beginner's Start Guide linked from the IPED project. Keep this repository's validation separate from validation of optional IPED processing modules.

### Platform note

IPED upstream describes the project as multiplatform and specifically tests Windows and Linux. This MCP project is Node.js-based and was also developed/tested locally on macOS, but that does not imply that every optional IPED processing/viewer module is supported identically on macOS. For a third-party reproducibility test, record the operating system, Node version, Java version, IPED revision/version and whether IPED was prebuilt or built from source.

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

### `INVESTIGATIONS_DIR`

Directory where the Investigator saves investigations (derived workspace data, kept outside the IPED case).

Default:

```env
INVESTIGATIONS_DIR=./workspace/investigations
```

## Running the server

The MCP server currently uses the standard `stdio` transport.

After building:

```bash
npm start
```

In normal use, an MCP client starts this process automatically.

## Plug the MCP into an existing IPED case

If you already use IPED, **you do not need to import, upload, copy or reprocess your evidence for this project**. This MCP has no evidence-ingestion POST workflow. It reads the case that IPED has already processed.

The intended adoption path is:

```text
Your existing evidence
        ↓
Your normal IPED processing
        ↓
Existing processed IPED case
        ↓
IPED local Web API (read access)
        ↓
IPED MCP Server / Investigator
```

The Web API is not a separate "web edition" of IPED. It is the programmatic interface used to expose an existing processed case to this MCP.

### Recommended connection

The Investigator deliberately remains a read-only process and does not launch or mutate the forensic backend. Use the single connector command below to expose the existing processed case, then start the Investigator. This preserves the project's evidence boundary while avoiding manual JSON and Java commands.

### Connect the existing case

For the easiest local connection, identify only two directories:

- **IPED release**: the IPED directory containing `lib/`;
- **processed case**: the output/case directory that your normal IPED workflow already created.

Then run, from this repository:

```bash
npm run connect:iped -- --iped-home "/path/to/iped-release" --case "/path/to/existing-processed-case" --id "my-case"
```

The command validates both paths, creates the temporary source configuration and starts IPED's Web API locally at `127.0.0.1:8080`. It does **not** POST evidence, import files, alter the case or duplicate the evidence. Keep that terminal open.

In a second terminal:

```bash
npm run check
npm run investigator
```

Then open `http://127.0.0.1:3333`.

The manual Web API procedure remains documented below for administrators, troubleshooting and reproducibility.

## Start without npm commands

For source checkouts, the repository includes launch files at its root. For distributed macOS builds, prefer opening **IPED MCP.app** from the generated ZIP:

- **macOS source checkout:** double-click `IPED-MCP.command`.
- **Windows:** double-click `IPED-MCP.cmd`.

The launcher checks whether Node.js/npm are available, installs this project's JavaScript dependencies on the first run when needed, and then starts the same guided IPED/case discovery flow. It does not install or modify IPED and does not import evidence.

The terminal-based `npm run launch` remains available for developers, automation and troubleshooting.

## Easiest way to start

For normal use, the examiner does not need to create JSON files or type the Java Web API command. From the project directory run:

```bash
npm run launch
```

The launcher first looks in common local/project locations for likely IPED releases and processed-case directories. When it finds candidates, the examiner selects them by number instead of copying filesystem paths. Manual path entry remains available when automatic discovery does not find the desired installation or case. It then validates the selection and starts the local connection and Investigator together. Keep that terminal open and open `http://127.0.0.1:3333`.

This does **not** import, upload, copy or reprocess evidence. The original processed case remains the source of truth in IPED. The lower-level `connect:iped` command remains available for automation and advanced troubleshooting.

## Starting the IPED Web API

The Investigator does not open an IPED case by itself. IPED must first process the evidence, and the IPED Web API must be running and exposing the processed result as a source.

The examples below assume that you already have an IPED release directory and an IPED-processed case. The exact directories are local to each machine; do not copy another user's absolute paths.

1. Locate the IPED release directory. It must contain `lib/` and the IPED runtime files.

2. Locate the **processed IPED output directory** for the case you want to investigate. Do not point the Web API at the original evidence directory.

3. Create a source-definition JSON file. For one case:

```json
[
  {
    "id": "my-case",
    "path": "/absolute/path/to/processed-iped-case"
  }
]
```

On macOS/Linux, for example:

```bash
printf '[{"id":"my-case","path":"/absolute/path/to/processed-iped-case"}]\n' > /tmp/iped-sources.json
```

4. From the IPED release directory, start the Web API:

```bash
java -cp "lib/*" iped.engine.webapi.Main --host=127.0.0.1 --port=8080 --sources=/tmp/iped-sources.json
```

Keep this terminal open. The API is running only while this Java process remains running.

5. In another terminal, verify that IPED exposes the case:

```bash
curl http://127.0.0.1:8080/sources
```

The response must contain the source id configured above (for example, `my-case`). If this fails, do not start the Investigator yet; fix the IPED Web API first.

The default configuration intentionally binds IPED to `127.0.0.1`. Do not expose a forensic case API to a network merely to let another person test it. Each tester should run IPED and this project on their own test machine/case unless an appropriately secured environment has been designed.

### Optional local AI analysis

The deterministic investigation workflow does not require an AI provider. To enable the optional assisted-analysis panel, configure an authorized OpenAI-compatible endpoint in `.env`. A local endpoint avoids sending evidence to an external service.

For example, with a local OpenAI-compatible service:

```env
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=your-local-model
```

Do not configure an external AI endpoint with real forensic evidence unless the evidence owner and applicable policy explicitly permit that transfer.

## From-zero reproducibility checklist

A new tester should be able to reach the Investigator without private knowledge of the development machine:

1. Install/verify Git and Node.js 20+.
2. Obtain a standard IPED 4.x release, or build IPED from source with its documented Java/Maven toolchain.
3. Process non-sensitive test evidence with IPED and locate the processed output directory.
4. Connect that existing processed case with `npm run connect:iped -- --iped-home ... --case ...`, or use the manual Web API procedure, and verify `/sources`.
5. Clone this repository and run `npm install`.
6. Copy `.env.example` to `.env`; change `IPED_URL` only if the API is not at the default local address.
7. Run `npm run check`. Do not continue until it reports `Environment ready.`.
8. Run `npm run investigator` and open `http://127.0.0.1:3333`.
9. Ask a natural-language investigative question that should match the tester's own case.
10. Optionally configure an authorized AI endpoint; the base deterministic workflow does not require it.

For reproducibility feedback, report the OS, Node/npm versions, Java version, IPED version/revision, the failing command, and the complete error message. Never attach real sensitive evidence merely to report an installation problem.

## Quick start

For a first local test, first complete **Starting the IPED Web API** above and leave that Java process running. Then, in a second terminal:

```bash
git clone https://github.com/brunonovaesgit/iped-mcp-server.git
cd iped-mcp-server
npm install
cp .env.example .env
npm run check
npm run investigator
```

Then open `http://127.0.0.1:3333` and start with an investigative question.

For a different tester or machine, repeat the whole installation and IPED Web API procedure locally. If this GitHub repository is private, the tester must first be granted repository access; alternatively distribute a reviewed release artifact through an approved channel.

`npm run check` verifies Node.js, configuration, connectivity with the IPED Web API, availability of case sources, MCP startup, investigation instructions and registered tools before the interface is started.

## Investigator interface

For the simplest local workflow, the investigator can use the included web interface instead of interacting with MCP tools directly.

With a processed IPED case available through the Web API:

```bash
npm run investigator
```

Then open:

```text
http://127.0.0.1:3333
```

The application is intentionally bound to localhost. It discovers the available IPED source, asks for a simple source choice only when necessary, and lets the investigator start from a natural-language question.

From the same workspace the investigator can review observed findings, supporting evidence, relationships, timeline events and correlations available for review; open evidence details; ask follow-up questions; and explore evidence-backed correlations.

A typical workflow is:

```text
Processed case in IPED
        ↓
IPED Web API
        ↓
IPED MCP Server / Investigator
        ↓
Natural-language investigation
        ↓
Findings + evidence + relationships + timeline
        ↓
Investigator review and conclusions
```

No evidence upload is performed by this application. Evidence processing remains an IPED responsibility. With the single exception of examiner bookmarks, the investigator interface is read-only with respect to the case.

### Examiner bookmarks

From the evidence detail panel, the examiner can add the item to an IPED bookmark (creating the bookmark if it does not exist yet) or remove it from a bookmark. The change is written through the standard IPED Web API, so it appears in IPED's own interface as a regular bookmark, and IPED bookmarks created elsewhere appear in the Investigator.

Controls:

- bookmarks live in the processed case state, never in the original evidence;
- only three operations exist: create a bookmark label, add an item, remove an item. Deleting or renaming bookmarks and changing the IPED selection are not available;
- writes happen only from an explicit click in the local interface. They are not reachable from the MCP server or by an AI model;
- the write endpoint accepts only JSON requests from the loopback interface with a matching origin, which blocks cross-site requests and DNS rebinding;
- every change is recorded in the audit log (`examiner_bookmark_add`, `examiner_bookmark_remove`).

Known limitation: the IPED Web API has no concurrency control. Avoid changing bookmarks in the IPED desktop application and in the Investigator at the same time on the same case, since one may overwrite the other's changes.

### Saved investigations

Each investigation is saved automatically after every result: the initial question, follow-up questions and explored correlations. When the Investigator opens, the side menu lists the saved investigations of the selected case. Reopening one shows the last result immediately, without re-running assisted AI analysis, and follow-up questions continue from where the examiner stopped.

Each investigation is one JSON file in `INVESTIGATIONS_DIR`, readable only by the current user. It holds the session state (questions, queries and IPED item references) and the last rendered result, which may include extracted values and evidence names. Treat this directory with the same care as the audit log. It is never written back to the IPED case.

### Analysis notebook

Each investigation has a **Caderno** (notebook) tab where the examiner records observations, hypotheses and partial conclusions in chronological order. Any reference written as `source:item` (for example `resultado:8`) becomes a link that opens the evidence, and the **Citar no caderno** button in the evidence panel inserts the reference and file name into the note being written.

Notes are saved with the investigation in `INVESTIGATIONS_DIR`, separate from the evidence, and can be edited or deleted by the examiner. Saving a new investigation result never overwrites the notebook. The audit log records that a note was added, edited or deleted, without its content.

The web interface is a local investigator experience included with the project. MCP-compatible AI clients can still connect independently through the standard MCP server described below.

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

### Ready-to-use configuration examples

Configuration examples are available in:

- `examples/generic-stdio/`
- `examples/claude-desktop/`

The examples intentionally use an absolute path placeholder:

```text
/absolute/path/to/iped-mcp-server/dist/index.js
```

## First investigation

With IPED Web API running and the MCP server configured in the AI client, start a new conversation and ask an investigative question normally.

For example:

> Investigate evidence related to Carlos Almeida and Orion Tecnologia. Identify relevant documents, relationships, contradictions and anything that cannot be confirmed from the available evidence.

The investigator should not need to specify which MCP tools to use.

The server provides investigation instructions to the MCP client so that a compatible AI agent can discover the case, search evidence, inspect relevant items and follow evidence-backed correlations.

## Available investigation capabilities

The server currently exposes MCP tools for:

- case and source discovery;
- evidence search;
- evidence metadata;
- extracted evidence text;
- original evidence content;
- structured values extracted by IPED;
- consolidated evidence inspection;
- entity-centered investigation and evidence correlation navigation;
- relationship investigation across shared evidence, indexed values and communication metadata;
- communication participant and network analysis;
- bounded multi-step evidence path tracing;
- parent, child and duplicate relationships;
- structural claim validation and evidence ledgers;
- file metadata timelines;
- IPED categories;
- bookmark discovery;
- bookmarked evidence.

These are implementation capabilities. They are not intended to become commands that an investigator must learn.

For a broad investigative question, the AI client can start with a consolidated investigation operation that retrieves matching evidence together with extracted text, indexed entities, communication context and duplicate-content groups. From there it is instructed to use the higher-level entity, relationship and communication workflows only when the findings justify deeper investigation.

Lower-level tools remain available for verification, evidence inspection and cases where a focused investigation needs to be deepened.

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

## Security and community development

Evidence handled by the server is considered untrusted input. The threat model covers indirect prompt injection, misleading relationships, duplicate evidence, data exfiltration and exposed IPED APIs. See `docs/threat-model.md`.

New MCP capabilities should be added as tool modules rather than large handlers in the server entry point. The extension pattern, audit requirements and testing rules are documented in `docs/creating-a-tool.md`.

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
npm test
git diff --check
```

A quick connectivity check is also available:

```bash
npm run check
```

## Project status

Current version: **0.1.0**

The current milestone focuses on a read-only investigative workflow over evidence already processed by IPED.

The project is not intended to replace IPED or the forensic examiner. Its purpose is to make evidence already available in IPED easier to investigate through MCP-compatible AI clients.


## Terminology

User-facing language follows IPED and digital-forensics terminology whenever an established term exists. The interface uses concepts such as evidence, item, metadata, indexed values, entities, relationships, correlations, bookmarks/tags, hash, timeline, analysis and findings according to their actual technical meaning.

Implementation names such as `lead` may remain internal while APIs are stabilized, but they must not force detective-style vocabulary into the examiner-facing interface. In particular, a repeated value is presented as an observed value available for correlation, not as proof of a relationship. Terms such as evidence, finding and conclusion must not be treated as interchangeable.


## MVP acceptance baseline

The MVP is considered ready for a release candidate when the automated acceptance suite keeps the examiner workflow evidence-grounded: the case is discoverable, natural-language investigation returns reviewable IPED items, relationships preserve supporting references, contextual expansion does not add evidence solely because a monetary value repeats, observed monetary differences remain neutral until context supports a conflict, and the interface does not produce forensic conclusions on behalf of the examiner.

This baseline is intentionally narrower than the long-term product backlog. Improvements that are not required to satisfy these acceptance properties belong after the MVP unless they fix a correctness, provenance, security or usability blocker.

Before marking a local build as a release candidate, start the IPED Web API with the intended processed **`mcp-lab` acceptance fixture** and run:

```bash
npm run check:rc
```

The `check:rc` command is a maintainer/release gate, not a generic command for arbitrary third-party cases: its live acceptance contains assertions for the project's `mcp-lab` fixture. For an external tester using another processed case, use `npm run check` and then `npm run investigator`.

With the acceptance fixture, this single gate runs the automated acceptance/test suite, verifies the live local IPED connection, available source, MCP startup, investigation instructions and registered tools, and executes the live `mcp-lab` contextual-correlation acceptance scenario. The live gate must surface distinct identities returned by the broad `Carlos` query without merging them, and must admit the divergent contextual evidence through established context rather than repeated monetary value alone. A passing CI build alone is not sufficient to claim that a specific local IPED installation is ready.

### MVP reference release

The MVP acceptance gate passed against the intended local `mcp-lab` case on 2026-09-23 (America/Sao_Paulo), with 108 automated tests passing, the IPED Web API reachable, one source available, the MCP server starting with 38 tools, explicit retrieval ambiguity for Carlos Almeida / Carlos Santos, and contextual admission of divergent evidence `mcp-lab:2` through established context.

This revision is the frozen reference implementation for the MVP article. Subsequent capabilities belong to the post-MVP backlog unless they correct a defect in the frozen behavior.

### MVP scope freeze

The MVP feature scope is frozen at this baseline. Until the release-candidate gate passes, changes should be limited to defects that block correctness, provenance, security, usability, or the acceptance gate itself. New investigative capabilities, additional heuristics, UI enhancements, integrations, and broader automation belong to the post-MVP backlog.

Once `npm run check:rc` passes against the intended local `mcp-lab` case, that exact revision is the reference implementation for the MVP article.
