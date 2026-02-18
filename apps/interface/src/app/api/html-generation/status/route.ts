// FIX: New status endpoint for HTML generation progress tracking
import { GET_impl, POST_impl } from '@interface/features/HtmlGeneration/routes/status/route';

export async function POST(request: Request) {
  return POST_impl(request as any);
}

export async function GET(request: Request) {
  return GET_impl(request as any);
}
