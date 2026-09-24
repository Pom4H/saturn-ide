import { Unzip, UnzipInflate } from 'fflate';
import type { ImportSourceFile, ScadaImportSource } from '../core/importer';

const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 2000;

const digest = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');

function safePath(raw: string, seen: Set<string>): string {
  const path = raw.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.includes(':') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Недопустимый путь в архиве');
  }
  const canonical = path.normalize('NFKC').toLocaleLowerCase('ru-RU');
  if (seen.has(canonical)) throw new Error('Повторяющийся путь в архиве');
  seen.add(canonical);
  return path;
}

/** Reads an import source locally in the browser. Raw project bytes are passed only to the selected project-owned importer. */
export async function readImportSource(file: File): Promise<ScadaImportSource> {
  if (file.size > MAX_ARCHIVE) throw new Error('Архив больше 32 МБ');
  const input = new Uint8Array(await file.arrayBuffer());
  const raw: { path: string; bytes: Uint8Array }[] = [];
  const seen = new Set<string>();
  let total = 0;

  const add = (path: string, bytes: Uint8Array) => {
    if (bytes.byteLength > MAX_FILE) throw new Error('Распакованный файл больше 8 МБ');
    total += bytes.byteLength;
    if (total > MAX_TOTAL) throw new Error('Распакованный проект больше 64 МБ');
    if (raw.length >= MAX_FILES) throw new Error('В проекте больше 2000 файлов');
    raw.push({ path: safePath(path, seen), bytes });
  };

  if (/\.zip$/i.test(file.name)) {
    let count = 0;
    const unzip = new Unzip(entry => {
      if (++count > MAX_FILES) throw new Error('В архиве больше 2000 файлов');
      const path = entry.name.replaceAll('\\', '/');
      if (path.endsWith('/')) return;
      const canonical = safePath(path, seen);
      if (entry.originalSize !== undefined && entry.originalSize > MAX_FILE) throw new Error('Распакованный файл больше 8 МБ');
      const chunks: Uint8Array[] = [];
      let size = 0;
      entry.ondata = (error, chunk, final) => {
        if (error) throw new Error('Повреждённый или неподдержанный ZIP');
        size += chunk.length; total += chunk.length;
        if (size > MAX_FILE || total > MAX_TOTAL) {
          entry.terminate();
          throw new Error('Слишком большой распакованный проект');
        }
        chunks.push(chunk);
        if (final) {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
          raw.push({ path: canonical, bytes });
        }
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < input.length; offset += 4096) {
      unzip.push(input.subarray(offset, offset + 4096), offset + 4096 >= input.length);
    }
  } else {
    add(file.name, input);
  }

  if (!raw.length) throw new Error('Источник не содержит файлов');
  raw.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const output: ImportSourceFile[] = [];
  for (const item of raw) output.push({ path: item.path, bytes: item.bytes, sha256: await digest(item.bytes) });
  const manifest = output.map(item => `${item.path}\0${item.sha256}\0${item.bytes.byteLength}`).join('\n');
  return {
    name: file.name,
    fingerprint: await digest(new TextEncoder().encode(manifest)),
    totalBytes: output.reduce((sum, item) => sum + item.bytes.byteLength, 0),
    files: output,
  };
}
