import type { LibraryTemplateDescriptor } from './library-templates';
import { buildStorageBootstrapSnippet } from './storage-library.template';

const STORAGE_BOOTSTRAP = buildStorageBootstrapSnippet();

export const checkersChallengeTemplate: LibraryTemplateDescriptor = {
    id: 'checkers_challenge',
    libraryType: 'game',
    name: 'Classic Checkers Challenge',
    filename: 'checkers.html',
    description: 'Classic checkers game with a polished UI and smooth gameplay, both single player and multi-player modes, with turn-based mechanics / game persistence.',
    tags: ['game', 'board', 'strategy', 'classic'],
    content: /* html */ `
        ${STORAGE_BOOTSTRAP}
        <title>Classic Checkers Challenge</title>
        <style>
        * {
        box-sizing: border-box;
        }

        h1, h2, h3, h4, h5, h6 {
        position: absolute !important;
        top: 10px !important;
        right: 10px !important;
        font-size: 0.5em !important;
        width: 50% !important;
        max-width: 200px !important;
        text-align: right !important;
        opacity: 0.7 !important;
        z-index: 1000 !important;
        margin: 0 !important;
        padding: 5px !important;
        background: rgba(255,255,255,0.8) !important;
        border-radius: 4px !important;
        }

        :root {
        color-scheme: light;
        --board-size: min(85vw, 560px);
        --cell-radius: 14px;
        --shadow-soft: 0 18px 45px rgba(24, 13, 56, 0.18);
        --gradient-bg: radial-gradient(circle at top left, #f8f0ff 0%, #dfe0ff 45%, #b7c4ff 100%);
        --panel-gradient: linear-gradient(140deg, rgba(255,255,255,0.85), rgba(231,233,255,0.9));
        --panel-border: rgba(255,255,255,0.55);
        --dark-square: linear-gradient(135deg, #54362f, #2e1f1b);
        --light-square: linear-gradient(135deg, #f6f0e8, #ebe0d1);
        }

        body {
        margin: 0;
        min-height: 100vh;
        background: var(--gradient-bg);
        font-family: "Segoe UI", Tahoma, sans-serif;
        color: #1e1b29;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 30px 20px;
        position: relative;
        overflow-x: hidden;
        }

        body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(600px circle at 15% 20%, rgba(255,255,255,0.45), transparent 60%),
                    radial-gradient(400px circle at 85% 70%, rgba(255,255,255,0.3), transparent 70%);
        mix-blend-mode: screen;
        opacity: 0.7;
        z-index: 0;
        }

        .app-shell {
        position: relative;
        z-index: 1;
        display: flex;
        gap: 28px;
        max-width: 1100px;
        width: 100%;
        align-items: flex-start;
        backdrop-filter: blur(6px);
        }

        .board-section {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 18px;
        align-items: center;
        }

        .board-wrapper {
        width: 100%;
        max-width: var(--board-size);
        padding: 16px;
        border-radius: 24px;
        background: linear-gradient(145deg, rgba(255,255,255,0.42), rgba(235,238,255,0.9));
        box-shadow: var(--shadow-soft);
        position: relative;
        overflow: hidden;
        }

        .board-wrapper::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 24px;
        border: 1px solid rgba(255,255,255,0.55);
        pointer-events: none;
        }

        #board {
        width: 100%;
        aspect-ratio: 1;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        grid-template-rows: repeat(8, 1fr);
        gap: 4px;
        padding: 6px;
        background: linear-gradient(135deg, #c7b199, #7a614b);
        border-radius: 18px;
        position: relative;
        transition: box-shadow 0.3s;
        }

        #board.show-hints {
        box-shadow: 0 0 0 3px rgba(255,255,255,0.35), var(--shadow-soft);
        }

        #board.locked {
        pointer-events: none;
        filter: saturate(0.85);
        }

        #board.locked::after {
        content: "🤖 Thinking...";
        position: absolute;
        inset: 0;
        background: rgba(33, 33, 56, 0.18);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 600;
        font-size: clamp(1rem, 2.8vw, 1.4rem);
        text-shadow: 0 4px 12px rgba(0,0,0,0.4);
        border-radius: 18px;
        letter-spacing: 0.05em;
        }

        .cell {
        position: relative;
        border-radius: var(--cell-radius);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        outline: none;
        transition: transform 0.15s ease, box-shadow 0.2s ease, filter 0.2s;
        }

        .cell--light {
        background: var(--light-square);
        box-shadow: inset 0 4px 6px rgba(255,255,255,0.4), inset 0 -4px 12px rgba(209,191,164,0.45);
        }

        .cell--dark {
        background: var(--dark-square);
        box-shadow: inset 0 4px 9px rgba(255,255,255,0.12), inset 0 -5px 16px rgba(0,0,0,0.45);
        }

        .cell--hint::after {
        content: "";
        position: absolute;
        width: 38%;
        height: 38%;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.05) 70%);
        box-shadow: 0 0 12px rgba(255,255,255,0.9);
        opacity: 0.95;
        animation: pulseHint 1.2s infinite ease-in-out;
        }

        .cell--capture::after {
        background: radial-gradient(circle, rgba(255,85,85,0.9) 0%, rgba(255,85,85,0.15) 75%);
        box-shadow: 0 0 16px rgba(255,58,58,0.65);
        }

        .cell--active {
        outline: 3px solid rgba(255,255,255,0.65);
        filter: brightness(1.08);
        }

        .cell--recent {
        box-shadow: 0 0 0 3px rgba(255,255,255,0.32);
        }

        .cell--forced {
        animation: forcedGlow 1.3s infinite ease-in-out;
        }

        .cell:focus-visible {
        outline: 3px solid #7c9dff;
        outline-offset: 0;
        }

        .piece {
        width: 74%;
        height: 74%;
        border-radius: 50%;
        position: relative;
        transform: translateZ(0);
        transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.2s;
        box-shadow: 0 10px 18px rgba(0,0,0,0.35), inset 0 6px 10px rgba(255,255,255,0.45);
        }

        .piece--human {
        background: radial-gradient(circle at 30% 30%, #ffb3b3, #ff5252 55%, #c21f1f 100%);
        }

        .piece--ai {
        background: radial-gradient(circle at 30% 30%, #d4d9ff, #4f5bff 55%, #1f246f 100%);
        }

        .piece--king::after {
        content: "👑";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -48%);
        font-size: clamp(1.1rem, 2.6vw, 1.6rem);
        text-shadow: 0 3px 4px rgba(0,0,0,0.35);
        pointer-events: none;
        }

        .piece--glow {
        box-shadow: 0 12px 22px rgba(255,68,68,0.38), inset 0 6px 12px rgba(255,255,255,0.55);
        }

        .piece--forced {
        animation: piecePulse 1.1s infinite ease-in-out;
        }

        .piece:hover {
        transform: translateY(-3px) scale(1.02);
        }

        .status-area {
        width: 100%;
        max-width: 460px;
        padding: 18px 22px;
        background: var(--panel-gradient);
        border: 1px solid var(--panel-border);
        border-radius: 20px;
        box-shadow: 0 12px 30px rgba(38, 32, 73, 0.15);
        display: flex;
        flex-direction: column;
        gap: 8px;
        backdrop-filter: blur(6px);
        }

        .turn-badge {
        align-self: flex-start;
        padding: 6px 14px;
        border-radius: 999px;
        font-weight: 600;
        letter-spacing: 0.01em;
        background: rgba(255,255,255,0.65);
        color: #322b4f;
        box-shadow: inset 0 2px 6px rgba(255,255,255,0.55);
        }

        .turn-badge--human {
        background: rgba(255,104,104,0.25);
        color: #9e1a1a;
        }

        .turn-badge--ai {
        background: rgba(102,132,255,0.28);
        color: #1b2a82;
        }

        .turn-badge--over {
        background: rgba(255,224,102,0.38);
        color: #6b4c00;
        }

        .status-message {
        margin: 0;
        font-size: clamp(0.9rem, 2.4vw, 1.05rem);
        line-height: 1.5;
        color: #3a2f58;
        display: flex;
        align-items: center;
        gap: 8px;
        position: relative;
        }

        .status-message::before {
        content: "🗨️";
        font-size: 1.1em;
        }

        .side-panel {
        width: clamp(260px, 30%, 360px);
        display: flex;
        flex-direction: column;
        gap: 20px;
        }

        .panel-card {
        padding: 18px 22px;
        border-radius: 20px;
        background: linear-gradient(160deg, rgba(255,255,255,0.9), rgba(236,240,255,0.95));
        border: 1px solid rgba(226, 230, 255, 0.85);
        box-shadow: 0 14px 30px rgba(26, 21, 59, 0.12);
        backdrop-filter: blur(5px);
        }

        .scoreboard {
        display: grid;
        gap: 14px;
        }

        .score-card {
        padding: 16px 18px;
        border-radius: 18px;
        background: linear-gradient(150deg, rgba(255,255,255,0.92), rgba(235,238,255,0.88));
        border: 1px solid rgba(210,215,255,0.8);
        box-shadow: 0 10px 24px rgba(40, 30, 72, 0.08);
        display: flex;
        flex-direction: column;
        gap: 10px;
        }

        .score-card.player {
        border-left: 4px solid rgba(255,76,76,0.7);
        }

        .score-card.ai {
        border-left: 4px solid rgba(88,120,255,0.6);
        }

        .score-card .label {
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #322b4f;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 1.02rem;
        }

        .stat-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        }

        .stat {
        background: rgba(255,255,255,0.7);
        border-radius: 14px;
        padding: 8px 10px;
        text-align: center;
        box-shadow: inset 0 2px 5px rgba(255,255,255,0.4);
        }

        .stat span {
        display: block;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6f6b8c;
        }

        .stat strong {
        display: block;
        margin-top: 4px;
        font-size: 1.2rem;
        color: #2f234c;
        }

        .control-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        }

        .control-grid button {
        font-size: 0.95rem;
        }

        .waiting-msg {
        margin-top: 12px;
        padding: 10px 14px;
        background: linear-gradient(135deg, #fff8e1, #ffe082);
        border-radius: 12px;
        color: #5d4037;
        font-size: 0.9rem;
        text-align: center;
        animation: pulse-waiting 1.5s ease-in-out infinite;
        }
        @keyframes pulse-waiting {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
        }

        button {
        font-family: inherit;
        border: none;
        border-radius: 16px;
        padding: 12px 18px;
        font-weight: 600;
        cursor: pointer;
        position: relative;
        background: linear-gradient(135deg, #5560ff, #8c9bff);
        color: white;
        box-shadow: 0 12px 24px rgba(74, 86, 255, 0.25);
        transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s;
        }

        button.secondary {
        background: linear-gradient(135deg, #ff6b6b, #ff4949);
        box-shadow: 0 12px 24px rgba(255, 84, 84, 0.22);
        }

        button.light {
        background: linear-gradient(135deg, #ffffff, #f1f2ff);
        color: #2e2752;
        box-shadow: 0 12px 22px rgba(39, 33, 73, 0.16);
        }

        button:active {
        transform: translateY(2px);
        box-shadow: 0 6px 16px rgba(27, 20, 61, 0.25);
        }

        button:focus-visible {
        outline: 3px solid rgba(110, 126, 255, 0.8);
        outline-offset: 0;
        }

        .instructions ul {
        margin: 10px 0 0;
        padding-left: 18px;
        display: grid;
        gap: 6px;
        }

        .instructions li {
        font-size: 0.92rem;
        color: #3c345c;
        line-height: 1.4;
        }

        .info-card {
        padding: 18px 20px;
        border-radius: 20px;
        background: linear-gradient(160deg, rgba(255,255,255,0.94), rgba(237,240,255,0.92));
        border: 1px solid rgba(214, 219, 255, 0.85);
        box-shadow: 0 12px 26px rgba(32, 24, 68, 0.11);
        }

        .info-card p {
        margin: 0;
        font-size: 0.95rem;
        color: #382f5a;
        line-height: 1.5;
        }

        .section-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        text-transform: uppercase;
        font-size: 0.78rem;
        letter-spacing: 0.08em;
        color: #625b8d;
        margin-bottom: 12px;
        }

        .history-list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 210px;
        overflow-y: auto;
        display: grid;
        gap: 10px;
        }

        .history-list li {
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(246, 247, 255, 0.88);
        border: 1px solid rgba(218, 223, 255, 0.7);
        font-size: 0.88rem;
        color: #2f2850;
        box-shadow: inset 0 2px 6px rgba(255,255,255,0.55);
        display: flex;
        justify-content: space-between;
        gap: 10px;
        }

        .history-list li span {
        color: #6f6990;
        font-size: 0.78rem;
        }

        .history-empty {
        text-align: center;
        color: #867fb1;
        font-style: italic;
        }

        .history-list::-webkit-scrollbar {
        width: 6px;
        }

        .history-list::-webkit-scrollbar-thumb {
        background: rgba(122, 135, 255, 0.35);
        border-radius: 999px;
        }

        @keyframes pulseHint {
        0%, 100% { transform: scale(0.75); opacity: 0.75; }
        50% { transform: scale(1.05); opacity: 1; }
        }

        @keyframes piecePulse {
        0%, 100% { transform: scale(1); box-shadow: 0 12px 24px rgba(255,89,89,0.35); }
        50% { transform: scale(1.05); box-shadow: 0 16px 28px rgba(255,70,70,0.45); }
        }

        @keyframes forcedGlow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,112,112,0.55); }
        50% { box-shadow: 0 0 0 8px rgba(255,112,112,0.15); }
        }

        @media (max-width: 1080px) {
        .app-shell {
            flex-direction: column;
            align-items: center;
        }
        .board-section {
            order: 1;
        }
        .side-panel {
            width: min(100%, 520px);
            order: 2;
        }
        .control-grid {
            grid-template-columns: 1fr;
        }
        }

        @media (max-width: 640px) {
        body {
            padding: 20px 12px;
        }
        .board-wrapper {
            padding: 12px;
        }
        #board {
            gap: 3px;
            padding: 4px;
        }
        .status-area {
            padding: 14px 16px;
        }
        .piece {
            width: 78%;
            height: 78%;
        }
        }
        </style>
        </head>
        <body>
        <div class="app-shell">
        <div class="board-section">
            <div class="board-wrapper">
            <div id="board" class="board show-hints" aria-label="Checkers board"></div>
            </div>
            <div class="status-area">
            <div id="turnBadge" class="turn-badge turn-badge--human">Your move 🔴</div>
            <p id="statusMessage" class="status-message" aria-live="polite">Welcome challenger! 🔴 makes the first move.</p>
            </div>
        </div>
        <div class="side-panel">
            <div class="scoreboard panel-card">
            <div class="score-card player">
                <span class="label" id="redLabel">Red 🔴</span>
                <div class="stat-grid">
                <div class="stat">
                    <span>Pieces</span>
                    <strong id="playerPieces">12</strong>
                </div>
                <div class="stat">
                    <span>Kings</span>
                    <strong id="playerKings">0</strong>
                </div>
                <div class="stat">
                    <span>Captured</span>
                    <strong id="playerCaptured">0</strong>
                </div>
                </div>
            </div>
            <div class="score-card ai">
                <span class="label" id="blackLabel">Black ⚫</span>
                <div class="stat-grid">
                <div class="stat">
                    <span>Pieces</span>
                    <strong id="aiPieces">12</strong>
                </div>
                <div class="stat">
                    <span>Kings</span>
                    <strong id="aiKings">0</strong>
                </div>
                <div class="stat">
                    <span>Captured</span>
                    <strong id="aiCaptured">0</strong>
                </div>
                </div>
            </div>
            </div>
            <div class="panel-card">
            <div class="control-grid">
                <button id="startSingleBtn" type="button">Start Singleplayer 🤖</button>
                <button id="startMultiBtn" type="button">Start Multiplayer 👥</button>
                <button id="endGameBtn" type="button" style="display:none;" class="danger">End Game 🛑</button>
                <button id="hintBtn" type="button" class="light">Hints: On 💡</button>
            </div>
            <p id="waitingMsg" class="waiting-msg" style="display:none;">Waiting for Black player to join…</p>
            </div>
            <div class="info-card instructions">
            <p>🧠 Face off against a mindful opponent! Remember the essentials:</p>
            <ul>
                <li>🔴 Your pieces march upward; ⚫ moves downward.</li>
                <li>✂️ Captures are mandatory when available.</li>
                <li>👑 Reach the far edge to crown a king.</li>
                <li>🔁 Chain captures if more jumps are open.</li>
            </ul>
            </div>
            <div class="info-card history">
            <span class="section-label">Move Log 📜</span>
            <ul id="historyList" class="history-list">
                <li class="history-empty">No moves yet. Plan your opening! 🌟</li>
            </ul>
            </div>
        </div>
        </div>
        <script>
        'use strict';

        window.sessionUser = { id: null, name: null };
        window.normalizePlayer = function(p) {
        if (!p) return null;
        if (typeof p === 'string') return { id: p, name: null };
        if (p.id) return { id: p.id, name: p.name || null };
        return null;
        };
        window.displayPlayer = function(p) {
        var n = window.normalizePlayer(p);
        if (!n) return '-';
        if (n.name) return n.name;
        // Use loose equality for ID comparison to handle string/number mismatches
        if (window.sessionUser && window.sessionUser.id && window.sessionUser.name && n.id == window.sessionUser.id) {
            return window.sessionUser.name;
        }
        return n.id || '-';
        };

        window.applyAppletSession = function(cfg) {
        if (!cfg) return;
        window.sessionUser = {
            id: cfg.userId || cfg.id || null,
            name: cfg.userName || cfg.name || null
        };

        // Retroactively update player names in game state if they match the session user
        if (window.gameState && window.gameState.players && window.sessionUser.id && window.sessionUser.name) {
            ['human', 'ai'].forEach(function(role) {
                var p = window.gameState.players[role];
                if (p) {
                    var pId = (typeof p === 'string') ? p : p.id;
                    if (pId == window.sessionUser.id) {
                        if (typeof p === 'string') {
                            window.gameState.players[role] = { id: window.sessionUser.id, name: window.sessionUser.name };
                        } else {
                            p.name = window.sessionUser.name;
                        }
                    }
                }
            });
            // Force re-render of assignments to show updated name
            if (window.renderAssignments) window.renderAssignments();
        }
        };

        window.initSessionListeners = function() {
            // 1. Try getting config immediately
            if (typeof window.getAppletConfig === 'function') {
                window.applyAppletSession(window.getAppletConfig());
            }

            // 2. Listen for the bridge event
            window.addEventListener('appletConfigReady', function(e) {
                window.applyAppletSession(e.detail);
                if (window.renderAssignments) window.renderAssignments();
            });

            // 3. Listen for the raw message (backup)
            window.addEventListener('message', function(event) {
                if (event.data && event.data.type === 'APPLET_CONFIG') {
                    window.applyAppletSession(event.data);
                    if (window.renderAssignments) window.renderAssignments();
                }
            });
            
            // 4. Polling retry mechanism
            var attempts = 0;
            var retryInterval = setInterval(function() {
                attempts++;
                if (window.sessionUser && window.sessionUser.id) {
                    clearInterval(retryInterval);
                    return;
                }
                
                // Try getting from bridge again
                var cfg = (typeof window.getAppletConfig === 'function' && window.getAppletConfig());
                if (cfg && cfg.userId) {
                    window.applyAppletSession(cfg);
                    if (window.renderAssignments) window.renderAssignments();
                    clearInterval(retryInterval);
                    return;
                }

                // Request again
                if (window.parent && window.parent !== window) {
                    console.log('Requesting applet config (attempt ' + attempts + ')');
                    window.parent.postMessage({ type: 'REQUEST_APPLET_CONFIG' }, '*');
                }

                if (attempts >= 10) clearInterval(retryInterval);
            }, 500);
        };

        window.gameState = {
        board: [],
        currentPlayer: 'human',
        selected: null,
        selectedMoves: [],
        allMoves: [],
        forcedFrom: null,
        playerCaptured: 0,
        aiCaptured: 0,
        showHints: true,
        gameOver: false,
        moveHistory: [],
        lastMove: null,
        players: { human: null, ai: null },
        gameMode: null,
        _id: null,
        storageVersion: 1,
        lastSavedAt: null,
        aiThinking: false
        };

        window.cloneBoard = function(board) {
        return board.map(function(row) {
            return row.map(function(cell) {
            return cell ? { owner: cell.owner, king: cell.king } : null;
            });
        });
        };

        window.isInsideBoard = function(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
        };

        window.getPieceDirections = function(piece) {
        var dirs = [];
        if (piece.owner === 'human' || piece.king) {
            dirs.push([-1, -1], [-1, 1]);
        }
        if (piece.owner === 'ai' || piece.king) {
            dirs.push([1, -1], [1, 1]);
        }
        return dirs;
        };

        window.getMovesForPiece = function(board, row, col) {
        var piece = board[row][col];
        if (!piece) {
            return [];
        }
        var simpleMoves = [];
        var jumpMoves = [];
        var directions = window.getPieceDirections(piece);

        directions.forEach(function(dir) {
            var newRow = row + dir[0];
            var newCol = col + dir[1];
            if (window.isInsideBoard(newRow, newCol) && !board[newRow][newCol]) {
            var willKing = !piece.king && ((piece.owner === 'human' && newRow === 0) || (piece.owner === 'ai' && newRow === 7));
            simpleMoves.push({
                fromRow: row,
                fromCol: col,
                landingRow: newRow,
                landingCol: newCol,
                sequence: [{ row: newRow, col: newCol }],
                captured: [],
                isCapture: false,
                willBeKing: willKing
            });
            }
        });

        var exploreJumps = function(boardState, currentRow, currentCol, isKingNow, capturedPositions, path) {
            var foundBranch = false;
            var currentPiece = { owner: piece.owner, king: isKingNow };
            var dirs = window.getPieceDirections(currentPiece);

            for (var i = 0; i < dirs.length; i += 1) {
            var dir = dirs[i];
            var midRow = currentRow + dir[0];
            var midCol = currentCol + dir[1];
            var landingRow = currentRow + dir[0] * 2;
            var landingCol = currentCol + dir[1] * 2;
            if (!window.isInsideBoard(midRow, midCol) || !window.isInsideBoard(landingRow, landingCol)) {
                continue;
            }
            var betweenPiece = boardState[midRow][midCol];
            if (!betweenPiece || betweenPiece.owner === piece.owner) {
                continue;
            }
            if (boardState[landingRow][landingCol]) {
                continue;
            }
            foundBranch = true;
            var nextBoard = window.cloneBoard(boardState);
            nextBoard[currentRow][currentCol] = null;
            nextBoard[midRow][midCol] = null;
            var promoted = isKingNow || ((piece.owner === 'human' && landingRow === 0) || (piece.owner === 'ai' && landingRow === 7));
            nextBoard[landingRow][landingCol] = { owner: piece.owner, king: promoted };
            var nextCaptured = capturedPositions.concat([{ row: midRow, col: midCol }]);
            var nextPath = path.concat([{ row: landingRow, col: landingCol }]);
            var allowMore = true;
            if (!isKingNow && promoted) {
                allowMore = false;
            }
            var continued = false;
            if (allowMore) {
                continued = exploreJumps(nextBoard, landingRow, landingCol, promoted, nextCaptured, nextPath);
            }
            if (!allowMore || !continued) {
                jumpMoves.push({
                fromRow: row,
                fromCol: col,
                landingRow: landingRow,
                landingCol: landingCol,
                sequence: nextPath.slice(),
                captured: nextCaptured.slice(),
                isCapture: true,
                willBeKing: promoted && !piece.king
                });
            }
            }
            return foundBranch;
        };

        exploreJumps(board, row, col, piece.king, [], []);

        var allMoves = simpleMoves.concat(jumpMoves);
        return allMoves;
        };

        window.getAllValidMovesForPlayer = function(board, owner) {
        var moves = [];
        for (var r = 0; r < 8; r += 1) {
            for (var c = 0; c < 8; c += 1) {
            if (board[r][c] && board[r][c].owner === owner) {
                var pieceMoves = window.getMovesForPiece(board, r, c);
                moves = moves.concat(pieceMoves);
            }
            }
        }
        var captures = moves.filter(function(move) { return move.isCapture; });
        if (captures.length > 0) {
            return captures;
        }
        return moves;
        };

        window.executeMoveOnBoard = function(board, move) {
        var piece = board[move.fromRow][move.fromCol];
        if (!piece) {
            console.error('executeMoveOnBoard: no piece at source', move);
            return null;
        }
        var movingPiece = { owner: piece.owner, king: piece.king };
        board[move.fromRow][move.fromCol] = null;
        move.captured.forEach(function(cap) {
            board[cap.row][cap.col] = null;
        });
        var finalRow = move.landingRow;
        var finalCol = move.landingCol;
        var shouldKing = !movingPiece.king && ((movingPiece.owner === 'human' && finalRow === 0) || (movingPiece.owner === 'ai' && finalRow === 7));
        if (shouldKing) {
            movingPiece.king = true;
        }
        board[finalRow][finalCol] = movingPiece;
        return {
            finalRow: finalRow,
            finalCol: finalCol,
            kinged: shouldKing,
            piece: movingPiece
        };
        };

        window.beginPlayerTurn = function(customMessage) {
        var state = window.gameState;
        if (state.gameOver) {
            return;
        }
        state.currentPlayer = 'human';
        state.selected = null;
        state.selectedMoves = [];
        state.forcedFrom = null;
        state.allMoves = window.getAllValidMovesForPlayer(state.board, 'human');
        window.updateTurnBadge();
        if (state.allMoves.length === 0) {
            window.declareWinner('ai', 'No legal moves remain for red.');
            return;
        }
        var message = customMessage || 'Red to move 🔴';
        window.setStatusMessage(message);
        window.renderBoard();
        window.persistState && window.persistState();
        };

        window.beginAITurn = function() {
        var state = window.gameState;
        if (state.gameOver) {
            return;
        }
        state.currentPlayer = 'ai';
        state.selected = null;
        state.selectedMoves = [];
        state.forcedFrom = null;
        window.updateTurnBadge();
        window.setStatusMessage('Black to move ⚫');
        window.renderBoard();
        window.persistState && window.persistState();
        };

        window.performAIMove = function() {
        try {
            var state = window.gameState;
            if (state.gameOver) {
            var boardEl = document.getElementById('board');
            if (boardEl) {
                boardEl.classList.remove('locked');
            }
            return;
            }
            var moves = window.getAllValidMovesForPlayer(state.board, 'ai');
            if (moves.length === 0) {
            window.declareWinner('human', 'The AI cannot move anymore.');
            return;
            }
            var bestMove = null;
            var bestScore = -Infinity;
            for (var i = 0; i < moves.length; i += 1) {
            var move = moves[i];
            var simulated = window.cloneBoard(state.board);
            window.executeMoveOnBoard(simulated, move);
            var evalScore = window.evaluateBoard(simulated);
            var captureBonus = move.captured.length * 6.5;
            var kingBonus = move.willBeKing ? 4 : 0;
            var positionBonus = move.landingRow * 0.3;
            var total = evalScore + captureBonus + kingBonus + positionBonus + (move.isCapture ? 0.6 : 0) + Math.random() * 0.1;
            if (total > bestScore) {
                bestScore = total;
                bestMove = move;
            }
            }
            if (!bestMove) {
            window.declareWinner('human', 'The AI is stuck.');
            return;
            }
            var result = window.executeMoveOnBoard(state.board, bestMove);
            if (result === null) {
            window.setStatusMessage('AI encountered an issue making a move. Please restart.');
            console.warn('AI move failed', bestMove);
            return;
            }
            state.aiCaptured += bestMove.captured.length;
            state.lastMove = { owner: 'ai', move: bestMove };
            window.addHistoryEntry('⬛ ' + window.coordsToNotation(bestMove.fromRow, bestMove.fromCol) + ' → ' + window.coordsToNotation(bestMove.landingRow, bestMove.landingCol) + (bestMove.captured.length ? ' ✂️x' + bestMove.captured.length : '') + (result.kinged ? ' 👑' : ''));
            console.log('AI move executed', bestMove);
            window.updateScoreboard();
            window.renderBoard();
            var boardElement = document.getElementById('board');
            if (boardElement) {
            boardElement.classList.remove('locked');
            }
            var ended = window.checkForGameEnd();
            if (!ended) {
            window.beginPlayerTurn('Your turn! 🔴 Respond wisely.');
            }
        } catch (error) {
            console.error('performAIMove error', error);
            window.setStatusMessage('AI hiccup! Try restarting the match 🔁');
            var boardEl = document.getElementById('board');
            if (boardEl) {
            boardEl.classList.remove('locked');
            }
        }
        };

        window.processPlayerMove = function(move) {
        var state = window.gameState;
        var result = window.executeMoveOnBoard(state.board, move);
        if (result === null) {
            window.setStatusMessage('That move could not be completed. Try again.');
            return;
        }
        state.playerCaptured += move.captured.length;
        state.lastMove = { owner: 'human', move: move };
        window.addHistoryEntry('🟥 ' + window.coordsToNotation(move.fromRow, move.fromCol) + ' → ' + window.coordsToNotation(move.landingRow, move.landingCol) + (move.captured.length ? ' ✂️x' + move.captured.length : '') + (result.kinged ? ' 👑' : ''));
        console.log('Player move executed', move);
        window.updateScoreboard();
        window.renderBoard();
        var moreMoves = window.getMovesForPiece(state.board, result.finalRow, result.finalCol).filter(function(m) {
            return m.isCapture;
        });
        if (move.isCapture && moreMoves.length > 0) {
            state.forcedFrom = { row: result.finalRow, col: result.finalCol };
            state.selected = { row: result.finalRow, col: result.finalCol };
            state.selectedMoves = moreMoves;
            state.currentPlayer = 'human';
            window.setStatusMessage('Nice capture! Continue the combo ✂️');
            window.renderBoard();
            window.persistState && window.persistState();
            return;
        }
        state.forcedFrom = null;
        state.selected = null;
        state.selectedMoves = [];
        var ended = window.checkForGameEnd();
        if (!ended) {
            state.currentPlayer = state.currentPlayer === 'human' ? 'ai' : 'human';
            window.updateTurnBadge();
            window.setStatusMessage(state.currentPlayer === 'human' ? 'Red to move 🔴' : 'Black to move ⚫');
            window.persistState && window.persistState();
            window.renderBoard();
            if (state.currentPlayer === 'ai' && window.isAiOpponent()) {
            window.queueAiMove();
            }
        }
        };

        window.handleCellClick = function(event) {
        event.preventDefault();
        var row = parseInt(event.currentTarget.dataset.row, 10);
        var col = parseInt(event.currentTarget.dataset.col, 10);
        window.processCellInteraction(row, col);
        };

        window.handleCellKeyDown = function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            var row = parseInt(event.currentTarget.dataset.row, 10);
            var col = parseInt(event.currentTarget.dataset.col, 10);
            window.processCellInteraction(row, col);
        }
        };

        window.processCellInteraction = function(row, col) {
        var state = window.gameState;
        if (state.gameOver) {
            window.setStatusMessage('The match is over. Tap "New Game" to play again 🏁');
            return;
        }
        var board = state.board;
        var targetPiece = board[row][col];
        var selectedMoves = state.selectedMoves || [];
        var candidateMove = selectedMoves.find(function(move) {
            return move.landingRow === row && move.landingCol === col;
        });
        if (targetPiece && state.currentPlayer !== targetPiece.owner) {
            window.setStatusMessage(state.currentPlayer === 'human' ? 'Red to move 🔴' : 'Black to move ⚫');
            return;
        }
        if (targetPiece && !window.ensureClaim(targetPiece.owner)) {
            return;
        }
        if (candidateMove) {
            window.processPlayerMove(candidateMove);
            return;
        }
        if (targetPiece && targetPiece.owner === 'human') {
            if (state.forcedFrom && (state.forcedFrom.row !== row || state.forcedFrom.col !== col)) {
            window.setStatusMessage('Keep using the capturing piece to finish the combo ✂️');
            return;
            }
            var movesForPiece = [];
            if (state.forcedFrom) {
            movesForPiece = window.getMovesForPiece(board, row, col).filter(function(move) { return move.isCapture; });
            } else {
            var allMoves = window.getAllValidMovesForPlayer(board, 'human');
            state.allMoves = allMoves;
            movesForPiece = allMoves.filter(function(move) {
                return move.fromRow === row && move.fromCol === col;
            });
            }
            if (!movesForPiece || movesForPiece.length === 0) {
            window.setStatusMessage('That piece is blocked. Try another one 🚧');
            state.selected = null;
            state.selectedMoves = [];
            window.renderBoard();
            return;
            }
            if (state.selected && state.selected.row === row && state.selected.col === col && !state.forcedFrom) {
            state.selected = null;
            state.selectedMoves = [];
            window.setStatusMessage('Piece deselected. Choose another one.');
            window.renderBoard();
            return;
            }
            state.selected = { row: row, col: col };
            state.selectedMoves = movesForPiece;
            window.setStatusMessage(movesForPiece[0].isCapture ? 'Capture available! Choose where to land ✂️' : 'Select a highlighted square to move ✅');
            window.renderBoard();
            return;
        }
        if (!targetPiece) {
            if (state.selected) {
            window.setStatusMessage('That square is not a legal move. Try a highlighted one ✨');
            } else {
            window.setStatusMessage('Choose one of your pieces to get started ♟️');
            }
            return;
        }
        if (targetPiece.owner === 'ai') {
            window.setStatusMessage('You cannot move black pieces right now.');
        }
        };

        window.renderBoard = function() {
        var boardElement = document.getElementById('board');
        if (!boardElement) {
            return;
        }
        var state = window.gameState;
        boardElement.innerHTML = '';
        boardElement.classList.toggle('show-hints', !!state.showHints);
        var highlightMap = {};
        if (state.showHints && state.selectedMoves && state.selectedMoves.length) {
            state.selectedMoves.forEach(function(move) {
            var key = move.landingRow + '-' + move.landingCol;
            highlightMap[key] = move.isCapture ? 'capture' : 'move';
            });
        }
        var lastSquares = {};
        if (state.lastMove && state.lastMove.move) {
            lastSquares[state.lastMove.move.fromRow + '-' + state.lastMove.move.fromCol] = true;
            lastSquares[state.lastMove.move.landingRow + '-' + state.lastMove.move.landingCol] = true;
        }
        for (var row = 0; row < 8; row += 1) {
            for (var col = 0; col < 8; col += 1) {
            var cell = document.createElement('div');
            cell.className = 'cell ' + ((row + col) % 2 === 0 ? 'cell--light' : 'cell--dark');
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.setAttribute('role', 'button');
            cell.setAttribute('tabindex', '0');
            cell.addEventListener('click', window.handleCellClick);
            cell.addEventListener('keydown', window.handleCellKeyDown);
            var key = row + '-' + col;
            if (state.selected && state.selected.row === row && state.selected.col === col) {
                cell.classList.add('cell--active');
            }
            if (highlightMap[key]) {
                cell.classList.add('cell--hint');
                if (highlightMap[key] === 'capture') {
                cell.classList.add('cell--capture');
                }
            }
            if (state.forcedFrom && state.forcedFrom.row === row && state.forcedFrom.col === col) {
                cell.classList.add('cell--forced');
            }
            if (lastSquares[key]) {
                cell.classList.add('cell--recent');
            }
            var occupant = state.board[row][col];
            if (occupant) {
                var piece = document.createElement('div');
                piece.className = 'piece ' + (occupant.owner === 'human' ? 'piece--human' : 'piece--ai');
                if (occupant.king) {
                piece.classList.add('piece--king');
                }
                if (state.currentPlayer === 'human' && occupant.owner === 'human' && state.showHints) {
                piece.classList.add('piece--glow');
                }
                if (state.forcedFrom && state.forcedFrom.row === row && state.forcedFrom.col === col) {
                piece.classList.add('piece--forced');
                }
                cell.appendChild(piece);
            }
            boardElement.appendChild(cell);
            }
        }
        };

        window.setStatusMessage = function(message) {
        var element = document.getElementById('statusMessage');
        if (element) {
            element.textContent = message;
        }
        };

        window.countPieces = function(owner) {
        var board = window.gameState.board;
        var pieces = 0;
        var kings = 0;
        for (var r = 0; r < 8; r += 1) {
            for (var c = 0; c < 8; c += 1) {
            var piece = board[r][c];
            if (piece && piece.owner === owner) {
                pieces += 1;
                if (piece.king) {
                kings += 1;
                }
            }
            }
        }
        return { pieces: pieces, kings: kings };
        };

        window.updateScoreboard = function() {
        var playerStats = window.countPieces('human');
        var aiStats = window.countPieces('ai');
        var ids = [
            ['playerPieces', playerStats.pieces],
            ['playerKings', playerStats.kings],
            ['playerCaptured', window.gameState.playerCaptured],
            ['aiPieces', aiStats.pieces],
            ['aiKings', aiStats.kings],
            ['aiCaptured', window.gameState.aiCaptured]
        ];
        ids.forEach(function(pair) {
            var el = document.getElementById(pair[0]);
            if (el) {
            el.textContent = pair[1];
            }
        });
        };

        window.checkForGameEnd = function() {
        var state = window.gameState;
        if (state.gameOver) {
            return true;
        }
        var humanStats = window.countPieces('human');
        var aiStats = window.countPieces('ai');
        if (humanStats.pieces === 0) {
            window.declareWinner('ai', 'Red has no pieces left.');
            return true;
        }
        if (aiStats.pieces === 0) {
            window.declareWinner('human', 'Black has no pieces left!');
            return true;
        }
        var humanMoves = window.getAllValidMovesForPlayer(state.board, 'human');
        if (humanMoves.length === 0) {
            window.declareWinner('ai', 'No legal moves remain for red.');
            return true;
        }
        var aiMoves = window.getAllValidMovesForPlayer(state.board, 'ai');
        if (aiMoves.length === 0) {
            window.declareWinner('human', 'No legal moves remain for black.');
            return true;
        }
        return false;
        };

        window.declareWinner = function(winner, reason) {
        var state = window.gameState;
        state.gameOver = true;
        state.currentPlayer = 'none';
        window.updateTurnBadge();
        var message = '';
        if (winner === 'human') {
            message = 'Victory! 🎉 ' + reason;
        } else if (winner === 'ai') {
            message = 'Defeat! 😢 ' + reason;
        } else {
            message = 'Game over. ' + reason;
        }
        window.setStatusMessage(message);
        window.addHistoryEntry('🏁 ' + message);
        var boardElement = document.getElementById('board');
        if (boardElement) {
            boardElement.classList.remove('locked');
        }
        window.persistState && window.persistState();
        };

        window.addHistoryEntry = function(text) {
        var state = window.gameState;
        state.moveHistory.unshift({ text: text, timestamp: Date.now() });
        if (state.moveHistory.length > 14) {
            state.moveHistory.pop();
        }
        window.renderHistory();
        };

        window.renderHistory = function() {
        var list = document.getElementById('historyList');
        if (!list) {
            return;
        }
        var state = window.gameState;
        if (!state.moveHistory || state.moveHistory.length === 0) {
            list.innerHTML = '<li class="history-empty">No moves yet. Plan your opening! 🌟</li>';
            return;
        }
        var html = '';
        state.moveHistory.forEach(function(entry) {
            var timeAgo = window.formatTimeAgo(entry.timestamp);
            html += '<li><span>' + entry.text + '</span><span>' + timeAgo + '</span></li>';
        });
        list.innerHTML = html;
        };

        window.formatTimeAgo = function(timestamp) {
        var diff = Date.now() - timestamp;
        if (diff < 1000) {
            return 'just now';
        }
        var seconds = Math.round(diff / 1000);
        if (seconds < 60) {
            return seconds + 's ago';
        }
        var minutes = Math.round(seconds / 60);
        if (minutes < 60) {
            return minutes + 'm ago';
        }
        var hours = Math.round(minutes / 60);
        if (hours < 24) {
            return hours + 'h ago';
        }
        var days = Math.round(hours / 24);
        return days + 'd ago';
        };

        window.coordsToNotation = function(row, col) {
        var files = ['A','B','C','D','E','F','G','H'];
        var rank = 8 - row;
        return files[col] + rank;
        };

        window.handleRestart = function() {
        window.initGame();
        window.setStatusMessage('Fresh start! Take the initiative 🔴');
        window.persistState && window.persistState();
        };

        window.updateGameControls = function() {
        var startSingleBtn = document.getElementById('startSingleBtn');
        var startMultiBtn = document.getElementById('startMultiBtn');
        var endGameBtn = document.getElementById('endGameBtn');
        var gameActive = window.gameState.gameMode !== null;
        // Show/hide buttons based on game state
        if (startSingleBtn) startSingleBtn.style.display = gameActive ? 'none' : '';
        if (startMultiBtn) startMultiBtn.style.display = gameActive ? 'none' : '';
        if (endGameBtn) endGameBtn.style.display = gameActive ? '' : 'none';
        // Always reset button text to initial state when showing
        if (startSingleBtn && !gameActive) startSingleBtn.textContent = 'Start Singleplayer 🤖';
        if (startMultiBtn && !gameActive) startMultiBtn.textContent = 'Start Multiplayer 👥';
        if (endGameBtn && gameActive) endGameBtn.textContent = 'End Game 🛑';
        };

        window.startSingleplayer = function() {
        window.gameState.gameMode = 'singleplayer';
        window.gameState.players = {
            human: { id: window.sessionUser.id, name: window.sessionUser.name || null },
            ai: { id: 'AI', name: 'AI Bot' }
        };
        window.initGame();
        window.setStatusMessage('Singleplayer started! Your move 🔴');
        window.updateWaitingMsg();
        window.updateGameControls();
        };

        window.startMultiplayer = function() {
        window.gameState.gameMode = 'multiplayer';
        window.gameState.players = {
            human: { id: window.sessionUser.id, name: window.sessionUser.name || null },
            ai: null
        };
        window.initGame();
        window.setStatusMessage('Multiplayer started! Waiting for Black player…');
        window.updateWaitingMsg();
        window.updateGameControls();
        };

        window.endGame = function() {
        // Reset game state completely
        window.gameState.gameMode = null;
        window.gameState.players = { human: null, ai: null };
        window.gameState.board = window.createInitialBoard();
        window.gameState.currentPlayer = 'human';
        window.gameState.selected = null;
        window.gameState.selectedMoves = [];
        window.gameState.allMoves = [];
        window.gameState.forcedFrom = null;
        window.gameState.playerCaptured = 0;
        window.gameState.aiCaptured = 0;
        window.gameState.gameOver = false;
        window.gameState.moveHistory = [];
        window.gameState.lastMove = null;
        window.gameState._id = null;
        window.gameState.lastSavedAt = null;
        // Persist the reset state
        window.persistState && window.persistState();
        // Update UI
        window.renderHistory();
        window.updateScoreboard();
        window.renderBoard();
        window.renderAssignments();
        window.updateWaitingMsg();
        window.updateGameControls();
        window.setStatusMessage('Game ended. Choose a mode to start!');
        };

        window.updateWaitingMsg = function() {
        var msg = document.getElementById('waitingMsg');
        if (!msg) return;
        var mode = window.gameState.gameMode;
        var blackPlayer = window.normalizePlayer(window.gameState.players.ai);
        if (mode === 'multiplayer' && (!blackPlayer || !blackPlayer.id || blackPlayer.id === 'AI')) {
            msg.style.display = 'block';
            msg.textContent = 'Waiting for Black player to join…';
        } else {
            msg.style.display = 'none';
        }
        };

        window.toggleHints = function() {
        window.gameState.showHints = !window.gameState.showHints;
        window.updateHintButtonLabel();
        window.renderBoard();
        };

        window.updateHintButtonLabel = function() {
        var btn = document.getElementById('hintBtn');
        if (btn) {
            btn.textContent = window.gameState.showHints ? 'Hints: On 💡' : 'Hints: Off 🙈';
            if (window.gameState.showHints) {
            btn.classList.remove('secondary');
            btn.classList.add('light');
            } else {
            btn.classList.remove('light');
            btn.classList.add('secondary');
            }
        }
        };

        window.updateTurnBadge = function() {
        var badge = document.getElementById('turnBadge');
        if (!badge) {
            return;
        }
        var state = window.gameState;
        if (state.gameOver) {
            badge.textContent = 'Game ended 🏁';
            badge.className = 'turn-badge turn-badge--over';
            return;
        }
        if (state.currentPlayer === 'human') {
            badge.textContent = 'Red to move 🔴';
            badge.className = 'turn-badge turn-badge--human';
        } else if (state.currentPlayer === 'ai') {
            badge.textContent = 'Black to move ⚫';
            badge.className = 'turn-badge turn-badge--ai';
        } else {
            badge.textContent = 'Paused';
            badge.className = 'turn-badge';
        }
        };

        window.renderAssignments = function() {
        var redLabel = document.getElementById('redLabel');
        var blackLabel = document.getElementById('blackLabel');
        if (redLabel) {
            var red = window.displayPlayer(window.gameState.players.human);
            redLabel.textContent = 'Red 🔴 - ' + red;
        }
        if (blackLabel) {
            var aiPlayer = window.normalizePlayer(window.gameState.players.ai);
            var black;
            if (window.gameState.gameMode === null) {
            // No game active - show blank like Red
            black = '-';
            } else if (window.gameState.gameMode === 'multiplayer') {
            // In multiplayer mode, show (pending) if no real player has joined
            if (!aiPlayer || !aiPlayer.id) {
                black = '(pending)';
            } else {
                black = window.displayPlayer(aiPlayer);
            }
            } else {
            // In singleplayer mode, default to AI Bot
            if (!aiPlayer) {
                aiPlayer = { id: 'AI', name: 'AI Bot' };
                window.gameState.players.ai = aiPlayer;
            }
            black = window.displayPlayer(aiPlayer);
            }
            blackLabel.textContent = 'Black ⚫ - ' + black;
        }
        };

        window.isAiOpponent = function() {
        if (window.gameState.gameMode === 'multiplayer') return false;
        var ai = window.normalizePlayer(window.gameState.players.ai);
        return !ai || ai.id === 'AI';
        };

        window.queueAiMove = function() {
        if (!window.isAiOpponent()) return;
        if (window.gameState.gameOver) return;
        if (window.gameState.currentPlayer !== 'ai') return;
        if (window.gameState.aiThinking) return;
        window.gameState.aiThinking = true;
        var boardElement = document.getElementById('board');
        if (boardElement) {
            boardElement.classList.add('locked');
        }
        setTimeout(function() {
            try {
            window.performAIMove();
            } finally {
            window.gameState.aiThinking = false;
            }
        }, 350);
        };

        window.startCheckersPolling = function() {
        if (window.checkersPollInterval) return;
        window.checkersPollInterval = setInterval(async function() {
            if (window.gameState.aiThinking) return;
            var updated = await window.loadState({ skipOlder: true });
            if (updated) {
            window.renderAssignments();
            window.updateWaitingMsg && window.updateWaitingMsg();
            window.updateHintButtonLabel();
            window.updateScoreboard();
            window.renderHistory();
            window.updateTurnBadge();
            window.renderBoard();
            if (!window.gameState.gameOver && window.gameState.currentPlayer === 'ai' && window.isAiOpponent()) {
                window.queueAiMove();
            }
            }
        }, 5000);
        };

        window.ensureClaim = function(side) {
        var user = window.sessionUser || {};
        if (!user.id) {
            window.setStatusMessage('Sign in to move pieces.');
            return false;
        }
        var claimed = window.normalizePlayer(window.gameState.players[side]);
        if (claimed && claimed.id && claimed.id !== user.id) {
            window.setStatusMessage('Only ' + window.displayPlayer(claimed) + ' can move for this side.');
            return false;
        }
        if (!claimed || !claimed.id) {
            window.gameState.players[side] = { id: user.id, name: user.name || null };
            window.renderAssignments();
            window.persistState && window.persistState();
        }
        return true;
        };

        window.claimSide = function(side) {
        if (!side || (side !== 'human' && side !== 'ai')) return;
        if (!window.sessionUser.id) {
            alert('Sign in to claim a side.');
            return;
        }
        var claimed = window.normalizePlayer(window.gameState.players[side]);
        if (claimed && claimed.id && claimed.id !== window.sessionUser.id) {
            alert('Already claimed by ' + window.displayPlayer(claimed));
            return;
        }
        window.gameState.players[side] = { id: window.sessionUser.id, name: window.sessionUser.name || null };
        window.renderAssignments();
        window.persistState && window.persistState();
        };

        window.persistState = function() {
        if (!window.api?.saveData || !window.api?.updateData) return Promise.resolve();
        var payload = {
            key: 'checkers_game_state',
            state: {
            board: window.gameState.board,
            currentPlayer: window.gameState.currentPlayer,
            playerCaptured: window.gameState.playerCaptured,
            aiCaptured: window.gameState.aiCaptured,
            showHints: window.gameState.showHints,
            gameOver: window.gameState.gameOver,
            moveHistory: window.gameState.moveHistory,
            lastMove: window.gameState.lastMove,
            players: window.gameState.players,
            gameMode: window.gameState.gameMode,
            storageVersion: window.gameState.storageVersion,
            lastSavedAt: Date.now()
            }
        };
        if (window.gameState._id) {
            return window.api.updateData(window.gameState._id, payload).then(function() {
            window.gameState.lastSavedAt = payload.state.lastSavedAt;
            }).catch(function(err) { console.warn('Checkers persist failed', err); });
        }
        return window.api.saveData(payload).then(function(saved) {
            window.gameState._id = saved?._id || null;
            window.gameState.lastSavedAt = payload.state.lastSavedAt;
        }).catch(function(err) { console.warn('Checkers persist failed', err); });
        };

        window.loadState = async function(options) {
        var opts = options || {};
        if (!window.api?.listData) {
            return false;
        }
        try {
            var items = await window.api.listData({ key: 'checkers_game_state' });
            var first = Array.isArray(items) ? items[0] : null;
            if (first?.data?.state) {
            var s = first.data.state;
            var remoteTs = Number(s.lastSavedAt || 0);
            var localTs = Number(window.gameState.lastSavedAt || 0);
            if (opts.skipOlder !== false) {
                if (localTs && !remoteTs) {
                return false;
                }
                if (localTs && remoteTs && remoteTs <= localTs) {
                return false;
                }
            }
            window.gameState.board = s.board || window.createInitialBoard();
            window.gameState.currentPlayer = s.currentPlayer || 'human';
            window.gameState.playerCaptured = s.playerCaptured || 0;
            window.gameState.aiCaptured = s.aiCaptured || 0;
            window.gameState.showHints = s.showHints !== undefined ? s.showHints : true;
            window.gameState.gameOver = !!s.gameOver;
            window.gameState.moveHistory = s.moveHistory || [];
            window.gameState.lastMove = s.lastMove || null;
            window.gameState.players = s.players || { human: null, ai: null };
            
            // Reconcile loaded players with session user to ensure names are up to date
            if (window.sessionUser && window.sessionUser.id && window.sessionUser.name) {
                ['human', 'ai'].forEach(function(role) {
                    var p = window.gameState.players[role];
                    if (p) {
                        var pId = (typeof p === 'string') ? p : p.id;
                        // Loose equality for ID matching
                        if (pId == window.sessionUser.id) {
                            if (typeof p === 'string') {
                                window.gameState.players[role] = { id: window.sessionUser.id, name: window.sessionUser.name };
                            } else {
                                p.name = window.sessionUser.name;
                            }
                        }
                    }
                });
            }

            window.gameState.gameMode = s.gameMode || 'singleplayer';
            window.gameState.storageVersion = s.storageVersion || window.gameState.storageVersion || 1;
            window.gameState.lastSavedAt = remoteTs || window.gameState.lastSavedAt || null;
            window.gameState.aiThinking = false;
            window.gameState._id = first._id || null;
            return true;
            }
        } catch (err) {
            console.warn('Checkers load failed', err);
        }
        return false;
        };

        window.createInitialBoard = function() {
        var board = [];
        for (var r = 0; r < 8; r += 1) {
            var row = [];
            for (var c = 0; c < 8; c += 1) {
            row.push(null);
            }
            board.push(row);
        }
        for (var rowIndex = 0; rowIndex < 3; rowIndex += 1) {
            for (var colIndex = 0; colIndex < 8; colIndex += 1) {
            if ((rowIndex + colIndex) % 2 === 1) {
                board[rowIndex][colIndex] = { owner: 'ai', king: false };
            }
            }
        }
        for (var rowIndex2 = 5; rowIndex2 < 8; rowIndex2 += 1) {
            for (var colIndex2 = 0; colIndex2 < 8; colIndex2 += 1) {
            if ((rowIndex2 + colIndex2) % 2 === 1) {
                board[rowIndex2][colIndex2] = { owner: 'human', king: false };
            }
            }
        }
        return board;
        };

        window.evaluateBoard = function(board) {
        var humanScore = 0;
        var aiScore = 0;
        for (var r = 0; r < 8; r += 1) {
            for (var c = 0; c < 8; c += 1) {
            var piece = board[r][c];
            if (!piece) {
                continue;
            }
            var base = 1 + (piece.king ? 0.6 : 0);
            if (piece.owner === 'human') {
                humanScore += base + (7 - r) * 0.04;
            } else {
                aiScore += base + r * 0.04;
            }
            }
        }
        return aiScore - humanScore;
        };

        window.initGame = function() {
        var state = window.gameState;
        var hints = state.showHints !== undefined ? state.showHints : true;
        var mode = state.gameMode || 'singleplayer';
        var players = state.players || { human: null, ai: null };
        state.board = window.createInitialBoard();
        state.currentPlayer = 'human';
        state.selected = null;
        state.selectedMoves = [];
        state.allMoves = [];
        state.forcedFrom = null;
        state.playerCaptured = 0;
        state.aiCaptured = 0;
        state.gameOver = false;
        state.moveHistory = [];
        state.lastMove = null;
        state.showHints = hints;
        state.gameMode = mode;
        state.players = players;
        state._id = null;
        state.lastSavedAt = null;
        window.renderHistory();
        window.updateScoreboard();
        window.updateHintButtonLabel();
        window.renderBoard();
        window.beginPlayerTurn('Welcome challenger! 🔴 makes the first move.');
        window.renderAssignments();
        window.persistState && window.persistState();
        console.log('Game initialized');
        };

        window.bindUI = function() {
        var startSingleBtn = document.getElementById('startSingleBtn');
        if (startSingleBtn) {
            startSingleBtn.addEventListener('click', window.startSingleplayer);
        }
        var startMultiBtn = document.getElementById('startMultiBtn');
        if (startMultiBtn) {
            startMultiBtn.addEventListener('click', window.startMultiplayer);
        }
        var endGameBtn = document.getElementById('endGameBtn');
        if (endGameBtn) {
            endGameBtn.addEventListener('click', window.endGame);
        }
        var hintBtn = document.getElementById('hintBtn');
        if (hintBtn) {
            hintBtn.addEventListener('click', window.toggleHints);
        }
        };

        document.addEventListener('DOMContentLoaded', async function() {
        window.initSessionListeners();
        window.bindUI();
        var loaded = await window.loadState({ skipOlder: false });
        window.renderAssignments();
        if (!loaded) {
            // No saved game - show start buttons, don't auto-start
            window.gameState.gameMode = null;
            window.gameState.board = window.createInitialBoard();
            window.updateGameControls();
            window.renderBoard();
            window.setStatusMessage('Choose a mode to start!');
        } else {
            window.updateHintButtonLabel();
            window.updateScoreboard();
            window.renderHistory();
            window.updateTurnBadge();
            window.updateWaitingMsg && window.updateWaitingMsg();
            window.updateGameControls();
            window.setStatusMessage(window.gameState.currentPlayer === 'human' ? 'Red to move 🔴' : 'Black to move ⚫');
            window.renderBoard();
        }
        if (!window.gameState.gameOver && window.gameState.currentPlayer === 'ai' && window.isAiOpponent()) {
            window.queueAiMove();
        }
        if (window.startCheckersPolling) {
            window.startCheckersPolling();
        }
        });
        </script>
        </body>`.trim()
}