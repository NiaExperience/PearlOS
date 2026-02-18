const os = require('os');

const fetch = require('node-fetch');

const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_API_URL = 'https://api.daily.co/v1';

if (!DAILY_API_KEY) {
  console.error('Error: DAILY_API_KEY environment variable is required');
  process.exit(1);
}

const sanitizeSegment = (segment) => segment.toLowerCase().replace(/[^a-z0-9-]/g, '-');

async function ensureRoom() {
  const hostname = sanitizeSegment(os.hostname());
  const roomName = `dev-${hostname}-dailycall`;
  // Expire in 24 hours (seconds)
  const exp = Math.floor(Date.now() / 1000) + 86400;

  // console.error(`Checking Daily room: ${roomName}`);

  try {
    // 1. Check if room exists
    const checkRes = await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
      headers: { Authorization: `Bearer ${DAILY_API_KEY}` }
    });

    if (checkRes.ok) {
      const room = await checkRes.json();
      
      // Update expiration to keep it alive and ensure it is public
      await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DAILY_API_KEY}`
          },
          body: JSON.stringify({ privacy: 'public', properties: { exp } })
      });

      console.log(room.url); // Output URL to stdout for capture
      return;
    }

    if (checkRes.status !== 404) {
      throw new Error(`Failed to check room: ${checkRes.status} ${checkRes.statusText}`);
    }

    // 2. Create room if it doesn't exist
    // console.error(`Room not found, creating: ${roomName}`);
    const createRes = await fetch(`${DAILY_API_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        name: roomName,
        privacy: 'public',
        properties: {
          enable_chat: true,
          enable_screenshare: true,
          enable_recording: 'cloud',
          enable_transcription: false,
          max_participants: 10,
          eject_at_room_exp: true,
          exp: exp
        }
      })
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create room: ${err}`);
    }

    const newRoom = await createRes.json();
    console.log(newRoom.url); // Output URL to stdout

  } catch (error) {
    console.error('Error ensuring Daily room:', error);
    process.exit(1);
  }
}

ensureRoom();
