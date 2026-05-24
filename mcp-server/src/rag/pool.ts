import { Pool } from 'pg';

let pool: Pool | undefined;
let currentDsn = '';

function getDsn(): string {
  return (process.env.ATOMIRA_RAG_DSN ?? '').trim();
}

export function getPool(): Pool | null {
  const dsn = getDsn();

  if (!dsn) {
    if (pool) {
      void pool.end().catch(() => {});
      pool = undefined;
      currentDsn = '';
    }
    return null;
  }

  if (dsn !== currentDsn) {
    if (pool) void pool.end().catch(() => {});
    pool = new Pool({
      connectionString: dsn,
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    currentDsn = dsn;
  }

  return pool!;
}

export async function disposePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    currentDsn = '';
  }
}

export function getRagSchema(): string {
  const raw = (process.env.ATOMIRA_RAG_SCHEMA ?? 'atomira_lab').trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleaned) throw new Error(`Invalid ATOMIRA_RAG_SCHEMA: ${raw}`);
  return cleaned;
}
