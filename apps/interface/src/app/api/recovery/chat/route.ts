import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'recovery_chat_disabled' },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
