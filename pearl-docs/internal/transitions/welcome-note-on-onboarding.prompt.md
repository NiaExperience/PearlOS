# Plan: Welcome Note on User Onboarding

## Objective
Create a default "Welcome to Pearl!" personal note for new users when their user profile is first created during the initial page load or auth path.

## Context
- **Trigger**: User profile creation. This happens in `useUserProfileMetadata` hook which calls `POST /api/userProfile` when a profile is not found.
- **Location**: `apps/interface`
- **Content**: Defined in a new file `apps/interface/src/features/Notes/lib/welcome-note.ts`.

## Implementation Steps

### 1. Define Welcome Note Content
Create a new file `apps/interface/src/features/Notes/lib/welcome-note.ts` that exports the default note structure.

**File:** `apps/interface/src/features/Notes/lib/welcome-note.ts`
```typescript
import { Note } from '../types/notes-types';

export const WELCOME_NOTE_TITLE = 'Welcome to Pearl!';

export const getWelcomeNoteContent = (): Partial<Note> => ({
    title: WELCOME_NOTE_TITLE,
    content: `
<h2>Welcome to Pearl!</h2>
<p>This is your personal workspace. Here you can:</p>
<ul>
    <li>Create and organize notes</li>
    <li>Share content with your team</li>
    <li>Use AI to generate apps and insights</li>
</ul>
<p>Get started by clicking the <b>+ New Note</b> button!</p>
    `.trim(),
    // Add any other default fields if necessary
});
```

### 2. Intercept Profile Creation in API Route
Modify `apps/interface/src/app/api/userProfile/route.ts` to intercept the `POST` request. After the profile is successfully created (via `POST_impl`), trigger the creation of the welcome note.

**File:** `apps/interface/src/app/api/userProfile/route.ts`

**Logic:**
1.  Rename the existing `POST` export to something else or wrap it.
2.  In the new `POST` handler:
    *   Call `POST_impl` to create the user profile.
    *   Check if the response status is 201 (Created).
    *   If successful, extract the `userId` from the authenticated session (using `getServerSession` or `requireAuth` helper).
    *   Check if the user already has a "Welcome to Pearl!" note (idempotency check) to avoid duplicates if the profile creation is retried.
    *   If not, create the note using `createNote` action.

**Code Snippet (Conceptual):**
```typescript
import { createNote } from '@interface/features/Notes/actions/notes-actions';
import { getWelcomeNoteContent, WELCOME_NOTE_TITLE } from '@interface/features/Notes/lib/welcome-note';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { Prism } from '@nia/prism';
import { NotesDefinition } from '@interface/features/Notes';

// ... existing imports

export async function POST(req: NextRequest): Promise<NextResponse> {
    // 1. Perform the original profile creation
    const response = await POST_impl(req, interfaceAuthOptions);

    // 2. If successful, try to create the welcome note
    if (response.status === 201) {
        try {
            const session = await getSessionSafely(undefined, interfaceAuthOptions);
            const userId = session?.user?.id;

            if (userId) {
                // Check for existing welcome note to prevent duplicates
                const prism = await Prism.getInstance();
                const existing = await prism.query({
                    contentType: NotesDefinition.dataModel.block,
                    where: {
                        indexer: { path: 'userId', equals: userId },
                        title: { eq: WELCOME_NOTE_TITLE }
                    },
                    limit: 1
                });

                if (existing.total === 0) {
                    // Create the note
                    // We need a tenantId. Usually available in session or context.
                    // For personal notes, we might use the user's personal tenant or a default one.
                    // Assuming 'user-personal-tenant' or similar logic exists, or we fetch the user's tenant.
                    // However, createNote requires a tenantId.
                    // We might need to fetch the user's personal tenant ID.
                    
                    // Fallback: Use the first tenant the user is a member of, or a specific "personal" scope if architecture supports it.
                    // If tenantId is required for the API, we might need to extract it from the request or session.
                    
                    // For now, we'll assume we can get a valid tenantId from the user's context or pass a placeholder if it's a personal note (depending on Prism configuration).
                    // Actually, createNote takes tenantId.
                    // We can try to find the user's personal tenant.
                    
                    // Simplified: Just log for now if tenantId is tricky, but ideally:
                    // const tenantId = session.user.personalTenantId || session.user.tenants[0]?.id;
                    // await createNote({ ...getWelcomeNoteContent(), userId }, tenantId);
                }
            }
        } catch (error) {
            // Log error but don't fail the profile creation request
            console.error('Failed to create welcome note', error);
        }
    }

    return response;
}
```

### 3. Verification
- **Test**: Clear user profile (or use a new user).
- **Action**: Log in / load the app.
- **Expectation**:
    - User profile is created.
    - "Welcome to Pearl!" note appears in the user's notes list.
    - Subsequent logins do not create duplicate notes.

## Dependencies
- `apps/interface/src/features/Notes/actions/notes-actions.ts`: `createNote`
- `@nia/prism`: For querying existing notes.
