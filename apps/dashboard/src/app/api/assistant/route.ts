import { GET_Templates_impl, POST_impl } from '@nia/prism/core/routes/assistant/route'
import { dashboardAuthOptions } from '@dashboard/lib/auth-config'
import { NextRequest, NextResponse } from 'next/server'
import { createAssistant } from '@nia/prism/core/actions/assistant-actions'
import { getTenantsForUser, getTenantById, createTenant, getTenantByName } from '@nia/prism/core/actions/tenant-actions'
import { getUserById, createUser } from '@nia/prism/core/actions/user-actions'
import { TenantPlanTier } from '@nia/prism/core/blocks/tenant.block'
import { Prism } from '@nia/prism'
import { BlockType_Assistant } from '@nia/prism/core/blocks/assistant.block'

// Check if we should bypass auth for local development
function shouldBypassAuth(req: NextRequest): boolean {
	const disableAuth = process.env.DISABLE_DASHBOARD_AUTH === 'true' ||
		(process.env.NODE_ENV === 'development' &&
			(req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1'));
	return disableAuth;
}

export async function GET(req: Request) {
	// @ts-ignore Next provides a NextRequest-compatible object
	return GET_Templates_impl(req as any, dashboardAuthOptions)
}

export async function POST(req: Request) {
	const nextReq = req as any as NextRequest;
	
	// Bypass auth for local development
	if (shouldBypassAuth(nextReq)) {
		try {
			const body = await nextReq.json();
			
			// Get or create a tenant for local dev
			// First, try to find an existing tenant by looking at existing assistants
			let tenantId: string | null = body.tenantId || null;
			
			if (tenantId) {
				// Verify tenant exists
				const tenant = await getTenantById(tenantId);
				if (!tenant) {
					console.log(`[assistant] Local dev: tenant ${tenantId} not found, will find/create one`);
					tenantId = null;
				}
			}
			
			if (!tenantId) {
				// Try to find tenant from existing assistants by querying directly
				try {
					const prism = await Prism.getInstance();
					const result = await prism.query({
						contentType: BlockType_Assistant,
						tenantId: 'any',
						limit: 1,
						orderBy: { createdAt: 'desc' }
					});
					if (result && result.items && result.items.length > 0) {
						// Prism query returns flattened content (tenantId is directly on item)
						const assistant = result.items[0] as any;
						tenantId = assistant.tenantId || null;
						if (tenantId) {
							console.log(`[assistant] Local dev: Found existing tenant ${tenantId} from assistants`);
						}
					}
				} catch (e) {
					// If that fails, we'll create a new tenant below
					console.log(`[assistant] Local dev: Could not find existing tenant, will create one`);
				}
			}
			
			if (!tenantId) {
				// Try to find existing "Local Dev Tenant" first
				const existingTenant = await getTenantByName('Local Dev Tenant');
				if (existingTenant) {
					tenantId = existingTenant._id!;
					console.log(`[assistant] Local dev: Found existing tenant ${tenantId}`);
				} else {
					// Create a default tenant for local dev
					const tenantData = {
						name: 'Local Dev Tenant',
						planTier: TenantPlanTier.PROFESSIONAL,
					};
					const tenant = await createTenant(tenantData);
					tenantId = tenant._id!;
					console.log(`[assistant] Local dev: Created new tenant ${tenantId}`);
				}
			}
			
			// At this point, tenantId should always be set
			if (!tenantId) {
				return NextResponse.json({ error: 'Failed to find or create tenant' }, { status: 500 });
			}
			
			// Create assistant with sensible defaults for local development
			const subDomain = body.subDomain || body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
			const assistantData = {
				name: body.name,
				tenantId: tenantId,
				subDomain: subDomain,
				
				// Essential defaults for a working assistant
				description: body.description || `${body.name} - AI assistant`,
				firstMessage: body.firstMessage || `Hello! I'm ${body.name}. How can I help you today?`,
				
				// Model configuration
				model: body.model || {
					provider: 'openai',
					model: 'gpt-4o-mini',
					temperature: 0.7,
					systemPrompt: body.special_instructions || `You are ${body.name}, a helpful AI assistant.`
				},
				
				// Voice configuration - use Kokoro for local TTS
				voiceProvider: 'pipecat',
				modePersonalityVoiceConfig: {
					default: {
						personalityId: '',  // Will be set when personality is created
						personalityName: body.name,
						personaName: body.persona_name || body.name,
						room_name: `local-${subDomain}-default`,
						voice: {
							provider: 'kokoro',
							voiceId: 'af_heart',
							speed: 1.0,
							model: 'kokoro-v1'
						}
					},
					home: {
						personalityId: '',  // Will be set when personality is created
						personalityName: body.name,
						personaName: body.persona_name || body.name,
						room_name: `local-${subDomain}-home`,
						voice: {
							provider: 'kokoro',
							voiceId: 'af_heart',
							speed: 1.0,
							model: 'kokoro-v1'
						}
					}
				},
				
				// Transcriber configuration
				transcriber: {
					provider: 'deepgram',
					model: 'nova-2',
					language: 'en-US'
				},
				
				// Features enabled by default
				supportedFeatures: [
					'notes',
					'htmlContent', 
					'miniBrowser',
					'dailyCall',
					'passwordLogin',
					'guestLogin',
				],
				
				// Access control - allow local development access
				allowAnonymousLogin: true,
				startFullScreen: false,
				desktopMode: 'home',
				
				// Voice settings
				backchannelingEnabled: true,
				backgroundDenoisingEnabled: true,
				silenceTimeoutSeconds: 30,
				maxDurationSeconds: 3600,
				
				is_template: true,
			};
			
			const assistant = await createAssistant(assistantData);
			if (assistant) {
				console.log(`[assistant] Local dev: Created assistant ${assistant._id}`);
				return NextResponse.json({ assistant });
			} else {
				return NextResponse.json({ error: 'Assistant creation returned no data.' }, { status: 500 });
			}
		} catch (error: any) {
			console.error('[assistant] Local dev creation failed:', error);
			
			// Check if it's an APIError with statusCode
			let statusCode = 500;
			let errorMessage = 'Failed to create assistant';
			
			if (error && typeof error === 'object') {
				// APIError from assistant-actions has statusCode property
				if ('statusCode' in error && typeof error.statusCode === 'number') {
					statusCode = error.statusCode;
				} else if ('status' in error && typeof error.status === 'number') {
					statusCode = error.status;
				}
				
				// Get error message
				if (error.message) {
					errorMessage = error.message;
				} else if (error.toString && typeof error.toString === 'function') {
					errorMessage = error.toString();
				}
			} else if (typeof error === 'string') {
				errorMessage = error;
			}
			
			console.error(`[assistant] Returning error: ${errorMessage} (${statusCode})`);
			return NextResponse.json({ error: errorMessage }, { status: statusCode });
		}
	}
	
	// @ts-ignore Next provides a NextRequest-compatible object
	return POST_impl(req as any, dashboardAuthOptions)
}
