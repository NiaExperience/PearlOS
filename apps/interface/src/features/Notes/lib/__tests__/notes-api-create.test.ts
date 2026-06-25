import { createNote } from '../notes-api';

describe('createNote', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _id: 'work-plan', title: 'Work Plan', content: 'Goals', mode: 'work' }),
    }) as unknown as typeof fetch;
  });

  it('sends note mode to the file-backed notes endpoint', async () => {
    await createNote({ title: 'Work Plan', content: 'Goals', mode: 'work' }, 'pearlos');

    expect(global.fetch).toHaveBeenCalledWith('/api/notes/files?agent=pearlos', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: 'Work Plan', content: 'Goals', mode: 'work' }),
    }));
  });
});
