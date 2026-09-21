# Security Policy

## Reporting a vulnerability

Please do not publish suspected vulnerabilities, forensic data exposure, or exploit details in a public issue.

Report security concerns privately to the repository owner through GitHub's private vulnerability reporting when it is available for this repository. If that channel is not available, contact the maintainer privately before disclosing technical details publicly.

Include the affected version or commit, reproduction steps, expected impact, and whether the report involves evidence confidentiality, evidence integrity, prompt injection, command execution, network exposure, or data egress.

## Security model

IPED MCP Server treats evidence content as untrusted data. Evidence text, metadata, documents, messages, URLs, and other indexed content must never be treated as instructions to the server or agent.

The project is designed for read-only investigative access to cases already processed by IPED. AI output is derived analysis and does not replace original evidence or the investigator's conclusions.

The local investigator application binds to localhost by default. Do not expose the IPED Web API or investigator application to an untrusted network without an appropriate institutional security layer.

For the detailed threat model, see `docs/threat-model.md`.
