'use client';

import React, { useState } from 'react';

export type WaitlistJoinButtonFeedback = 'idle' | 'success' | 'failed';

/** Primary from Cloudinary; `/Slice_9.png` in public/ if CDN fails */
const BETA_SIGNBOARD_IMG_PRIMARY =
  'https://res.cloudinary.com/dxnlbjnzl/image/upload/v1778798003/Slice_9_cg1s1k.png';
const BETA_SIGNBOARD_IMG_FALLBACK = '/Slice_9.png';

interface BetaWaitlistSignboardProps {
  email: string;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  joinButtonFeedback?: WaitlistJoinButtonFeedback;
  error?: string | null;
  message?: string | null;
}

export function BetaWaitlistSignboard({
  email,
  onEmailChange,
  onSubmit,
  isSubmitting,
  joinButtonFeedback = 'idle',
  error,
  message,
}: BetaWaitlistSignboardProps) {
  const [signboardSrc, setSignboardSrc] = useState(BETA_SIGNBOARD_IMG_PRIMARY);

  const joinLabel =
    isSubmitting ? '…' : joinButtonFeedback === 'success' ? 'Sent' : joinButtonFeedback === 'failed' ? 'Failed' : 'Join';

  const submitButtonClass =
    joinButtonFeedback === 'success'
      ? 'beta-waitlist-submit-button beta-waitlist-submit-button--sent'
      : joinButtonFeedback === 'failed'
        ? 'beta-waitlist-submit-button beta-waitlist-submit-button--failed'
        : 'beta-waitlist-submit-button';

  const submitDisabled = isSubmitting || joinButtonFeedback === 'success';

  return (
    <div className="beta-signboard">
      {/*
        Frame = image + overlaid form only. Error sits outside so its height does not
        change the % bottom reference (otherwise the field jumps when the error appears).
      */}
      <div className="beta-signboard-frame">
        <img
          src={signboardSrc}
          alt="Underway! Join Beta List"
          className="beta-signboard-img"
          draggable={false}
          onError={() => {
            setSignboardSrc((current) =>
              current === BETA_SIGNBOARD_IMG_FALLBACK ? current : BETA_SIGNBOARD_IMG_FALLBACK
            );
          }}
        />

        <form
          className="beta-signboard-form beta-waitlist-form"
          onSubmit={onSubmit}
        >
          <input
            type="email"
            className="beta-waitlist-input"
            placeholder="ADD YOUR EMAIL HERE"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            autoComplete="email"
            disabled={isSubmitting}
            required
            aria-label="Email address for beta waitlist"
          />
          <button
            type="submit"
            className={submitButtonClass}
            disabled={submitDisabled}
            aria-live="polite"
          >
            {joinLabel}
          </button>
        </form>
      </div>

      {error ? (
        <p className="beta-waitlist-error beta-signboard-error" role="alert">
          {error}
        </p>
      ) : null}

      {message ? (
        <span className="sr-only" aria-live="polite">
          {message}
        </span>
      ) : null}
    </div>
  );
}
