'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';

interface Props {
  children: ReactNode;
  /** Custom fallback UI. If omitted, a minimal default fallback with retry is shown. */
  fallback?: ReactNode;
  /** Label for logging (e.g. "Notes", "YouTube"). */
  name?: string;
  /** If true, render nothing on error instead of the default fallback. */
  silent?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private logger = getClientLogger('ErrorBoundary');

  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.logger.error(`Uncaught error in ${this.props.name || 'component'}:`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      if (this.props.silent) {
        return null;
      }

      const label = this.props.name || 'This section';

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            minHeight: 80,
            gap: 12,
            padding: 24,
            color: 'rgba(255,255,255,0.6)',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: 14, opacity: 0.8 }}>
            {label} ran into a problem.
          </span>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '6px 18px',
              fontSize: 13,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
