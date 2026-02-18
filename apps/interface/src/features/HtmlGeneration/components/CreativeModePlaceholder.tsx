'use client';

import { renderToStaticMarkup } from 'react-dom/server';

const CreativeModePlaceholder = () => (
  <>
    <style>{`
      @keyframes pixelOrbit {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
      }
      @keyframes pixelPulse {
        0%, 100% { opacity: 0.55; filter: drop-shadow(0 0 4px rgba(255, 198, 73, 0.35)); }
        50% { opacity: 1; filter: drop-shadow(0 0 10px rgba(255, 222, 125, 0.75)); }
      }
      @keyframes pixelSpark {
        0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.3; }
        50% { transform: translate(-50%, -50%) scale(1); opacity: 0.8; }
        100% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.3; }
      }
      .creative-shell {
        position: relative;
        min-height: 100vh;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 52px;
        background:
          radial-gradient(ellipse at center, rgba(29, 24, 46, 0.85) 0%, rgba(9, 7, 15, 0.98) 100%),
          url("/createbg.png") center/cover;
        font-family: "Gohufont", monospace;
        color: #fbe9cf;
        box-sizing: border-box;
        letter-spacing: 0.3px;
      }
      .creative-card {
        position: relative;
        width: min(760px, 92vw);
        padding: 44px 52px 56px;
        border: 3px solid rgba(255, 204, 128, 0.4);
        border-radius: 16px;
        background: linear-gradient(145deg, rgba(40, 28, 54, 0.9) 0%, rgba(18, 12, 28, 0.94) 100%);
        box-shadow: 0 22px 42px rgba(8, 5, 15, 0.65), inset 0 0 0 1px rgba(255, 210, 160, 0.08);
      }
      .creative-card::before {
        content: "";
        position: absolute;
        inset: 18px;
        border: 1px solid rgba(255, 220, 175, 0.22);
        border-radius: 10px;
        pointer-events: none;
      }
      .pixel-loader {
        position: relative;
        width: 112px;
        height: 112px;
        margin: 0 auto 36px;
      }
      .pixel-loader span {
        position: absolute;
        width: 20px;
        height: 20px;
        background: linear-gradient(135deg, #ffd86f 0%, #ff9d3c 100%);
        border: 2px solid #47300e;
        border-radius: 4px;
        box-shadow: 0 0 0 2px rgba(255, 235, 180, 0.3);
        animation: pixelPulse 1.8s ease-in-out infinite;
      }
      .pixel-loader span:nth-child(1) { top: 0; left: 50%; transform: translate(-50%, -50%); }
      .pixel-loader span:nth-child(2) { right: 0; top: 50%; transform: translate(50%, -50%); animation-delay: 0.2s; }
      .pixel-loader span:nth-child(3) { bottom: 0; left: 50%; transform: translate(-50%, 50%); animation-delay: 0.4s; }
      .pixel-loader span:nth-child(4) { left: 0; top: 50%; transform: translate(-50%, -50%); animation-delay: 0.6s; }
      .pixel-loader::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 120px;
        height: 120px;
        border: 1px dashed rgba(255, 215, 130, 0.55);
        border-radius: 50%;
        animation: pixelOrbit 6s linear infinite;
        pointer-events: none;
      }
      .pixel-core {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 26px;
        height: 26px;
        background: radial-gradient(circle at center, #ffe9aa 0%, #ffbb5c 70%, rgba(255, 153, 54, 0.85) 100%);
        border-radius: 6px;
        border: 2px solid rgba(48, 30, 19, 0.6);
        transform: translate(-50%, -50%);
        box-shadow: 0 0 20px rgba(255, 193, 79, 0.65);
        animation: pixelSpark 1.8s ease-in-out infinite;
      }
      h1 {
        font-size: 28px;
        margin: 0 0 14px;
        color: #ffe2ad;
        letter-spacing: 4px;
        text-transform: uppercase;
        text-align: center;
      }
      p.lede {
        font-size: 14px;
        line-height: 1.6;
        color: rgba(255, 228, 194, 0.88);
        margin: 0 0 30px;
        text-align: center;
      }
      .creative-grid {
        display: grid;
        gap: 20px;
        margin-bottom: 34px;
      }
      @media (min-width: 640px) {
        .creative-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .creative-panel {
        padding: 20px 22px;
        border-radius: 10px;
        background: rgba(54, 34, 22, 0.72);
        border: 1px solid rgba(255, 210, 160, 0.22);
        box-shadow: inset 0 0 0 1px rgba(255, 210, 160, 0.08);
      }
      .label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 2.4px;
        color: #ffe9c2;
        margin-bottom: 10px;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 12px;
      }
      li {
        font-size: 12.5px;
        color: rgba(255, 234, 205, 0.9);
        line-height: 1.5;
      }
      code {
        background: rgba(255, 190, 90, 0.18);
        padding: 2px 6px;
        border-radius: 6px;
        border: 1px solid rgba(255, 201, 118, 0.35);
        font-size: 12px;
        color: #ffe2ad;
      }
      .creative-footer {
        font-size: 11.5px;
        color: rgba(255, 224, 189, 0.8);
        text-align: center;
      }
    `}</style>
    <div className="creative-shell">
      <div className="creative-card">
        <div className="pixel-loader">
          <span />
          <span />
          <span />
          <span />
          <div className="pixel-core" />
        </div>
        <h1>Creation Studio</h1>
        <p className="lede">
          You don’t have any Apps yet. Ask the assistant to generate one. Describe what you want and it will build HTML, CSS, and JS for you.
        </p>
        <div className="creative-grid">
          <div className="creative-panel">
            <div className="label">Quick Examples</div>
            <ul>
              <li><strong>Game:</strong> <code>Create a tic-tac-toe game with a reset button</code></li>
              <li><strong>Utility:</strong> <code>Build a weather tracker for Pittsburgh with a 5-day forecast</code></li>
              <li><strong>Data Viz:</strong> <code>Generate an interactive bar chart comparing 5 products</code></li>
              <li><strong>Learning:</strong> <code>Create a flashcard quiz for basic Spanish verbs</code></li>
              <li><strong>Timer:</strong> <code>Make a Pomodoro timer with start / pause / reset</code></li>
              <li><strong>Tracker:</strong> <code>Build a simple habit tracker grid for a week</code></li>
            </ul>
          </div>
          <div className="creative-panel">
            <div className="label">Tips</div>
            <ul>
              <li>Be specific about features (e.g., “include a dark mode toggle”).</li>
              <li>Mention any dynamic behavior you want (drag, animate, store data).</li>
              <li>You can iterate: ask the assistant to tweak or extend the result.</li>
            </ul>
          </div>
        </div>
        <p className="creative-footer">
          After generation, you’ll be able to switch between saved Apps using the selector above.
        </p>
      </div>
    </div>
  </>
);

export const renderCreativeModePlaceholder = (): string => {
  return renderToStaticMarkup(<CreativeModePlaceholder />);
};


