import { readFileSync } from 'node:fs';
import { verifyArtifact, HASH } from '../src/core/artifact';
export interface DeployOptions { url: string; token: string; artifactFile: string; expectedPublished: string | null; expectedApplied: string | null }
/** Explicit apply only. No retries of side effects after an ambiguous network failure. */
export async function deployRelease(options: DeployOptions) {
  const url = new URL(options.url);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS runtime origin (HTTP is allowed on loopback only)');
  for (const hash of [options.expectedPublished, options.expectedApplied]) if (hash !== null && !HASH.test(hash)) throw new Error('Explicit expected published/applied hashes required');
  if (!options.token) throw new Error('SATURN_DEPLOY_TOKEN required');
  const artifact = await verifyArtifact(JSON.parse(readFileSync(options.artifactFile, 'utf8')));
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(new URL(path, url), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${options.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000), redirect: 'error' });
    const result: unknown = await response.json();
    if (!response.ok) throw new Error(`Runtime ${response.status}: ${JSON.stringify(result)}`);
    return result;
  };
  const state = await request('/api/releases') as { published: string | null; applied: string | null };
  if (state.published !== options.expectedPublished || state.applied !== options.expectedApplied) throw new Error('Runtime revisions changed since review; refresh the plan');
  await request('/api/builds', { artifact });
  await request('/api/publish', { hash: artifact.hash, expectedPublished: options.expectedPublished });
  try { await request('/api/apply', { hash: artifact.hash, expectedApplied: options.expectedApplied }); }
  catch (error) {
    const state = await request('/api/releases').catch(() => null);
    throw new Error(`Apply was not confirmed. Inspect runtime before retrying. Actual state: ${JSON.stringify(state)}`, { cause: error });
  }
  return await request('/api/releases');
}
if (import.meta.main) {
  const [artifactFile, url, published, applied] = Bun.argv.slice(2);
  if (!artifactFile || !url || !published || !applied) throw new Error('Usage: bun scripts/deploy-release.ts <artifact.json> <runtime-origin> <expected-published-hash|null> <expected-applied-hash|null>');
  console.log(JSON.stringify(await deployRelease({ artifactFile, url, token: Bun.env.SATURN_DEPLOY_TOKEN ?? '', expectedPublished: published === 'null' ? null : published, expectedApplied: applied === 'null' ? null : applied })));
}
