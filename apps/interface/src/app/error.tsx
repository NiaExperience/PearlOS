"use client";

import React from "react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  const handleContactSupport = () => {
    const subject = encodeURIComponent('Access Request - Support');
    const body = encodeURIComponent(
      `Hello,\n\nI need access to this application but am currently unable to log in.\n\nError details: ${error?.message || 'Unknown error'}\n\nPlease help me get access.\n\nThank you.`
    );
    window.open(`mailto:dev@niaxp.com?subject=${subject}&body=${body}`, '_blank');
  };

  return (
    <div className="login-shell" style={{ background: '#05030f', minHeight: '100vh' }}>
      <div className="animated-bg" style={{ 
        background: 'radial-gradient(circle at 30% -10%, rgba(243, 104, 224, 0.35), transparent), radial-gradient(circle at 70% 110%, rgba(0, 210, 211, 0.25), transparent), #05030f',
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0
      }}></div>
      
      <main className="login-content-layer" style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="error-container" style={{
          background: 'rgba(15, 15, 35, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          padding: '40px',
          textAlign: 'center',
          maxWidth: '500px',
          width: '90%',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>
          <h1 style={{
            color: '#ff6b6b',
            background: 'linear-gradient(135deg, #ff6b6b 0%, #ff8e8e 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '28px',
            fontWeight: 'bold',
            marginBottom: '16px'
          }}>
            Access Denied
          </h1>
          <p style={{
            color: '#a0a0a0',
            fontSize: '16px',
            marginBottom: '24px',
            lineHeight: '1.5'
          }}>
            Access denied. Please contact our support team for access.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button
              onClick={() => reset()}
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              Try Again
            </button>
            
            <button
              onClick={handleContactSupport}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#e0e0e0',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              Contact Support
            </button>
          </div>

          <div style={{
            marginTop: '32px',
            paddingTop: '24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#888',
            fontSize: '14px'
          }}>
            <p style={{ margin: '0 0 8px 0' }}>Need immediate assistance?</p>
            <a
              href="mailto:dev@niaxp.com"
              style={{
                color: '#06b6d4',
                textDecoration: 'none',
                fontWeight: '500'
              }}
            >
              dev@niaxp.com
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}