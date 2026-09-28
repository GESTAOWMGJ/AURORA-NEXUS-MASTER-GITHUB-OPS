import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

type Member = { role: string; permissions: string[]; orgId: string };
type Entry = { name: string; label: string; platform: string; size: number; sha256: string; signed: boolean };
const names = new Set(['AURORA-NEXUS-Mac-HML.zip', 'AURORA-NEXUS-Windows-x64-HML.exe']);
const portal = 'https://wmgj-hml-jfn-20260927.web.app/';
const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]!));

async function checkedFile(root: string, name: string, maximum: number): Promise<Buffer> {
  const base = await realpath(root);
  const path = join(base, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum || dirname(await realpath(path)) !== base) throw new Error('INVALID_PACKAGE');
  return readFile(path);
}

async function release(root: string) {
  const value = JSON.parse((await checkedFile(root, 'manifest.json', 65536)).toString('utf8'));
  if (value.schemaVersion !== 1 || value.channel !== 'homologation' || value.productionApproved !== false || value.portalUrl !== portal || typeof value.version !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(value.version)) throw new Error('INVALID_RELEASE');
  if (!Array.isArray(value.files) || value.files.length !== 2) throw new Error('INVALID_FILES');
  const seen = new Set<string>();
  for (const item of value.files) {
    if (!item || !names.has(item.name) || seen.has(item.name) || typeof item.label !== 'string' || item.label.length > 100 || !['mac','windows'].includes(item.platform) || item.signed !== false || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 16 * 1024 * 1024 || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error('INVALID_FILE');
    const bytes = await checkedFile(root, item.name, 16 * 1024 * 1024);
    if (bytes.length !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('PACKAGE_INTEGRITY_FAILED');
    seen.add(item.name);
  }
  return { schemaVersion: 1, version: value.version, channel: 'homologation', productionApproved: false, portalUrl: portal, files: value.files as Entry[] };
}

/** The wrapper verifies the current Firebase session and membership on EVERY request. */
export async function servePrivateDownloads(req: { method: string; path: string }, res: any, member: Member | null, root = resolve(process.cwd(), 'private-downloads')): Promise<void> {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Vary', 'Cookie');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (!['GET','HEAD'].includes(req.method)) { res.set('Allow','GET, HEAD'); res.status(405).json({ code: 'METHOD_NOT_ALLOWED' }); return; }
  if (!member) {
    if (req.path === '/downloads' || req.path === '/downloads/') { res.set('Location','/'); res.status(303).send(''); }
    else res.status(401).json({ code: 'AUTH_REQUIRED' });
    return;
  }
  if (!['platform_admin','org_admin','director'].includes(member.role) && !member.permissions.includes('downloads.hml.read')) { res.status(403).json({ code: 'HML_DOWNLOAD_PERMISSION_REQUIRED' }); return; }
  const listing = req.path === '/downloads' || req.path === '/downloads/';
  const match = /^\/downloads\/([A-Za-z0-9._-]+)$/.exec(req.path);
  if (!listing && (!match || (!names.has(match[1] ?? '') && match[1] !== 'manifest.json'))) { res.status(404).json({ code: 'NOT_FOUND' }); return; }
  try {
    const manifest = await release(root);
    if (listing) {
      const cards = manifest.files.map(item => `<article><h2>${escape(item.label)}</h2><p>${escape(manifest.version)} · ${(item.size/1024/1024).toFixed(2)} MB</p><a href="/downloads/${item.name}">Baixar instalador</a><p class="hash">SHA-256: ${item.sha256}</p></article>`).join('');
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA NEXUS | Downloads privados</title><style>body{margin:0;background:#071f25;color:#f7f1e7;font:16px system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:48px 24px}h1{font-size:36px}h2{font-size:22px}.tag{color:#ffd166;letter-spacing:.12em}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}article{padding:24px;border:1px solid #287b87;border-radius:18px;background:#0c3038}a{display:inline-block;padding:12px 18px;background:#3ee5b1;color:#05251d;border-radius:9px;text-decoration:none;font-weight:700}a:focus-visible{outline:3px solid #ffd166;outline-offset:4px}.hash{font-size:12px;overflow-wrap:anywhere;color:#b6cecf}.warning{padding:20px;border-left:4px solid #ffd166;line-height:1.6}.back{background:transparent;color:#77deef;padding-left:0}</style></head><body><main><p class="tag">AURORA NEXUS · ACESSO RESTRITO</p><h1>Instalar o cliente do portal</h1><p class="warning">Homologação. Pacotes sem assinatura de editor e sem notarização Apple. Estes clientes abrem o mesmo portal autenticado; não contêm um sistema offline. A instalação não confirma disponibilidade ou implantação do servidor. Não desative proteções do sistema.</p><section>${cards}</section><p>A busca documental não é iniciada automaticamente. O recurso POSIX/macOS exige autorização própria; não está portado para Windows.</p><p><a class="back" href="/">Voltar à gestão</a></p></main></body></html>`;
      res.status(200).type('html').send(req.method === 'HEAD' ? '' : html); return;
    }
    if (match![1] === 'manifest.json') { res.status(200).json(manifest); return; }
    const item = manifest.files.find(file => file.name === match![1])!;
    const bytes = await checkedFile(root, item.name, 16 * 1024 * 1024);
    if (bytes.length !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('PACKAGE_INTEGRITY_FAILED');
    res.set('Content-Disposition', `attachment; filename="${item.name}"`);
    res.set('Content-Length', String(bytes.length));
    res.set('Content-Type', item.name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream');
    res.status(200).send(req.method === 'HEAD' ? '' : bytes);
  } catch {
    res.status(503).json({ code: 'RELEASE_NOT_READY' });
  }
}
