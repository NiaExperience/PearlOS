// Dynamic HTML Generation Item Route
// Wires feature-layer route implementations (GET, PUT, DELETE) to Next.js API paths:
//   /api/html-generation/:id
// Fixes 404 on DELETE requests observed when attempting to delete an applet.
import { GET_ID_impl, PUT_impl, DELETE_impl } from '@interface/features/HtmlGeneration/routes/[id]/route';

export async function GET(request: Request, context: { params: { id: string } }) {
  return GET_ID_impl(request as any, context as any);
}

export async function PUT(request: Request, context: { params: { id: string } }) {
  return PUT_impl(request as any, context as any);
}

export async function DELETE(request: Request, context: { params: { id: string } }) {
  return DELETE_impl(request as any, context as any);
}
