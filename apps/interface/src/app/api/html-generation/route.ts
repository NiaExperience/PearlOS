// HTML Generation API Route
import { GET_impl, POST_impl } from '@interface/features/HtmlGeneration/routes/route';

export async function GET(request: Request) {
  return GET_impl(request as any);
}

export async function POST(request: Request) {
  return POST_impl(request as any);
}
