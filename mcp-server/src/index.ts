#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { cardsGetTool } from './tools/cards-get.js';
import { cardsListTool } from './tools/cards-list.js';
import { hypothesisCrosscheckTool } from './tools/hypothesis-crosscheck.js';
import { opsGetTool } from './tools/ops-get.js';
import { ragLookupTool } from './tools/rag-lookup.js';
import { usceCheckTool } from './tools/usce-check.js';
import { disposePool } from './rag/pool.js';
import type { McpTool } from './tools/types.js';

const TOOLS: McpTool[] = [
  cardsListTool,
  cardsGetTool,
  opsGetTool,
  hypothesisCrosscheckTool,
  usceCheckTool,
  ragLookupTool,
];

const REGISTRY = new Map(TOOLS.map((t) => [t.name, t]));

const server = new Server(
  {
    name: '@artano-ai/mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = REGISTRY.get(name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const text = await tool.run((args as Record<string, unknown>) ?? {});
    return {
      content: [{ type: 'text', text }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The server runs until stdin closes. Stderr is the only safe place to log
  // (stdout carries the JSON-RPC stream).
  process.stderr.write('lemma mcp-server: ready on stdio\n');
}

async function shutdown(): Promise<void> {
  try {
    await disposePool();
  } catch {
    // ignore — shutdown is best-effort
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  process.stderr.write(
    `lemma mcp-server: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
