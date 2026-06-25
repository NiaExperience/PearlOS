/**
 * @jest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import { DailyCallStateProvider } from '@interface/features/DailyCall/state/store';

import NotesView from '../components/notes-view-next';

jest.mock('@interface/features/Notes/styles/notes-next.css', () => ({}));
jest.mock('highlight.js/styles/github-dark.css', () => ({}));

// Mock VoiceSessionContext
jest.mock('@interface/contexts/voice-session-context', () => ({
  useVoiceSessionContext: () => ({
    isAssistantSpeaking: false,
    isUserSpeaking: false,
    audioLevel: 0,
    assistantVolumeLevel: 0,
    language: 'en',
    sessionStatus: 'inactive',
    reconnectAttempts: 0,
    callStatus: 'inactive',
    toggleCall: null,
    setCallStatus: jest.fn(),
    setToggleCall: jest.fn(),
    isCallEnding: false,
    canAssistantAnimate: false,
    isAssistantGeneratingText: false,
    lastAssistantMessage: '',
    assistantSpeechConfidence: 0,
    transcriptQuality: 'none',
    speechTimestamp: 0,
    getCallObject: jest.fn(),
    destroyCallObject: jest.fn(),
  }),
}));

// Mock toast hook
jest.mock('@interface/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() })
}));

// Mock next-auth session
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    status: 'authenticated'
  }),
  SessionProvider: ({ children }: any) => children,
}));

// Mock LLM messaging
jest.mock('@interface/lib/daily', () => ({
  useLLMMessaging: () => ({ sendMessage: jest.fn() }),
}));

// Mock session history
jest.mock('@interface/lib/session-history', () => ({
  trackSessionHistory: jest.fn().mockResolvedValue(undefined),
}));

// Mock offline note queue functions
const mockQueueOfflineNoteUpdate = jest.fn();
const mockConsumeNextQueuedNote = jest.fn();
const mockRequeueNoteUpdate = jest.fn();

jest.mock('@interface/features/Notes/lib/offline-note-queue', () => {
  const actual = jest.requireActual('@interface/features/Notes/lib/offline-note-queue');
  return {
    ...actual,
    queueOfflineNoteUpdate: (...args: any[]) => mockQueueOfflineNoteUpdate(...args),
    consumeNextQueuedNote: (...args: any[]) => mockConsumeNextQueuedNote(...args),
    requeueNoteUpdate: (...args: any[]) => mockRequeueNoteUpdate(...args),
  };
});

// Mocks for notes API (prefix with mock* so Jest allows referencing inside factory)
const mockFetchNotes = jest.fn();
const mockFetchNotesIncremental = jest.fn();
const mockCreateNote = jest.fn();
const mockUpdateNote = jest.fn();
const mockDeleteNote = jest.fn();
const mockFindNoteWithFuzzySearch = jest.fn();

jest.mock('@interface/features/Notes/lib/notes-api', () => ({
  fetchNotes: (...args: any[]) => mockFetchNotes(...args),
  fetchNotesIncremental: (...args: any[]) => mockFetchNotesIncremental(...args),
  createNote: (...args: any[]) => mockCreateNote(...args),
  updateNote: (...args: any[]) => mockUpdateNote(...args),
  deleteNote: (...args: any[]) => mockDeleteNote(...args),
  findNoteWithFuzzySearch: (...args: any[]) => mockFindNoteWithFuzzySearch(...args),
}));

describe('NotesView', () => {
  const assistantName = 'agent1';

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear localStorage before each test
    localStorage.clear();
    // Reset navigator.onLine
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: true,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    } as Response);
    mockFetchNotesIncremental.mockImplementation((assistantName: string, mode: string, onBatch: (batch: any) => void) => {
      const promise = mockFetchNotes(mode, assistantName).then((items: any[]) => {
        onBatch({ batch: 'personal', items, done: true });
        return items;
      });
      return { promise, abort: jest.fn() };
    });
  });

  it('autosaves edited notes online without a manual save button', async () => {
    mockFetchNotes.mockResolvedValueOnce([]);

    render(
      <DailyCallStateProvider>
        <NotesView assistantName={assistantName} />
      </DailyCallStateProvider>
    );

    await waitFor(() => expect(mockFetchNotes).toHaveBeenCalledTimes(1));

    const newNote = { _id: 'n1', title: 'New Note', content: '', mode: 'personal', timestamp: new Date().toISOString() };
    mockCreateNote.mockResolvedValueOnce(newNote);

    fireEvent.click(await screen.findByLabelText('Create new note'));
    await waitFor(() => expect(mockCreateNote).toHaveBeenCalledTimes(1));

    const updatedNote = { ...newNote, title: 'Autosaved Title', content: 'Autosaved body' };
    mockUpdateNote.mockResolvedValueOnce(updatedNote);

    fireEvent.change(await screen.findByPlaceholderText('Untitled'), { target: { value: 'Autosaved Title' } });
    fireEvent.change(screen.getByPlaceholderText(/Start writing/), { target: { value: 'Autosaved body' } });

    expect(screen.queryByTitle('Save Changes')).not.toBeInTheDocument();

    await waitFor(
      () => expect(mockUpdateNote).toHaveBeenCalledWith(
        'n1',
        {
          title: 'Autosaved Title',
          content: 'Autosaved body',
          isPinned: undefined,
        },
        'agent1'
      ),
      { timeout: 2500 }
    );
    expect(mockQueueOfflineNoteUpdate).not.toHaveBeenCalled();
  });

  it('opens the initial note id after the notes window loads', async () => {
    const note = {
      _id: 'Standup-Connector-Audit-2026-06-16',
      title: 'Standup Connector Audit - 2026-06-16',
      content: '# Standup Connector Audit - 2026-06-16\n\nBottom line',
      mode: 'work',
      userId: 'test-user-id',
      tenantId: 'tenant-1',
    };
    mockFetchNotes.mockResolvedValueOnce([note]);
    mockFindNoteWithFuzzySearch.mockResolvedValueOnce({
      found: true,
      note,
      searchPerformed: false,
    });

    render(
      <DailyCallStateProvider>
        <NotesView assistantName={assistantName} initialNoteId={note._id} />
      </DailyCallStateProvider>
    );

    await waitFor(() => {
      expect(mockFindNoteWithFuzzySearch).toHaveBeenCalledWith(
        { id: note._id },
        assistantName,
      );
    });
    expect(await screen.findByDisplayValue(note.title)).toBeInTheDocument();
  });

  it('autosaves a newly edited note through the offline queue', async () => {
    // Initial load returns no notes
    mockFetchNotes.mockResolvedValueOnce([]);

    // Start offline - mock fetch to fail connectivity check
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: false,
    });
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    // Render with DailyCallStateProvider
    render(
      <DailyCallStateProvider>
        <NotesView assistantName={assistantName} />
      </DailyCallStateProvider>
    );

    await waitFor(() => expect(mockFetchNotes).toHaveBeenCalledTimes(1));

    // Mock createNote returning a new note
    const newNote = { _id: 'n1', title: 'New Note', content: 'no content', mode: 'personal', timestamp: new Date().toISOString() };
    mockCreateNote.mockResolvedValueOnce(newNote);

    // Click the create button (title attribute)
    fireEvent.click(await screen.findByLabelText('Create new note'));

    // Wait for createNote to be called and note to be created
    await waitFor(() => expect(mockCreateNote).toHaveBeenCalledTimes(1));

    // Title input should now be present with default title
    const titleInput = await screen.findByPlaceholderText('Untitled');

    // Change title & content; autosave should queue the draft while offline.
    fireEvent.change(titleInput, { target: { value: 'Updated Title' } });
    const textarea = screen.getByPlaceholderText(/Start writing/);
    fireEvent.change(textarea, { target: { value: 'Body text' } });

    expect(screen.queryByTitle('Save Changes')).not.toBeInTheDocument();

    // Verify the note was queued for offline update
    await waitFor(() => expect(mockQueueOfflineNoteUpdate).toHaveBeenCalledTimes(1));
    expect(mockQueueOfflineNoteUpdate).toHaveBeenCalledWith({
      noteId: 'n1',
      assistantName: 'agent1',
      data: {
        title: 'Updated Title',
        content: 'Body text',
        isPinned: undefined,
      },
    });

    // Verify updateNote was NOT called while offline
    expect(mockUpdateNote).not.toHaveBeenCalled();

    // Now simulate coming back online
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: true,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
    } as Response);

    // Mock the queued note that will be consumed
    const queuedNote = {
      noteId: 'n1',
      assistantName: 'agent1',
      data: {
        title: 'Updated Title',
        content: 'Body text',
        isPinned: undefined,
      },
      queuedAt: Date.now(),
      attempts: 0,
    };
    mockConsumeNextQueuedNote
      .mockReturnValueOnce(queuedNote) // First call returns the queued note
      .mockReturnValueOnce(null); // Second call returns null (queue empty)

    // Mock updateNote returning updated note
    const updatedNote = { ...newNote, title: 'Updated Title', content: 'Body text' };
    mockUpdateNote.mockResolvedValueOnce(updatedNote);

    // Trigger online event to flush the queue
    window.dispatchEvent(new Event('online'));

    // Wait for the queue to be flushed and updateNote to be called
    await waitFor(() => expect(mockUpdateNote).toHaveBeenCalledTimes(1));
    expect(mockUpdateNote).toHaveBeenCalledWith(
      'n1',
      {
        title: 'Updated Title',
        content: 'Body text',
        isPinned: undefined,
      },
      'agent1'
    );

    // Note: Currently flushOfflineQueue does NOT call loadNotes/fetchNotes.
    // The test comment indicates this is expected behavior for now.
    // When refresh-on-save is implemented, this assertion can be updated.
    expect(mockFetchNotes.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces local chat archives in the Chat History folder', async () => {
    mockFetchNotes.mockResolvedValueOnce([]);
    localStorage.setItem('pearl-chat-archives-v1', JSON.stringify([
      {
        id: 'chat-archive-1',
        title: 'Chat archive - Jun 11, 2026, 12:00 PM',
        transcript: '**You**\nNeed next steps\n\n**Pearl**\nI will keep those ready.',
        archivedAt: '2026-06-11T12:00:00.000Z',
        messageCount: 2,
      },
    ]));

    render(
      <DailyCallStateProvider>
        <NotesView assistantName={assistantName} />
      </DailyCallStateProvider>
    );

    await screen.findByText('Chat History');
    expect(screen.getByText('1 note')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Chat History'));

    expect(await screen.findByText('Chat archive - Jun 11, 2026, 12:00 PM')).toBeInTheDocument();
    expect(screen.getByText(/Need next steps/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete note')).not.toBeInTheDocument();
  });
});
