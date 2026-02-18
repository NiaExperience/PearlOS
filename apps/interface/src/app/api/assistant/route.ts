import { GET_impl, POST_impl } from '@nia/prism/core/routes/assistant/route'
import { NextRequest, NextResponse } from 'next/server'

import { interfaceAuthOptions } from '@interface/lib/auth-config'

// Shim to prism core implementations with bound auth options
export async function GET(req: NextRequest): Promise<NextResponse> {
	return GET_impl(req, interfaceAuthOptions)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	return POST_impl(req, interfaceAuthOptions)
}
