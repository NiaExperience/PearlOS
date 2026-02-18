'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Mic, MicOff, Plus, Search, Archive, Pin, Trash2, Download, Edit3, Save, X } from 'lucide-react';
import { useToast } from '@interface/hooks/use-toast';

import {
  createNote,
  updateNote,
  deleteNote as deleteNoteApi,
  fetchNotesIncremental,
  findNoteWithFuzzySearch,
  type Note,
} from '@interface/features/Notes/lib/notes-api';

import {
  NIA_EVENT_NOTE_CLOSE,
  NIA_EVENT_NOTE_DOWNLOAD,
  NIA_EVENT_NOTE_MODE_SWITCH,
  NIA_EVENT_NOTE_SAVED,
  NIA_EVENT_NOTES_REFRESH,
  type NiaEventDetail,
} from '@interface/features/DailyCall/events/niaEventRouter';

import './VoiceNotes.css';

interface VoiceNotesProps {
  assistantName: string;
  onClose?: () => void;
  supportedFeatures?: string[];
  tenantId?: string;
}

type NoteMode = 'personal' | 'work';

interface StreamingText {
  id: string;
  text: string;
  isComplete: boolean;
  timestamp: number;
}

export default function VoiceNotes({ assistantName, onClose, supportedFeatures, tenantId }: VoiceNotesProps) {
  const { data: session } = useSession();
  const { toast } = useToast();

  // Core state
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [mode, setMode] = useState<NoteMode>('personal');
  const [isLoading, setIsLoading] = useState(true);

  // Voice & streaming state
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [streamingText, setStreamingText] = useState<StreamingText | null>(null);
  const [voicePulseIntensity, setVoicePulseIntensity] = useState(0);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredNotes, setFilteredNotes] = useState<Note[]>([]);

  // Refs
  const contentRef = useRef<HTMLDivElement>(null);
  const streamingTimeoutRef = useRef<NodeJS.Timeout>();
  const voicePulseRef = useRef<number>(0);

  // Initialize notes
  useEffect(() => {
    loadNotes();
  }, [mode, assistantName]);

  // Filter notes based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredNotes(notes);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredNotes(
        notes.filter(note => 
          note.title.toLowerCase().includes(query) || 
          note.content?.toLowerCase().includes(query)
        )
      );
    }
  }, [notes, searchQuery]);

  // Voice pulse animation
  useEffect(() => {
    if (isVoiceActive) {
      const animate = () => {
        voicePulseRef.current = requestAnimationFrame(() => {
          setVoicePulseIntensity(prev => {
            const next = prev + 0.1;
            return next > 1 ? 0 : next;
          });
          animate();
        });
      };
      animate();
    } else {
      cancelAnimationFrame(voicePulseRef.current);
      setVoicePulseIntensity(0);
    }

    return () => cancelAnimationFrame(voicePulseRef.current);
  }, [isVoiceActive]);

  const loadNotes = async () => {
    try {
      setIsLoading(true);
      const { promise } = fetchNotesIncremental(assistantName, mode, (batch) => {
        if (batch.items.length > 0) {
          setNotes(prev => {
            const existing = new Set(prev.map(n => n._id));
            const newNotes = batch.items.filter(n => n._id && !existing.has(n._id));
            return [...prev, ...newNotes];
          });
        }
      });
      
      await promise;
    } catch (error) {
      toast({
        title: 'Error loading notes',
        description: 'Failed to load your notes. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNote = async () => {
    try {
      const newNote = await createNote(
        { title: 'Untitled Note', content: '', mode },
        assistantName
      );
      setNotes(prev => [newNote, ...prev]);
      setCurrentNote(newNote);
      setIsEditing(true);
    } catch (error) {
      toast({
        title: 'Error creating note',
        description: 'Failed to create a new note.',
        variant: 'destructive',
      });
    }
  };

  const handleSaveNote = async () => {
    if (!currentNote?._id) return;

    try {
      const updatedNote = await updateNote(
        currentNote._id,
        { title: currentNote.title, content: currentNote.content || '' },
        assistantName
      );
      
      setNotes(prev => prev.map(n => n._id === updatedNote._id ? updatedNote : n));
      setCurrentNote(updatedNote);
      setIsEditing(false);
      
      toast({
        title: 'Note saved',
        description: 'Your note has been saved successfully.',
      });
    } catch (error) {
      toast({
        title: 'Error saving note',
        description: 'Failed to save the note.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await deleteNoteApi(noteId, assistantName);
      setNotes(prev => prev.filter(n => n._id !== noteId));
      if (currentNote?._id === noteId) {
        setCurrentNote(null);
      }
      
      toast({
        title: 'Note deleted',
        description: 'The note has been deleted.',
      });
    } catch (error) {
      toast({
        title: 'Error deleting note',
        description: 'Failed to delete the note.',
        variant: 'destructive',
      });
    }
  };

  // Simulate streaming text (this would connect to actual voice stream)
  const simulateStreamingText = (text: string) => {
    const id = Date.now().toString();
    setStreamingText({ id, text: '', isComplete: false, timestamp: Date.now() });
    
    let index = 0;
    const streamChars = () => {
      if (index < text.length) {
        setStreamingText(prev => prev ? {
          ...prev,
          text: text.substring(0, index + 1)
        } : null);
        index++;
        streamingTimeoutRef.current = setTimeout(streamChars, 50);
      } else {
        setStreamingText(prev => prev ? { ...prev, isComplete: true } : null);
        // Auto-commit streaming text to current note after completion
        setTimeout(() => {
          if (currentNote) {
            setCurrentNote(prev => prev ? {
              ...prev,
              content: (prev.content || '') + '\n\n' + text
            } : null);
          }
          setStreamingText(null);
        }, 1000);
      }
    };
    streamChars();
  };

  // Event listeners for bot commands
  useEffect(() => {
    const handleNoteSaved = (event: CustomEvent<NiaEventDetail>) => {
      loadNotes();
    };

    const handleNoteClose = (event: CustomEvent<NiaEventDetail>) => {
      setCurrentNote(null);
      setIsEditing(false);
    };

    const handleNotesRefresh = () => {
      loadNotes();
    };

    const handleNotepadCommand = (event: CustomEvent<any>) => {
      const { detail } = event;
      
      if (detail?.action === 'stream_text' && detail?.text) {
        simulateStreamingText(detail.text);
      } else if (detail?.action === 'voice_start') {
        setIsVoiceActive(true);
      } else if (detail?.action === 'voice_end') {
        setIsVoiceActive(false);
      }
    };

    window.addEventListener(NIA_EVENT_NOTE_SAVED, handleNoteSaved as EventListener);
    window.addEventListener(NIA_EVENT_NOTE_CLOSE, handleNoteClose as EventListener);
    window.addEventListener(NIA_EVENT_NOTES_REFRESH, handleNotesRefresh as EventListener);
    window.addEventListener('notepadCommand', handleNotepadCommand as EventListener);

    return () => {
      window.removeEventListener(NIA_EVENT_NOTE_SAVED, handleNoteSaved as EventListener);
      window.removeEventListener(NIA_EVENT_NOTE_CLOSE, handleNoteClose as EventListener);
      window.removeEventListener(NIA_EVENT_NOTES_REFRESH, handleNotesRefresh as EventListener);
      window.removeEventListener('notepadCommand', handleNotepadCommand as EventListener);
      
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current);
      }
    };
  }, [currentNote, assistantName]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="voice-notes">
      {/* Background gradient */}
      <div className="voice-notes-bg">
        <div className="voice-notes-gradient" />
        <div className="voice-notes-stars" />
      </div>

      {/* Main layout */}
      <div className="voice-notes-layout">
        {/* Sidebar */}
        <aside className={`voice-notes-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
          <header className="sidebar-header">
            <div className="logo-section">
              <div className="pearl-logo">
                <div className={`pearl-orb ${isVoiceActive ? 'active' : ''}`}>
                  <div className="orb-core" style={{
                    transform: `scale(${1 + voicePulseIntensity * 0.3})`,
                    opacity: 0.8 + voicePulseIntensity * 0.2
                  }} />
                  <div className="orb-ring" style={{
                    transform: `scale(${1 + voicePulseIntensity * 0.5})`,
                    opacity: 0.6 + voicePulseIntensity * 0.4
                  }} />
                </div>
              </div>
              <h1 className="app-title">Voice Notes</h1>
            </div>

            <div className="mode-switcher">
              <button
                className={`mode-btn ${mode === 'personal' ? 'active' : ''}`}
                onClick={() => setMode('personal')}
              >
                Personal
              </button>
              <button
                className={`mode-btn ${mode === 'work' ? 'active' : ''}`}
                onClick={() => setMode('work')}
              >
                Work
              </button>
            </div>
          </header>

          <div className="sidebar-controls">
            <div className="search-box">
              <Search className="search-icon" size={16} />
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            <button className="create-btn" onClick={handleCreateNote}>
              <Plus size={16} />
              New Note
            </button>
          </div>

          <div className="notes-list">
            {isLoading ? (
              <div className="loading-state">
                <div className="loading-spinner" />
                <p>Loading notes...</p>
              </div>
            ) : filteredNotes.length === 0 ? (
              <div className="empty-state">
                <Archive size={32} />
                <p>No notes yet</p>
                <span>Start speaking to create your first note</span>
              </div>
            ) : (
              filteredNotes.map((note) => (
                <div
                  key={note._id}
                  className={`note-item ${currentNote?._id === note._id ? 'active' : ''}`}
                  onClick={() => setCurrentNote(note)}
                >
                  <div className="note-header">
                    <h3 className="note-title">{note.title || 'Untitled'}</h3>
                    {note.isPinned && <Pin size={12} className="pin-icon" />}
                  </div>
                  <p className="note-preview">
                    {note.content?.substring(0, 100) || 'No content'}
                  </p>
                  <div className="note-meta">
                    <span className="note-date">{formatDate(note.updatedAt || note.createdAt)}</span>
                    <span className={`note-mode ${note.mode}`}>{note.mode}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="voice-notes-main">
          {currentNote ? (
            <div className="note-editor">
              {/* Editor header */}
              <header className="editor-header">
                <div className="editor-title-section">
                  {isEditing ? (
                    <input
                      type="text"
                      value={currentNote.title}
                      onChange={(e) => setCurrentNote(prev => prev ? {...prev, title: e.target.value} : null)}
                      className="title-input"
                      placeholder="Note title..."
                    />
                  ) : (
                    <h1 className="editor-title">{currentNote.title || 'Untitled Note'}</h1>
                  )}
                </div>

                <div className="editor-actions">
                  {isEditing ? (
                    <>
                      <button className="action-btn save" onClick={handleSaveNote}>
                        <Save size={16} />
                      </button>
                      <button className="action-btn" onClick={() => setIsEditing(false)}>
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="action-btn" onClick={() => setIsEditing(true)}>
                        <Edit3 size={16} />
                      </button>
                      <button className="action-btn" onClick={() => handleDeleteNote(currentNote._id!)}>
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </header>

              {/* Editor content */}
              <div className="editor-content" ref={contentRef}>
                {isEditing ? (
                  <textarea
                    value={currentNote.content || ''}
                    onChange={(e) => setCurrentNote(prev => prev ? {...prev, content: e.target.value} : null)}
                    className="content-textarea"
                    placeholder="Start typing or speak to add content..."
                  />
                ) : (
                  <div className="content-display">
                    {currentNote.content ? (
                      <div 
                        className="content-text"
                        dangerouslySetInnerHTML={{
                          __html: currentNote.content.replace(/\n/g, '<br />')
                        }}
                      />
                    ) : (
                      <p className="empty-content">No content yet. Start speaking to add text.</p>
                    )}
                  </div>
                )}

                {/* Streaming text overlay */}
                {streamingText && (
                  <div className="streaming-overlay">
                    <div className="streaming-container">
                      <div className="streaming-label">
                        <Mic size={14} />
                        Voice input
                      </div>
                      <div className="streaming-text">
                        {streamingText.text.split('').map((char, index) => (
                          <span 
                            key={index}
                            className="streaming-char"
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            {char === ' ' ? '\u00A0' : char}
                          </span>
                        ))}
                        {!streamingText.isComplete && <span className="streaming-cursor">|</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="welcome-state">
              <div className="welcome-content">
                <div className="welcome-orb">
                  <div className={`welcome-pearl ${isVoiceActive ? 'listening' : ''}`}>
                    <div className="pearl-inner" />
                  </div>
                </div>
                <h2 className="welcome-title">Welcome to Voice Notes</h2>
                <p className="welcome-description">
                  Your thoughts, instantly captured. Select a note from the sidebar or create a new one to begin.
                </p>
                <button className="welcome-create-btn" onClick={handleCreateNote}>
                  <Plus size={20} />
                  Create Your First Note
                </button>
              </div>
            </div>
          )}

          {/* Voice indicator */}
          {isVoiceActive && (
            <div className="voice-indicator">
              <div className="voice-wave">
                <div className="wave-bar" style={{ animationDelay: '0ms' }} />
                <div className="wave-bar" style={{ animationDelay: '150ms' }} />
                <div className="wave-bar" style={{ animationDelay: '300ms' }} />
                <div className="wave-bar" style={{ animationDelay: '450ms' }} />
                <div className="wave-bar" style={{ animationDelay: '600ms' }} />
              </div>
              <span className="voice-label">Listening...</span>
            </div>
          )}
        </main>
      </div>

      {/* Sidebar toggle */}
      <button 
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <div className="toggle-line" />
        <div className="toggle-line" />
        <div className="toggle-line" />
      </button>
    </div>
  );
}