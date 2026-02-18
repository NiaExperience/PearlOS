'use server';

import { GET_impl, PUT_impl, DELETE_impl } from '@nia/prism/core/routes/userProfile/route';
import { NextRequest } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function GET(req: NextRequest) {
  return GET_impl(req, dashboardAuthOptions);
}

export async function PUT(req: NextRequest) {
  return PUT_impl(req, dashboardAuthOptions);
}

export async function DELETE(req: NextRequest) {
  return DELETE_impl(req, dashboardAuthOptions);
}