import 'server-only';
import { dashboardGateway } from '../../../lib/gateway.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return dashboardGateway(request, process.env); }
