export type NotepadMode = 'personal' | 'work';

export type NotepadAction =
  | 'createNote'
  | 'deleteNote'
  | 'saveNote'
  | 'downloadNote'
  | 'writeContent'
  | 'addContent'
  | 'updateContent'
  | 'removeContent'
  | 'switchOrganisationMode'
  | 'updateNoteTitle'
  | 'openNote'
  | 'backToNotes';

export interface NotepadCommandDetail {
  action: NotepadAction;
  payload?: Record<string, unknown>;
}

export function dispatchNotepadCommand(action: NotepadAction, payload?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const detail: NotepadCommandDetail = { action, payload };
  window.dispatchEvent(new CustomEvent('notepadCommand', { detail }));
}


