# IPED MCP Server

This project explores a small MCP interface for [IPED](https://github.com/sepinf-inc/IPED), with an initial focus on read-only access to cases already processed by IPED.

The MCP server is not intended to replace IPED's forensic processing. It uses the IPED Web API to search and inspect indexed evidence while keeping references to the original source and item.

The first implementation includes bounded search, evidence metadata, extracted text, bookmark listing and a local audit trail.

More details will be added as the integration is tested against real IPED cases.
