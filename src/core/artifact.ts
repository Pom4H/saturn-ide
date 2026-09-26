/** Immutable build output, never an additional editable project format.
 * The opaque JSON model is validated by the domain decoder at the runtime boundary.
 * Integrity is not authenticity: artifacts contain trusted executable driver code.
 */
export interface Provenance {
  sourceRevision: string | null;
  sourceDigest: string;
  lockHash: string | null;
  coreHash: string;
  bunVersion: string;
}
export interface BuildArtifact {
  schema: 'saturn.build@2';
  hash: string;
  model: string;
  driver: { hash: string; code: string } | null;
  provenance: Provenance;
}
export const HASH = /^sha256:[a-f0-9]{64}$/;
export async function digest(value: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return 'sha256:' + [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Sorted keys, finite JSON values, no executable values or silently discarded fields. */
export function canonical(value: unknown): string {
  const ancestors = new Set<object>();
  const visit = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || ancestors.has(item)) throw new Error('Build model must be finite acyclic JSON');
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new Error('Build model must use plain objects');
    ancestors.add(item);
    let out: string;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new Error('Sparse/custom arrays cannot enter a build');
      out = '[' + Array.from(item, entry => visit(entry)).join(',') + ']';
    }
    else {
      if (Object.getOwnPropertySymbols(item).some(key => Object.getOwnPropertyDescriptor(item, key)?.enumerable)) throw new Error('Enumerable symbols cannot enter a build');
      const fields: string[] = [];
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!('value' in descriptor)) throw new Error('Build model cannot contain accessors');
        if (descriptor.value === undefined) continue; // optional TS properties
        fields.push(JSON.stringify(key) + ':' + visit(descriptor.value));
      }
      out = '{' + fields.join(',') + '}';
    }
    ancestors.delete(item);
    return out;
  };
  return visit(value);
}
export async function createArtifact(model: unknown, driverCode: string | null, provenance: Provenance): Promise<BuildArtifact> {
  const payload = {
    schema: 'saturn.build@2' as const,
    model: canonical(model),
    driver: driverCode === null ? null : { hash: await digest(driverCode), code: driverCode },
    provenance: { ...provenance },
  };
  const artifact = { ...payload, hash: await digest(canonical(payload)) };
  return verifyArtifact(artifact);
}
export async function verifyArtifact(input: unknown): Promise<BuildArtifact> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid build artifact');
  const a = input as Partial<BuildArtifact>;
  if (a.schema !== 'saturn.build@2' || typeof a.hash !== 'string' || !HASH.test(a.hash) || typeof a.model !== 'string' || a.model.length > 4_000_000) throw new Error('Invalid build identity/model');
  if (canonical(JSON.parse(a.model)) !== a.model) throw new Error('Noncanonical build model');
  const p = a.provenance;
  if (!p || !HASH.test(p.sourceDigest) || !HASH.test(p.coreHash) || (p.lockHash !== null && !HASH.test(p.lockHash)) || (p.sourceRevision !== null && !/^[a-f0-9]{40,64}$/.test(p.sourceRevision)) || typeof p.bunVersion !== 'string' || p.bunVersion.length > 80) throw new Error('Invalid build provenance');
  if (a.driver !== null && (!a.driver || typeof a.driver.code !== 'string' || a.driver.code.length > 16_000_000 || await digest(a.driver.code) !== a.driver.hash)) throw new Error('Driver bundle hash mismatch');
  const payload = { schema: a.schema, model: a.model, driver: a.driver, provenance: p };
  if (await digest(canonical(payload)) !== a.hash) throw new Error('Build hash mismatch');
  // Own and freeze every component exposed to consumers. The model itself is immutable text.
  return Object.freeze({ ...payload, hash: a.hash, provenance: Object.freeze({ ...p }), driver: a.driver === null ? null : Object.freeze({ ...a.driver }) });
}
