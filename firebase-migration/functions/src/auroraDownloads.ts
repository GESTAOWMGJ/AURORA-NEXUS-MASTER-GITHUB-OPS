import { auroraDesignStyles, auroraIdentityMark } from "./auroraDesignSystem.js";
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

type Member = { role: string; permissions: string[]; orgId: string };
type Entry = { name: string; label: string; platform: string; size: number; sha256: string; signed: boolean };
const names = new Set(['AURORA-NEXUS-Mac-HML.zip', 'AURORA-NEXUS-Windows-x64-HML.exe', 'AURORA-NEXUS-Windows-Beta.zip', 'AURORA-NEXUS-Instalar.exe']);
const portal = 'https://auroranexus.com.br/portal';
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
  if (!Array.isArray(value.files) || ![2, 3, 4].includes(value.files.length)) throw new Error('INVALID_FILES');
  const seen = new Set<string>();
  for (const item of value.files) {
    if (!item || !names.has(item.name) || seen.has(item.name) || typeof item.label !== 'string' || item.label.length > 100 || !['mac','windows'].includes(item.platform) || item.signed !== false || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 16 * 1024 * 1024 || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error('INVALID_FILE');
    const bytes = await checkedFile(root, item.name, 16 * 1024 * 1024);
    if (bytes.length !== item.size || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('PACKAGE_INTEGRITY_FAILED');
    seen.add(item.name);
  }
  if (!seen.has('AURORA-NEXUS-Mac-HML.zip') || !seen.has('AURORA-NEXUS-Windows-x64-HML.exe')) throw new Error('MISSING_BASE_PACKAGES');
  return { schemaVersion: 1, version: value.version, channel: 'homologation', productionApproved: false, portalUrl: portal, files: value.files as Entry[] };
}

/** The wrapper verifies the current Firebase session and membership on EVERY request. */
export async function servePrivateDownloads(req: { method: string; path: string }, res: any, member: Member | null, root = resolve(process.cwd(), 'private-downloads')): Promise<void> {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Vary', 'Cookie');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
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
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA NEXUS | Downloads privados</title><style>${auroraDesignStyles()}
body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1000px;margin:auto;padding:48px 24px}h1{font-family:'Source Serif 4',Georgia,serif;font-weight:400;font-size:clamp(30px,4vw,42px);letter-spacing:-.025em;line-height:1.15;margin:12px 0 20px}h2{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:23px;line-height:1.25;margin:0 0 14px}.tag{color:#81632e;letter-spacing:.16em;font-size:11px;font-weight:700}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin:26px 0}article{padding:26px;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow)}a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 18px;background:var(--ink);border:1px solid var(--ink);color:#fffdf8;border-radius:9px;text-decoration:none;font-weight:650}a:hover{background:#105064}a:focus-visible{outline:3px solid var(--info);outline-offset:4px}.hash{font-size:12px;overflow-wrap:anywhere;color:var(--muted);line-height:1.6;margin-top:18px}.warning{padding:18px 20px;border:1px solid #d4bd8e;border-left:3px solid var(--gold);border-radius:0 10px 10px 0;background:var(--panel2);color:#62471e;line-height:1.65}.back{background:transparent;color:var(--ink);border-color:var(--line)}.back:hover{background:var(--panel2)}@media(max-width:520px){main{padding:28px 18px}article{padding:22px}.warning{padding:16px}}</style></head><body><main>${auroraIdentityMark()}<p class="tag">ACESSO RESTRITO</p><h1>Instalar o cliente do portal</h1><p class="warning">Homologação. Pacotes sem assinatura de editor e sem notarização Apple. Estes clientes abrem o portal canônico único; não contêm um sistema offline. A instalação não confirma disponibilidade ou implantação do servidor. Não desative proteções do sistema.</p><section>${cards}</section><p>A busca documental não é iniciada automaticamente. O recurso POSIX/macOS exige autorização própria; não está portado para Windows.</p><p><a class="back" href="/">Voltar à gestão</a></p></main></body></html>`;
      res.status(200).type('html').send(req.method === 'HEAD' ? '' : html); return;
    }
    if (match![1] === 'manifest.json') { res.status(200).json(manifest); return; }
    const item = manifest.files.find(file => file.name === match![1]);
    if (!item) { res.status(404).json({ code: 'NOT_FOUND' }); return; }
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
