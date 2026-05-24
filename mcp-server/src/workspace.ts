import { readFile } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';

export function workspaceRoot(): string {
  const explicit = process.env.ATOMIRA_WORKSPACE?.trim();
  return explicit ? resolve(explicit) : process.cwd();
}

export function resolveWorkspacePath(rawPath: string): string {
  if (!rawPath) {
    throw new Error('Path is required.');
  }
  if (isAbsolute(rawPath)) {
    throw new Error(`Path must be workspace-relative, not absolute: ${rawPath}`);
  }
  if (rawPath.includes('..')) {
    throw new Error(`Path must not traverse out of workspace: ${rawPath}`);
  }
  return join(workspaceRoot(), rawPath);
}

export async function readWorkspaceText(
  rawPath: string,
  maxBytes = 2_000_000,
): Promise<string> {
  const full = resolveWorkspacePath(rawPath);
  const buf = await readFile(full);
  if (buf.byteLength > maxBytes) {
    throw new Error(
      `File too large (${buf.byteLength} bytes). Limit is ${maxBytes}.`,
    );
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}
