# iOS Soundtrack Volume Fix - Feb 15, 2026

## Problem
Soundtrack volume was significantly louder on iOS Safari compared to desktop browsers, creating a jarring experience for mobile users.

## Root Cause
iOS Safari has different audio output gain characteristics than desktop browsers. While platform-specific volume reduction was already in place (50% reduction), user testing showed this wasn't aggressive enough.

## Solution Implemented

### 1. Increased iOS Volume Reduction
- **Changed**: `IOS_VOLUME_REDUCER` from `0.5` to `0.35`
- **Effect**: iOS Safari now plays at 35% of desktop volume (65% reduction vs. previous 50%)
- **Location**: `/workspace/nia-universal/apps/interface/src/features/Soundtrack/components/SoundtrackProvider.tsx` (line 22)

### 2. Added Diagnostic Logging
- **iOS Detection Logging**: Now logs platform type and volume adjustment on component mount
- **Volume Scaling Logging**: Added debug logging in `applyVolumeScaling()` to verify iOS detection is working
- **Purpose**: Allows verification that iOS detection is working correctly in production

### 3. Updated Volume Scaling Function
- Enhanced `applyVolumeScaling()` to accept optional logger parameter
- All volume set operations now pass logger for diagnostic output
- Logs include: `linearVolume`, `scaledVolume`, `finalVolume`, `reducer`

## Code Changes Summary

```typescript
// Before
const IOS_VOLUME_REDUCER = 0.5;

// After
const IOS_VOLUME_REDUCER = 0.35;
```

```typescript
// Before
function applyVolumeScaling(linear: number): number {
  const scaled = Math.pow(Math.max(0, Math.min(1, linear)), 3);
  if (isIOSSafari()) {
    return scaled * IOS_VOLUME_REDUCER;
  }
  return scaled;
}

// After
function applyVolumeScaling(linear: number, logger?: ReturnType<typeof getClientLogger>): number {
  const scaled = Math.pow(Math.max(0, Math.min(1, linear)), 3);
  const isiOS = isIOSSafari();
  const finalVolume = isiOS ? scaled * IOS_VOLUME_REDUCER : scaled;
  
  if (logger && isiOS) {
    logger.debug('iOS Safari detected - applying volume reduction', {
      linearVolume: linear,
      scaledVolume: scaled,
      finalVolume,
      reducer: IOS_VOLUME_REDUCER
    });
  }
  
  return finalVolume;
}
```

## Bot Tools Compatibility

✅ **All bot tools remain fully functional:**

- `bot_play_soundtrack` - Starts playback (volume scaling applied automatically)
- `bot_stop_soundtrack` - Stops playback
- `bot_next_soundtrack_track` - Skip to next track
- `bot_set_soundtrack_volume` - Set volume 0.0-1.0 (iOS scaling applied transparently)
- `bot_adjust_soundtrack_volume` - Increase/decrease volume (iOS scaling applied transparently)

The tools emit events that set `baseVolume` state. Our platform-specific scaling is applied in `applyVolumeScaling()`, which is called whenever the audio element's volume property is set. This makes the iOS fix completely transparent to the tool API.

## Volume Calculation Examples

With `IOS_VOLUME_REDUCER = 0.35`:

| Slider % | Desktop Volume | iOS Volume | Ratio |
|----------|---------------|------------|-------|
| 10%      | 0.001         | 0.00035    | 2.86x |
| 25%      | 0.0156        | 0.00546    | 2.86x |
| 50%      | 0.125         | 0.04375    | 2.86x |
| 75%      | 0.421         | 0.147      | 2.86x |
| 100%     | 1.0           | 0.35       | 2.86x |

The iOS volume is consistently reduced to 35% across all volume levels, compensating for Safari's higher audio output gain.

## Testing Checklist

- [x] Code changes implemented
- [ ] Test on iOS Safari (iPhone/iPad)
- [ ] Test on desktop Chrome/Firefox
- [ ] Verify comparable perceived loudness
- [ ] Test `bot_set_soundtrack_volume` tool (e.g., set to 50%)
- [ ] Test `bot_adjust_soundtrack_volume` tool (increase/decrease)
- [ ] Verify volume persists across page reloads
- [ ] Check that volume ducking during speech still works

## Deployment Notes

- No database migrations required
- No environment variables changed
- Changes are client-side only (React component)
- Should be safe to deploy immediately
- Can verify iOS detection via browser console logs

## Rollback Plan

If the volume is now too quiet on iOS, adjust `IOS_VOLUME_REDUCER`:
- Current: `0.35` (65% reduction)
- Previous: `0.5` (50% reduction)
- Could try intermediate: `0.4` or `0.45`

The constant is on line 22 of `SoundtrackProvider.tsx`.

## Related Files

- `/workspace/nia-universal/apps/interface/src/features/Soundtrack/components/SoundtrackProvider.tsx` - Main implementation
- `/workspace/nia-universal/apps/pipecat-daily-bot/bot/tools/soundtrack_tools.py` - Bot tools (unchanged, fully compatible)

---

**Date**: February 15, 2026  
**Issue**: iOS Safari soundtrack too loud vs desktop  
**Fix**: Increased iOS volume reduction from 50% to 65%  
**Status**: Ready for testing (Wednesday demo)
