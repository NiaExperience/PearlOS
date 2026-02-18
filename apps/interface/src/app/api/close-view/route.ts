import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ success: true, message: 'View closed successfully' });
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ success: true, message: 'View closed successfully' });
} 