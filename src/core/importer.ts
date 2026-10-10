import type { Text } from '../core';
export type ImportSeverity = 'info' | 'warning' | 'blocker';

export interface ImportLabel {
  readonly en: string;
  readonly ru: string;
}

export interface ImportSourceFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface ScadaImportSource {
  readonly name: string;
  /** Fingerprint of the logical file tree, independent of ZIP container bytes. */
  readonly fingerprint: string;
  readonly totalBytes: number;
  readonly files: readonly ImportSourceFile[];
}

export interface ImportDiagnostic {
  readonly severity: ImportSeverity;
  readonly code: string;
  readonly message: ImportLabel;
  readonly path?: string;
  readonly entity?: string;
}

export interface ImportGeneratedFile {
  /** CAS revision for a generated file that is intentionally refreshed, never user-owned code. */
  readonly previousVersion?: string;
  /** Generated files are confined to imports/<importer-id>/. */
  readonly path: string;
  readonly source: string;
}

export interface ScadaImportPlan {
  /** create: new importer namespace; sync: CAS-update managed files without rewriting project.ts. */
  readonly mode?: 'create'|'sync';
  readonly importer: string;
  readonly sourceFingerprint: string;
  /** Replacement authored root. Applying a plan is an explicit source edit, never a live apply. */
  readonly projectSource: string;
  readonly files: readonly ImportGeneratedFile[];
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly stats?: Readonly<Record<string, number>>;
  readonly summary?: Text;
}

export interface ScadaImportContext {
  readonly projectSource: string;
  readonly projectVersion: string;
  readonly files: readonly {readonly path:string;readonly source:string;readonly version:string}[];
}

export interface ScadaImporter {
  readonly id: string;
  readonly label: Text;
  /** Browser file-picker hints such as .zip or .lm2. Detection remains authoritative. */
  readonly accepts: readonly string[];
  /** 0 means not recognized. Higher scores win when several installed importers match. */
  detect(source: ScadaImportSource): number;
  import(source: ScadaImportSource, context?: ScadaImportContext): ScadaImportPlan | Promise<ScadaImportPlan>;
}

/** Importers are ordinary project-owned source. This validates metadata only; no global registry is created. */
export function defineImporter<const I extends ScadaImporter>(importer: I): I {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(importer.id)) throw new Error('Invalid importer id');
  const label:unknown=importer.label;
  if (!(typeof label==='string'?label.trim():label&&typeof label==='object'&&!Array.isArray(label)&&'en'in label&&typeof label.en==='string'&&label.en.trim()&&'ru'in label&&typeof label.ru==='string'&&label.ru.trim())) throw new Error('Importer label is required');
  if (!importer.accepts.length || importer.accepts.some(value => !/^\.[a-z0-9]+$/i.test(value))) throw new Error('Importer accepts must contain file extensions');
  return importer;
}
