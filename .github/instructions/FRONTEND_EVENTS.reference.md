# Frontend Event System Instructions

## Purpose
Guidelines for AI-assisted development using the custom event system for cross-component communication.

## Overview

The Nia interface uses CustomEvent for decoupled communication between components that don't have direct parent-child relationships. This is critical for features spanning multiple isolated parts of the UI (e.g., DailyCall ↔ NotesView ↔ Sidebar).

## When to Use Events

### Use CustomEvent when:
- ✅ Cross-component communication without prop drilling
- ✅ Components in different feature directories need to coordinate
- ✅ State changes need to broadcast to multiple listeners
- ✅ Loosely coupled architecture preferred (e.g., optional features)
- ✅ Late-bound component relationships (listeners added dynamically)

### Don't use CustomEvent when:
- ❌ Parent-child component relationship exists (use props)
- ❌ Shared state in same feature (use context or shared hook)
- ❌ Simple data passing (use callbacks)
- ❌ Real-time server updates (use WebSocket/Daily.co app messages)

## Event Patterns

### 1. Event Definition

**Pattern**: TypeScript interface for event detail
```typescript
// In types/ or feature directory
interface NoteActiveDetail {
  noteId: string;
  noteTitle: string;
  userId: string;
  timestamp: number;
}

// Usage in emitter
const event = new CustomEvent<NoteActiveDetail>('noteActiveInCall', {
  detail: {
    noteId: note._id,
    noteTitle: note.title,
    userId: session.user.id,
    timestamp: Date.now()
  }
});
window.dispatchEvent(event);
```

**Convention**: Use past-tense for completed actions (`noteActivated`), present-tense for ongoing state (`noteActiveInCall`)

### 2. Event Emission

**Location**: In the component that triggers the action
```typescript
// apps/interface/src/features/DailyCall/components/Call.tsx
const activateNote = useCallback(async () => {
  try {
    const response = await fetch(`/api/session/${room}/context`, {
      method: 'POST',
      body: JSON.stringify({ userId, action: 'open', noteId })
    });
    
    if (response.ok) {
      // Emit success event
      window.dispatchEvent(new CustomEvent('noteActiveInCall', {
        detail: { noteId, noteTitle, userId, timestamp: Date.now() }
      }));
    } else if (response.status === 409) {
      // Emit conflict event
      const error = await response.json();
      window.dispatchEvent(new CustomEvent('noteQueueConflict', {
        detail: { conflictingNoteId: error.noteId, ownerName: error.ownerName }
      }));
    }
  } catch (error) {
    console.error('Failed to activate note:', error);
  }
}, [room, userId, noteId, noteTitle]);
```

**Best practices:**
- Emit after successful action, not before
- Include all relevant context in detail
- Handle both success and error cases with different events
- Don't emit if operation fails silently

### 3. Event Listening

**Pattern**: useEffect with addEventListener and cleanup
```typescript
// apps/interface/src/features/Notes/components/notes-view.tsx
useEffect(() => {
  const handleNoteActive = (event: Event) => {
    const customEvent = event as CustomEvent<NoteActiveDetail>;
    const { noteId, noteTitle, userId } = customEvent.detail;
    
    // Update local state
    setActiveCallNoteId(noteId);
    
    // Clear queue if this was queued note
    if (queuedNoteId === noteId) {
      setQueuedNoteId(null);
      localStorage.removeItem('queuedNote');
    }
    
    // Show toast notification
    toast.success(`${noteTitle} is now active in call`);
  };
  
  window.addEventListener('noteActiveInCall', handleNoteActive);
  
  return () => {
    window.removeEventListener('noteActiveInCall', handleNoteActive);
  };
}, [queuedNoteId]); // Include dependencies used in handler
```

**Best practices:**
- Always return cleanup function
- Type-cast event as CustomEvent with proper detail type
- Include all used state/props in dependency array
- Consider debouncing if high-frequency events

### 4. Multiple Listeners

**Pattern**: Same event name, different handlers
```typescript
// Component A - Update UI state
useEffect(() => {
  const handler = (event: Event) => {
    const { noteId } = (event as CustomEvent<NoteActiveDetail>).detail;
    setActiveNoteId(noteId);
  };
  window.addEventListener('noteActiveInCall', handler);
  return () => window.removeEventListener('noteActiveInCall', handler);
}, []);

// Component B - Show indicator
useEffect(() => {
  const handler = (event: Event) => {
    const { noteTitle } = (event as CustomEvent<NoteActiveDetail>).detail;
    showIndicator(noteTitle);
  };
  window.addEventListener('noteActiveInCall', handler);
  return () => window.removeEventListener('noteActiveInCall', handler);
}, []);
```

**Important**: Each component should handle events independently. Don't rely on execution order.

### 5. Event Namespacing

**Convention**: Use feature prefix for scoped events
```typescript
// Good - Clear feature scope
'dailyCallStarted'
'dailyCallEnded'
'noteActiveInCall'
'noteQueueConflict'

// Bad - Too generic
'started'
'ended'
'active'
'conflict'
```

**Pattern**: `{feature}{Entity}{Action}` or `{entity}{Action}In{Context}`

### 6. Lifecycle Events

**Pattern**: Cleanup on unmount or context change
```typescript
// Emit cleanup event when component unmounts or call ends
useEffect(() => {
  return () => {
    if (wasActive) {
      window.dispatchEvent(new CustomEvent('dailyCallEnded', {
        detail: { room, timestamp: Date.now() }
      }));
    }
  };
}, [room, wasActive]);
```

**Use cases:**
- Call ended → clear all indicators
- Feature disabled → notify dependent components
- User logged out → clear sensitive state

## Testing Events

### Unit Tests
```typescript
// Test event emission
it('should emit noteActiveInCall event on successful activation', async () => {
  const handler = jest.fn();
  window.addEventListener('noteActiveInCall', handler);
  
  await activateNote(noteId);
  
  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      detail: expect.objectContaining({ noteId })
    })
  );
  
  window.removeEventListener('noteActiveInCall', handler);
});

// Test event handling
it('should update state when noteActiveInCall event received', () => {
  render(<NotesView />);
  
  window.dispatchEvent(new CustomEvent('noteActiveInCall', {
    detail: { noteId: '123', noteTitle: 'Test', userId: 'user1', timestamp: Date.now() }
  }));
  
  expect(screen.getByText('Live')).toBeInTheDocument();
});
```

### E2E Tests
```typescript
// Cypress test for cross-component event flow
it('should synchronize note state between DailyCall and NotesView', () => {
  cy.visit('/interface');
  cy.get('[data-testid="queue-note-button"]').click();
  cy.get('[data-testid="start-call-button"]').click();
  
  // Verify event propagated to sidebar
  cy.get('[data-testid="note-live-indicator"]').should('be.visible');
});
```

## Common Pitfalls

1. **Memory leaks from missing cleanup**
   - ❌ Wrong: addEventListener without removeEventListener
   - ✅ Correct: Always return cleanup function from useEffect

2. **Stale closures in event handlers**
   - ❌ Wrong: Empty dependency array when using state
   - ✅ Correct: Include all used state/props in dependencies

3. **Over-using events for simple cases**
   - ❌ Wrong: Events for parent-child communication
   - ✅ Correct: Use props/callbacks for direct relationships

4. **Missing TypeScript types**
   - ❌ Wrong: `event: Event` and manual casting everywhere
   - ✅ Correct: Define detail interface, cast once in handler

5. **Emitting before action completes**
   - ❌ Wrong: Emit event, then await API call
   - ✅ Correct: Await API call, then emit on success

6. **Not handling event failures**
   - ❌ Wrong: Only success event, ignore errors
   - ✅ Correct: Different events for success/failure cases

## Integration with Backend Events

**Pattern**: Daily.co app messages → CustomEvent
```typescript
// In DailyCall component
useEffect(() => {
  if (!callObject) return;
  
  const handleAppMessage = (event: DailyEventObjectAppMessage) => {
    const { event_type, note_id, user_id } = event.data;
    
    if (event_type === 'note_activated') {
      // Convert to frontend event
      window.dispatchEvent(new CustomEvent('noteActiveInCall', {
        detail: {
          noteId: note_id,
          userId: user_id,
          timestamp: Date.now()
        }
      }));
    }
  };
  
  callObject.on('app-message', handleAppMessage);
  
  return () => {
    callObject.off('app-message', handleAppMessage);
  };
}, [callObject]);
```

**Important**: Backend events use snake_case, frontend uses camelCase. Convert in the bridge layer.

## Quality Checklist

Before completing event-based features:
- [ ] Event detail interfaces defined with TypeScript
- [ ] Event names follow namespacing convention
- [ ] All listeners have cleanup functions
- [ ] Dependency arrays include all used state/props
- [ ] Both success and error cases emit events
- [ ] Events emitted after action completes (not before)
- [ ] Unit tests cover emission and handling
- [ ] E2E tests verify cross-component coordination
- [ ] No memory leaks from missing removeEventListener
- [ ] Documentation includes event catalog and detail schemas

## Event Catalog Template

Maintain a catalog in feature documentation:
```markdown
## Events

### noteActiveInCall
**Emitted by**: DailyCall component
**Listened by**: NotesView, Sidebar
**Detail**:
- `noteId: string` - Database note ID
- `noteTitle: string` - Note title for display
- `userId: string` - User who activated note
- `timestamp: number` - Activation timestamp

**Trigger**: Note successfully activated in call via POST /context
**Purpose**: Synchronize active note indicators across UI
```

## Related Documentation

- `ARCHITECTURE.reference.md` - Platform architecture overview
- `DEVELOPMENT.reference.md` - Testing patterns
- `docs/PIPECAT_NOTES_COLLABORATION.md` - Event usage example
- `apps/interface/src/features/*/README.md` - Feature-specific event docs

**Full docs** (load on-demand):

- `ARCHITECTURE.md` - Complete event system overview
- `DEVELOPER_GUIDE.md` - Comprehensive development guide
