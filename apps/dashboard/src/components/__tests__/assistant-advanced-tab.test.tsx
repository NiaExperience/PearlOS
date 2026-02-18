/** @jest-environment jsdom */
import { FeatureKeys } from '@nia/features';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { useForm } from 'react-hook-form';

import { Form } from '@dashboard/components/ui/form';

import AssistantAdvancedTab from '../assistant-advanced-tab';

function Wrapper() {
  const form = useForm({
    defaultValues: {
      desktopMode: 'home',
      supportedFeatures: [...FeatureKeys],
    },
  });

  // Mock fetch for dynamic content definitions
  (global as unknown as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ definitions: [] }),
  }) as unknown as typeof fetch;

  // Only tenantId is used (as a dep), but we can pass a minimal object
  const selectedAssistant = {
    _id: 'a-1',
    tenantId: 't-1',
    name: 'Test Assistant',
  } as unknown as import('@nia/prism/core/blocks').AssistantBlock.IAssistant;

  return (
    <Form {...form}>
      <AssistantAdvancedTab form={form} selectedAssistant={selectedAssistant} />
    </Form>
  );
}

describe('AssistantAdvancedTab - Default Desktop Mode radios', () => {
  test('renders six radios with correct enabled/disabled states', async () => {
    render(<Wrapper />);

    const home = await screen.findByLabelText('Home');
    const work = await screen.findByLabelText('Work');
    const creative = await screen.findByLabelText(/Create/i);
    const quiet = await screen.findByLabelText(/Quiet/i);
    const gaming = await screen.findByLabelText(/Gaming/i);
    const focus = await screen.findByLabelText(/Focus/i);
    const relaxation = await screen.findByLabelText(/Relaxation/i);

    expect((home as HTMLInputElement).disabled).toBe(false);
    expect((work as HTMLInputElement).disabled).toBe(false);
    expect((creative as HTMLInputElement).disabled).toBe(false);
    expect((quiet as HTMLInputElement).disabled).toBe(false);
    expect((gaming as HTMLInputElement).disabled).toBe(true);
    expect((focus as HTMLInputElement).disabled).toBe(true);
    expect((relaxation as HTMLInputElement).disabled).toBe(true);

    // Default should be 'home' checked
    expect((home as HTMLInputElement).checked).toBe(true);
    expect((work as HTMLInputElement).checked).toBe(false);

    // Switch to 'work'
    fireEvent.click(work);
    expect((work as HTMLInputElement).checked).toBe(true);
    expect((home as HTMLInputElement).checked).toBe(false);
  });

  test('renders login feature switches', async () => {
    render(<Wrapper />);

    const googleToggle = await screen.findByText('Login: Google');
    const guestToggle = screen.getByText('Login: Guest');
    const passwordToggle = screen.getByText('Login: Password');

    expect(googleToggle).toBeTruthy();
    expect(guestToggle).toBeTruthy();
    expect(passwordToggle).toBeTruthy();
  });

  test('allows toggling guest login independently of global settings', async () => {
    render(<Wrapper />);

    const guestToggle = await screen.findByRole('checkbox', { name: /Login: Guest/ });
    const guestCheckbox = guestToggle as HTMLInputElement;

    expect(guestCheckbox.checked).toBe(true);

    fireEvent.click(guestCheckbox);
    expect(guestCheckbox.checked).toBe(false);

    fireEvent.click(guestCheckbox);
    expect(guestCheckbox.checked).toBe(true);
  });
});
