// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  run(input: Record<string, unknown>): Promise<string>;
}
