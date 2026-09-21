# Threat model

IPED MCP Server is designed for investigative access to evidence that may be sensitive, misleading or intentionally hostile. The server must not assume that content found in a forensic case is trustworthy.

This document describes engineering boundaries. It is not a guarantee of legal admissibility.

## Assets to protect

The primary assets are the original evidence and processed IPED case, evidence provenance, audit records, investigative confidentiality, and the integrity of conclusions presented to the investigator.

## Trust boundaries

The IPED case is the evidence source. The MCP server reads from the IPED Web API. An AI client may interpret the returned material. These are different trust domains.

Evidence content is data, not authority. Text found in an email, PDF, HTML page, chat, office document or other artifact must never gain permission to change server behavior or instruct the MCP server to execute an operation.

## Main threats

### Evidence modification

The MCP server must not modify original evidence or the processed case through investigative tools. Evidence-facing access is read-only.

Any future notes, reports, bookmarks or other writable features must be treated as derived workspace data and kept separate from original evidence.

### Indirect prompt injection

An evidence item can contain text intended to manipulate an AI agent, for example instructions to ignore previous rules, hide another item, call a tool or disclose information.

Such text is part of the evidence. It must be analyzed as content and must not be treated as an MCP instruction, system instruction or authorization.

### Data poisoning and false relationships

A hostile artifact can contain many names, identifiers, account numbers or other values intended to create misleading correlations.

Co-occurrence and repeated indexed values are investigative leads. Relationship outputs must preserve the evidence references and the observed reason for the connection. They must not silently convert co-occurrence into a real-world relationship.

### Duplicate evidence

Identical content can appear multiple times in a case. Duplicate hashes must not be counted as independent corroboration.

### Data exfiltration

A local IPED installation does not imply that evidence remains local if an external AI provider receives extracted text or metadata.

Deployment must make the model/data-egress boundary explicit. A future local-only mode must be able to prevent evidence content from leaving the controlled environment.

### Exposed IPED Web API

The IPED Web API should normally be reachable only from the intended local or controlled network environment. Publishing an evidence API directly to the Internet is outside the expected deployment model.

### Tool abuse

A tool should have only the capabilities needed for its investigative purpose. Evidence content must not be able to request shell execution, arbitrary filesystem access or new network destinations.

## Required controls

The project should preserve read-only evidence access, provenance through `sourceId` and `itemId`, bounded responses, auditable evidence access, explicit separation of facts/inferences/hypotheses, and a controlled tool surface.

Security behavior must also be tested with adversarial evidence rather than relying only on model instructions.

## Adversarial test cases

The test suite should grow to include artifacts containing prompt-injection text, hidden or misleading instructions, duplicated evidence, conflicting values, excessive entity lists and deliberately misleading co-occurrences.

A successful test means hostile evidence remains evidence: it can be reported and cited, but it cannot change the authority or permissions of the MCP server.
