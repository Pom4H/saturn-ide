import type { SQL } from 'bun';
import { verifyArtifact, type BuildArtifact } from '../core/artifact';
export interface Revisions { published: string | null; applied: string | null }
/** Same database as observations; no project-source checkout is required to restore a build. */
export class RevisionStore {
  constructor(private readonly sql: SQL) {}
  async init(): Promise<void> {
    await this.sql`CREATE TABLE IF NOT EXISTS builds (hash TEXT PRIMARY KEY, payload TEXT NOT NULL)`;
    await this.sql`CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY, published TEXT, applied TEXT)`;
    await this.sql`INSERT INTO installation (id,published,applied) VALUES (1,NULL,NULL) ON CONFLICT(id) DO NOTHING`;
  }
  async state(): Promise<Revisions> {
    const rows: Revisions[] = await this.sql`SELECT published,applied FROM installation WHERE id=1`;
    if (!rows[0]) throw new Error('Installation state is missing');
    return rows[0];
  }
  async put(input: BuildArtifact): Promise<void> {
    const artifact = await verifyArtifact(input);
    await this.sql`INSERT INTO builds (hash,payload) VALUES (${artifact.hash},${JSON.stringify(artifact)}) ON CONFLICT(hash) DO NOTHING`;
  }
  async get(hash: string): Promise<BuildArtifact> {
    const rows: { payload: string }[] = await this.sql`SELECT payload FROM builds WHERE hash=${hash}`;
    if (!rows[0]) throw new Error('Unknown build');
    return verifyArtifact(JSON.parse(rows[0].payload));
  }
  async publish(hash: string, expected: string | null): Promise<void> {
    await this.get(hash);
    const rows: { id: number }[] = await this.sql`UPDATE installation SET published=${hash} WHERE id=1 AND (published=CAST(${expected} AS TEXT) OR (published IS NULL AND CAST(${expected} AS TEXT) IS NULL)) RETURNING id`;
    if (rows.length !== 1) throw new Error('Published revision changed; refresh before publishing');
  }
  async apply(hash: string, expected: string | null): Promise<void> {
    // Applying a build that another engineer has superseded is refused in the same SQL update.
    const rows: { id: number }[] = await this.sql`UPDATE installation SET applied=${hash} WHERE id=1 AND published=${hash} AND (applied=CAST(${expected} AS TEXT) OR (applied IS NULL AND CAST(${expected} AS TEXT) IS NULL)) RETURNING id`;
    if (rows.length !== 1) throw new Error('Published/applied revision changed; refresh before applying');
  }
}
