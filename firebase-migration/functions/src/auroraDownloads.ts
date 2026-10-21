import { auroraDesignStyles, auroraIdentityMark } from "./auroraDesignSystem.js";
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { CLIENT_PATCH_NAME as UNIFIED_NAME } from './auroraClientPatchArchive.js';
import { UnifiedBetaBusyError, type CurrentUnifiedBeta } from './auroraUnifiedBetaDownload.js';

type Member = { role: string; permissions: string[]; orgId: string; uid?: string };
type UnifiedAccess = { read:()=>Promise<CurrentUnifiedBeta>; reauthorize:()=>Promise<Member|null> };
const canDownload=(member:Member|null):member is Member=>Boolean(member&&(['platform_admin','org_admin','director'].includes(member.role)||member.permissions.includes('downloads.hml.read')));
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
export async function servePrivateDownloads(req: { method: string; path: string; query?:unknown }, res: any, member: Member | null, root = resolve(process.cwd(), 'private-downloads'), unified?:UnifiedAccess): Promise<void> {
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
  if (!canDownload(member)) { res.status(403).json({ code: 'HML_DOWNLOAD_PERMISSION_REQUIRED' }); return; }
  const listing = req.path === '/downloads' || req.path === '/downloads/';
  const match = /^\/downloads\/([A-Za-z0-9._-]+)$/.exec(req.path);
  if (!listing && (!match || (!names.has(match[1] ?? '') && match[1] !== 'manifest.json' && match[1]!==UNIFIED_NAME))) { res.status(404).json({ code: 'NOT_FOUND' }); return; }
  const authorizeCurrent=async()=>{
    const current=await unified!.reauthorize();
    return canDownload(current)&&current.orgId===member.orgId&&current.uid===member.uid;
  };
  let lease:CurrentUnifiedBeta|undefined;
  try {
    if(match?.[1]===UNIFIED_NAME){
      if(!unified || req.query&&Object.keys(req.query).length){res.status(unified?400:503).json({code:unified?'INVALID_DOWNLOAD_QUERY':'RELEASE_NOT_READY'});return;}
      const current=await unified.read();lease=current;
      if(!await authorizeCurrent()){res.status(403).json({code:'HML_DOWNLOAD_PERMISSION_REQUIRED'});return;}
      await current.assertCurrent(); // Final awaited guard: no await remains before the response.
      res.set('Content-Disposition',`attachment; filename="${UNIFIED_NAME}"`);
      res.set('Content-Length',String(current.bytes.length));res.set('Content-Type','application/zip');
      res.set('X-Aurora-Source-Sha',current.sourceSha);res.set('X-Aurora-Certificate-Sha256',current.certificateSha256);res.set('X-Aurora-Archive-Sha256',current.sha256);
      // Express send(Buffer) would synthesize an ETag. End directly after the
      // explicit headers, so this private current-pointer response has no ETag.
      res.status(200);res.end(req.method==='HEAD'?undefined:current.bytes);return;
    }
    // Acquire before the listing hashes any legacy binaries, too. A missing or
    // busy current reference fails closed before that additional file work.
    let current:CurrentUnifiedBeta|undefined;
    if(listing&&unified){current=await unified.read();lease=current;}
    const manifest = await release(root);
    if (listing) {
      if(unified){if(!await authorizeCurrent()){res.status(403).json({code:'HML_DOWNLOAD_PERMISSION_REQUIRED'});return;}
        if(current)await current.assertCurrent();}
      const beta=current?`<article><h2>Client/patch — versão atual</h2><p>Versão do produto ${escape(current.productVersion)} · ${(current.bytes.length/1024/1024).toFixed(2)} MB</p><a href="/downloads/${UNIFIED_NAME}">Baixar client atual</a><p class="hash">Fonte: ${current.sourceSha}<br>Certificado Ed25519: ${current.certificateSha256}<br>SHA-256 do ZIP: ${current.sha256}</p><p>Somente client/patch; sem servidor, web ou IA Master. Distribuição e instalação possuem validações separadas. A assinatura do certificado não substitui assinatura de editor, aceite dos dispositivos ou ingestão validada. iOS nativo permanece pendente; o original Mac conserva sua identidade.</p></article>`:`<article><h2>Client/patch — versão atual</h2><p>Aguardando referência atual, integridade dos payloads e disponibilidade comprovadas. Nenhum instalador individual abaixo é apresentado como a beta completa.</p></article>`;
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AURORA NEXUS | Downloads privados</title><style>${auroraDesignStyles()}
body{margin:0;background:var(--bg);color:var(--text)}main{max-width:1000px;margin:auto;padding:48px 24px}h1{font-family:'Source Serif 4',Georgia,serif;font-weight:400;font-size:clamp(30px,4vw,42px);letter-spacing:-.025em;line-height:1.15;margin:12px 0 20px}h2{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:23px;line-height:1.25;margin:0 0 14px}.tag{color:#81632e;letter-spacing:.16em;font-size:11px;font-weight:700}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin:26px 0}article{padding:26px;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow)}a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 18px;background:var(--ink);border:1px solid var(--ink);color:#fffdf8;border-radius:9px;text-decoration:none;font-weight:650}a:hover{background:#105064}a:focus-visible{outline:3px solid var(--info);outline-offset:4px}.hash{font-size:12px;overflow-wrap:anywhere;color:var(--muted);line-height:1.6;margin-top:18px}.warning{padding:18px 20px;border:1px solid #d4bd8e;border-left:3px solid var(--gold);border-radius:0 10px 10px 0;background:var(--panel2);color:#62471e;line-height:1.65}.back{background:transparent;color:var(--ink);border-color:var(--line)}.back:hover{background:var(--panel2)}@media(max-width:520px){main{padding:28px 18px}article{padding:22px}.warning{padding:16px}}</style></head><body><main>${auroraIdentityMark()}<p class="tag">ACESSO RESTRITO</p><h1>Client atual do AURORA NEXUS</h1><p class="warning">Homologação. Pacotes sem assinatura de editor e sem notarização Apple. Estes clientes abrem o portal canônico único; não contêm um sistema offline. A instalação não confirma disponibilidade ou implantação do servidor. Não desative proteções do sistema.</p><section>${beta}</section><p>Os links anteriores permanecem restritos para compatibilidade e recuperação, sem outra entrega anunciada. Instalação e alimentação exigem consentimento e recibos próprios; baixar o arquivo não ativa coleta.</p><p><a class="back" href="/">Voltar à gestão</a></p></main></body></html>`;
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
  } catch(error) {
    if(error instanceof UnifiedBetaBusyError){res.set('Retry-After','1');res.status(503).json({code:'RELEASE_BUSY'});}
    else res.status(503).json({ code: 'RELEASE_NOT_READY' });
  } finally { lease?.release(); }
}
