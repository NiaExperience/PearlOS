// Configuration for the UI
// This reads the DAILY_ROOM_URL from environment variables
// If not available, falls back to a default URL

// For development, you can set this in your .env file in the project root
// DAILY_ROOM_URL=https://your-domain.daily.co/your-room-name

export const roomUrl = process.env.DAILY_ROOM_URL || "https://pearlos.daily.co/sUdXUVtuT0HFbSQRvdsE";

// Log the room URL being used (helpful for debugging)
console.log("Using Daily.co room URL:", roomUrl);

// Validate the room URL format
if (!roomUrl.startsWith("https://") || !roomUrl.includes("daily.co")) {
  console.warn("Warning: DAILY_ROOM_URL does not appear to be a valid Daily.co URL");
}
