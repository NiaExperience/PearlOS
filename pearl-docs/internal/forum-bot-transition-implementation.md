# Forum Bot Transition Implementation Plan

## Overview

This document outlines the implementation for allowing bots to transition from initial assistant interactions into the forum, and ensuring only one bot per room.

## Requirements

1. **When forum opens**: Check if user has an existing bot from initial interaction, transition it to forum room
2. **Bot personality preservation**: Read and maintain the personality of the transitioning bot
3. **Video enabled**: Bot should have video on in forum
4. **Second user joins**: If room already has a bot, don't create a new bot for the second user

## Architecture Changes

### 1. User Bot Tracking

**Location**: `apps/pipecat-daily-bot/bot/bot_gateway.py`

- Track bots by `sessionUserId` in Redis: `user_bot:{sessionUserId}`
- Store: `session_id`, `room_url`, `personalityId`, `persona`, `timestamp`
- Expiry: 24 hours

### 2. Room Transition Logic

**In `/join` endpoint**:

1. Check if target room already has a bot (`room_active:{room_url}`)
   - If yes → Return existing bot info, skip creation
   - If no → Continue

2. Check if user has existing bot (`user_bot:{sessionUserId}`)
   - If yes and in different room → Attempt transition
   - If no → Create new bot

3. Transition process:
   - Publish transition message to bot's admin channel
   - Bot receives message and transitions to new room
   - Update `user_bot` tracking
   - Update `room_active` lock

### 3. Bot Presence Detection

**In frontend** (`Call.tsx`):

- Before calling `joinRoom()`, check Daily.co room participants
- If bot participant exists, skip bot join
- Use `isBotParticipant()` helper from `@interface/lib/daily/participant-manager`

### 4. Bot Transition Handler

**In bot runner** (`runner_main.py` or admin message handler):

- Listen for `transition_room` admin messages
- Disconnect from old room
- Connect to new room
- Update internal state
- Update Redis tracking

## Implementation Status

### ✅ Completed

1. User bot tracking in gateway (`user_bot:{sessionUserId}`)
2. Transition check logic in `/join` endpoint
3. Bot presence check before creating new bot

### 🔄 In Progress

1. Bot transition message publishing
2. Frontend bot presence detection
3. Bot transition handler in runner

### ⏳ Pending

1. Testing transition flow
2. Error handling for failed transitions
3. Cleanup of old room state

## Code Changes

### Gateway (`bot_gateway.py`)

- Added `user_bots` tracking dictionary
- Added transition check in `/join` endpoint
- Added user bot tracking on bot creation

### Frontend (`Call.tsx`)

- Need to add: Check for bot participant before `joinRoom()`
- Need to handle: `transitioning` status response

### Bot Runner

- Need to add: Transition message handler
- Need to add: Room disconnect/reconnect logic

## Testing Plan

1. **Single user transition**:
   - User has bot in room A
   - User opens forum (room B)
   - Bot transitions from A to B
   - Verify bot personality preserved
   - Verify video enabled

2. **Second user join**:
   - User 1 has bot in forum room
   - User 2 joins forum room
   - User 2's bot check detects existing bot
   - User 2's bot creation skipped
   - Both users interact with same bot

3. **Error cases**:
   - Transition fails (network error)
   - Bot dies during transition
   - Room already has bot from different user

## Notes

- Room transitions are complex because bots are tied to Daily.co WebRTC connections
- May need to disconnect/reconnect pipeline for full transition
- Alternative: Create new bot with same personality (simpler but loses conversation state)
- Current implementation uses admin messages for transition coordination

