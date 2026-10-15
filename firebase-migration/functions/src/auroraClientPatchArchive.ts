/** Client-only projection of the existing independently trusted five-component release.
 * No new signer, authority, network request, installer, executor or persistence. */
import { canonical, finalizeUnifiedBeta, readUnifiedZip, writeUnifiedZip, unifiedDigest,
  type UnifiedFinalization } from './auroraUnifiedBetaArchive.js';

export const CLIENT_PATCH_NAME = 'Aurora-Nexus-Client-Atual.zip';
const CLIENT_COMPONENTS = ['satellite', 'windowsIntegration'] as const;
const README = `# AURORA NEXUS - client/patch da referencia assinada\n\nEste arquivo reune somente os clientes existentes e a integracao Windows da mesma\nreferencia assinada. Nao contem servidor, frontend web, IA Master, modelo, banco,\ncredenciais ou documentos. Nao executa atualizacao nem coleta automaticamente.\n\nAbra https://auroranexus.com.br/portal com sua identidade individual e MFA.\nUse os instaladores existentes apenas no sistema correspondente, preservando o\nmesmo aplicativo, identidade, destino, configuracao, checkpoints e rollback.\nNao execute o cliente Windows no Mac nem substitua a aplicacao original sem\nvalidacao nativa e backup. Nao desative Gatekeeper, SmartScreen ou quarentena.\n\nO manifesto identifica versao do produto, SHA de fonte e certificado. As versoes\ntecnicas dos componentes nao sao renomeadas. SHA256SUMS verifica integridade;\na chave publica incluida sozinha nao autentica o publicador: confronte a raiz\nde confianca por canal independente. O certificado Ed25519 nao e assinatura\nde editor Windows, assinatura Apple ou assinatura do ZIP externo.\n\nDownload, publicacao e instalacao sao estados distintos. Mac e iOS conservam\nseus aceites pendentes. iOS/Android usam o acesso web existente; nao ha IPA/APK\nnem distribuicao App Store/Play Store certificada neste arquivo.\n`;
const json = (value: unknown): Buffer => Buffer.from(canonical(value) + '\n');

export function finalizeClientPatch(options: Parameters<typeof finalizeUnifiedBeta>[0]): UnifiedFinalization {
  // Preserve the complete existing signature, source, runtime-candidate and
  // payload closure validation before selecting any bytes for client delivery.
  const verified = finalizeUnifiedBeta(options);
  const source = readUnifiedZip(verified.bytes);
  const files = new Map<string, Buffer>();
  const keep = [
    'trust/certificate.json', 'trust/public-trust.json', 'trust/release-envelope-signed.json',
    'manifests/satellite-manifest.json', 'manifests/windowsIntegration-manifest.json',
    'payloads/windowsIntegration/windowsIntegration-package.zip',
    'payloads/satellite/AURORA-NEXUS-Instalar.exe',
    'payloads/satellite/AURORA-NEXUS-Mac-HML.zip',
    'payloads/satellite/AURORA-NEXUS-Windows-Beta.zip',
    'payloads/satellite/AURORA-NEXUS-Windows-x64-HML.exe',
    'access/web/index.html', 'access/ios/index.html', 'access/android/index.html'
  ];
  for (const name of keep) {
    const bytes = source.get(name);
    if (!bytes) throw Error('CLIENT_PAYLOAD_REQUIRED');
    files.set(name, Buffer.from(bytes));
  }
  files.set('README-CLIENT.md', Buffer.from(README));
  const delivery = {
    schemaVersion: 'aurora.unified-client-patch.v1', status: 'PREPARADO', complete: false,
    releaseId: verified.delivery.releaseId, productVersion: verified.productVersion,
    sourceSha: verified.sourceSha, certificateSha256: verified.certificateSha256,
    scope: 'CLIENT_ONLY', includedComponents: [...CLIENT_COMPONENTS],
    components: Object.fromEntries(CLIENT_COMPONENTS.map(name => [name, verified.delivery.components[name]])),
    excludedPayloadComponents: ['server', 'web', 'iaMaster'],
    fullReleaseArchiveSha256: verified.sha256,
    adoption: verified.delivery.adoption,
    installationAcceptancePolicy: verified.delivery.installationAcceptancePolicy,
    installationExecuted: false, publicationAvailability: 'PENDING',
    files: Object.fromEntries([...files].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([name, bytes]) => [name, {sha256: unifiedDigest(bytes), size: bytes.length}]))
  };
  files.set('client-patch-manifest.json', json(delivery));
  files.set('SHA256SUMS', Buffer.from([...files.keys()].sort()
    .map(name => unifiedDigest(files.get(name)!) + '  ' + name + '\n').join('')));
  const bytes = writeUnifiedZip(files);
  return {bytes, sha256: unifiedDigest(bytes), sourceSha: verified.sourceSha,
    productVersion: verified.productVersion, certificateSha256: verified.certificateSha256, delivery};
}
