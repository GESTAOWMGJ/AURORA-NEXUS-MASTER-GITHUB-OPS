import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { verifyAuroraAccess } from './auroraAccess.js';
import { servePrivateDownloads } from './auroraDownloads.js';

const ALLOWED_EMAILS = defineSecret('AURORA_NEXUS_ALLOWED_EMAILS');

export const auroraNexusDownloads = onRequest(
  { cors: false, region: 'southamerica-east1', secrets: [ALLOWED_EMAILS], timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    // No download URLs bypass Firebase session revocation or current membership.
    const member = await verifyAuroraAccess(req.get('cookie'), ALLOWED_EMAILS.value());
    await servePrivateDownloads(req, res, member);
  }
);
