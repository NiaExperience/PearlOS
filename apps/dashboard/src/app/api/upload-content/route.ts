import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAdmin } from '@nia/prism/core/auth';
import { AssistantActions } from '@nia/prism/core/actions';
import { Prism } from '@nia/prism'; 
import { validateContentData } from '@nia/prism/core/content/utils';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const assistantId = body.assistantId;
    let tenantId = body.tenantId;

    console.log("📋 Tenant ID:", tenantId);
    console.log("📋 Assistant ID:", assistantId);
    const authError = await requireTenantAdmin(tenantId, req, dashboardAuthOptions);
    if (authError) return authError;
    // Validate the shape of the incoming body
    if (
      typeof body !== "object" || 
      body === null ||
      !('contentType' in body) ||
      !('data' in body && Array.isArray(body.data)) ||
      (!('assistantId' in body) && !('tenantId' in body))
    ) {
      return NextResponse.json(
        { error: "Missing required fields: contentType, data, (assistantId | tenantId)" },
        { status: 400 }
      );
    }

    const { contentType, data } = body as { contentType: string, data: any[] };

    if (!tenantId) {
      // Get the assistant by ID
      const assistant = await AssistantActions.getAssistantById(assistantId);
      if (!assistant) {
        return NextResponse.json(
          { error: "Assistant not found" },
          { status: 404 }
        );
      }
      // Get the tenant from the assistant
      tenantId = assistant.tenantId;
      console.log("📋 Fetched tenant ID from assistant:", tenantId);
    }

    // ensure we have a valid definition for the content type
    const prism = await Prism.getInstance();
    const definitionResult = await prism.findDefinition(contentType, tenantId);
    if (!definitionResult || !definitionResult.items || definitionResult.items.length === 0) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 404 });
    }
    const definition = definitionResult.items[0];

    // Validate and preprocess all items (optional: add schema validation here if needed)
    const validated: any[] = [];
    const errors: any[] = [];
    for (let item of data) {
      console.log('validating item:', JSON.stringify(item));
      if ('assistant_id' in Object.keys(definition.dataModel.jsonSchema.properties)) {
        item = { ...item, assistant_id: assistantId };
        console.log('added assistant_id to item:', item);
      }
      if ('tenantId' in Object.keys(definition.dataModel.jsonSchema.properties)) {
        item = { ...item, tenantId: tenantId };
        console.log('added tenantId to item:', item);
      }
      const validate = validateContentData(item, definition.dataModel);
      if (!validate.success) {
        const msg = `Content data validation failed, skipping imported item: ${JSON.stringify(validate.errors, null, 2)}`;
        console.error(msg);
        errors.push(msg);
        continue;
      }
      console.log('Item is valid:', item);
      validated.push(item);
    }

    if (validated.length === 0) {
      return NextResponse.json(
        { error: "No valid items to upload", errors },
        { status: 400 }
      );
    }

    // Insert using the provider-agnostic Prism API
    console.log("📋 Creating items for contentType:", contentType, '\n', JSON.stringify(validated, null, 2))
    const createdItems = await prism.bulkCreate(contentType, validated, tenantId);

    return NextResponse.json({
      success: true,
      insertedCount: createdItems.total,
      contentType,
      errors,
      message: `Successfully uploaded ${createdItems.total} ${contentType} items.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Failed to upload content",
        details: error.message || "Unknown error occurred",
      },
      { status: 500 }
    );
  }
} 