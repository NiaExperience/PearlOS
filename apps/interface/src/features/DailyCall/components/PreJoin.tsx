'use client';

import React from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

interface PreJoinProps {
  onJoin: () => void | Promise<void>;
  onUsernameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  username: string;
  onClose?: () => void;
  isAdmin: boolean;
}

const PreJoin: React.FC<PreJoinProps> = ({
  onJoin,
  onUsernameChange,
  username,
  onClose,
  isAdmin,
}) => {
  const log = getClientLogger('[daily_call]');

  log.debug('PreJoin rendered', {
    event: 'daily_call_prejoin_render',
    isAdmin,
  });
  const handleJoin = () => {
    if (username.trim()) {
      void onJoin();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && username.trim()) {
      handleJoin();
    }
  };
  // isAdmin can toggle additional UI like admin-only stealth; avoid noisy logs in production

  return (
    <div className="prejoin-container">
      <div className="prejoin-header">
        <div className="prejoin-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="13" height="10" rx="2" ry="2" fill="rgba(59, 130, 246, 0.1)"/>
            <polygon points="16 8 21 6 21 18 16 16 16 8" fill="rgba(59, 130, 246, 0.2)"/>
          </svg>
        </div>
        <h2 className="prejoin-title">Join Forum</h2>
        <p className="prejoin-subtitle">Enter your name to join as a participant</p>
      </div>
      <div className="prejoin-form">
        <label htmlFor="username">Display Name</label>
        <input
          id="username"
          type="text"
          placeholder="Enter your display name"
          value={username}
          onChange={onUsernameChange}
          onKeyPress={handleKeyPress}
          className="prejoin-input"
          autoFocus
        />
        <button onClick={handleJoin} className="prejoin-button" disabled={!username.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="13" height="10" rx="2" ry="2"/>
            <polygon points="16 8 21 6 21 18 16 16 16 8"/>
          </svg>
          Join Meeting
        </button>
        {onClose && (
          <button onClick={onClose} className="prejoin-cancel-button">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default PreJoin;
