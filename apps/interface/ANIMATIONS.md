# PearlOS Content Update Animations

## Overview
Subtle, fast animations (200-300ms) for content loading and transitions throughout PearlOS interface.

## Core Animation Library
**File:** `src/styles/content-animations.css`

### Available Utilities

#### Shimmer Effects
- `.pearl-loading-shimmer` - Animated shimmer for loading states
- `.pearl-loading-shimmer--light` - Light variant
- `.pearl-loading-shimmer--dark` - Dark variant

#### Fade-In Animations
- `.pearl-fade-in` - Base fade-in (250ms)
- `.pearl-fade-in--fast` - Fast variant (200ms)
- `.pearl-fade-in--slow` - Slow variant (300ms)
- `.pearl-fade-scale-in` - Fade with scale for modals/panels

#### Slide Animations
- `.pearl-slide-in-left` - Slide from left (sidebar items)
- `.pearl-slide-in-right` - Slide from right (panels)

#### Loading States
- `.pearl-pulse` - Subtle pulse for loading indicators
- `.pearl-skeleton` - Skeleton loading shimmer
- `.pearl-skeleton--text` - Text skeleton
- `.pearl-skeleton--heading` - Heading skeleton
- `.pearl-skeleton--paragraph` - Paragraph skeleton
- `.pearl-skeleton--circle` - Circle skeleton

#### Content Updates
- `.pearl-content-loading` - Loading progress bar at top
- `.pearl-stagger-fade-in` - Staggered fade-in for list items (auto-delays)

#### Transitions
- `.pearl-transition-fast` - 200ms transitions
- `.pearl-transition-base` - 250ms transitions (default)
- `.pearl-transition-slow` - 300ms transitions
- `.pearl-transition-opacity` - Opacity only
- `.pearl-transition-transform` - Transform only

## Feature-Specific Implementations

### Notes View (`src/features/Notes/`)
**Files:**
- `styles/notes-next.css` - Streaming renderer animations
- `styles/notes.css` - Enhanced with list loading states

**Classes:**
- `.nn-streaming-container` - Container with update animations
- `.nn-content-glow` - Subtle glow during updates
- `.nn-content-appended` - Append animation
- `.nn-content-modified` - Modify animation
- `.nn-line-new` - New line fade-in with highlight
- `.nn-line-modified` - Modified line pulse
- `.nia-note-view-enter` - Note opening animation
- `.nia-notes-list` - Staggered list animations

### YouTube View (`src/features/YouTube/`)
**File:** `styles/youtube.css`

**Classes:**
- `.yt-container` - Video container fade-scale
- `.yt-loading` - Loading state with top shimmer
- `.yt-skeleton-thumb` - Thumbnail skeleton
- `.yt-embed` - Video embed fade-in
- `.yt-info` - Video info delayed fade-in
- `.yt-queue` - Queue slide-in with stagger
- `.yt-controls` - Controls fade-in

### MiniBrowser (`src/features/MiniBrowser/`)
**File:** `styles/mini-browser.css`

**Classes:**
- `.mb-container` - Browser container fade-scale
- `.mb-loading` - Loading shimmer at top
- `.mb-progress-bar` - Animated progress bar
- `.mb-navbar` - Navigation fade-in
- `.mb-iframe-container` - Iframe container animation
- `.mb-skeleton` - Page skeleton loader
- `.mb-security-indicator` - Security icon animations

## Animation Timing
All animations use cubic-bezier(0.16, 1, 0.3, 1) for smooth, natural motion.

Standard durations:
- **Fast:** 200ms - Quick interactions, state changes
- **Base:** 250ms - Default for most content updates
- **Slow:** 300ms - Larger panels, modals

## Accessibility
All animations respect `prefers-reduced-motion` and automatically reduce to 0.01ms for users who prefer reduced motion.

## Usage Examples

```tsx
// Fade-in new content
<div className="pearl-fade-in">New content</div>

// Staggered list
<ul className="pearl-stagger-fade-in">
  <li>Item 1</li>
  <li>Item 2</li>
  <li>Item 3</li>
</ul>

// Loading state
<div className="pearl-content-loading">
  <div className="pearl-skeleton--heading" />
  <div className="pearl-skeleton--paragraph" />
  <div className="pearl-skeleton--paragraph" />
</div>

// Smooth transitions
<button className="pearl-transition-fast hover:scale-105">
  Click me
</button>
```

## Integration
Animations are imported globally in `src/styles/global.css` and available throughout the application.
