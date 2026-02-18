/* @jest-environment jsdom */
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { DailyCallStateProvider, useDailyCallState } from '../state/store';

const TestHarness: React.FC = () => {
  const { joined, username, setJoined, setLeft } = useDailyCallState();
  return (
    <div>
      <span data-testid="joined">{joined ? 'yes' : 'no'}</span>
      <span data-testid="username">{username}</span>
      <button onClick={() => setJoined('alice', 'room')}>join</button>
      <button onClick={() => setLeft()}>leave</button>
    </div>
  );
};

describe('DailyCall state store', () => {
  test('join then leave updates state', async () => {
    render(
      <DailyCallStateProvider>
        <TestHarness />
      </DailyCallStateProvider>
    );
    expect(screen.getByTestId('joined')).toHaveTextContent('no');
    
    await act(async () => {
      screen.getByText('join').click();
    });
    await waitFor(() => expect(screen.getByTestId('joined')).toHaveTextContent('yes'));
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
    
    await act(async () => {
      screen.getByText('leave').click();
    });
    await waitFor(() => expect(screen.getByTestId('joined')).toHaveTextContent('no'));
    expect(screen.getByTestId('username')).toHaveTextContent('');
  });
});
