import {mkdtemp, open, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';

const names = new Set(['document_intake_core.cjs', 'document_fact_mapping.cjs', 'document-intake-manifest.json']);

// Publish by replacing a directory entry, never by opening the old destination.
// A destination symlink/hardlink is replaced without modifying its other target.
// The output directory belongs to the trusted build checkout, not document input.
export async function atomicGeneratedFile(directory, name, bytes) {
  if (!names.has(name) || !Buffer.isBuffer(bytes)) throw Error('GENERATED_ASSET_PATH_REJECTED');
  const staging = await mkdtemp(join(directory, '.aurora-intake-generated-'));
  const prepared = join(staging, name);
  try {
    const handle = await open(prepared, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(prepared, join(directory, name));
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
}
