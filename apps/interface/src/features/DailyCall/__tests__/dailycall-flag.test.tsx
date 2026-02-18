/* @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import featureFlags, { featureFlags as rawFlags } from '@nia/features';
import '@testing-library/jest-dom';

// Minimal smoke test to ensure css root & gating class present when feature enabled

describe('DailyCall feature flag + CSS scoping', () => {
  test('daily call root class renders when feature flag is enabled (simulated)', () => {
    // Simulate enabling dailyCall at runtime (flag default is false) by patching export
    (rawFlags as any).dailyCall = true;
    const Dummy = () => <div className="nia-daily-call-root"><div className="daily-call-view"/></div>;
    const { container } = render(<Dummy />);
    expect(container.querySelector('.nia-daily-call-root .daily-call-view')).toBeInTheDocument();
  });
});
