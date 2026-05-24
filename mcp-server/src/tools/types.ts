export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
  run(input: Record<string, unknown>): Promise<string>;
}
