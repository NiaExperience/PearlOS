import type { LibraryTemplateDescriptor } from './library-templates';
import { buildStorageBootstrapSnippet } from './storage-library.template';

const STORAGE_BOOTSTRAP = buildStorageBootstrapSnippet();

export const chessPersistentTemplate: LibraryTemplateDescriptor = {
    id: 'chess_persistent',
    libraryType: 'game',
    name: 'Chess (Single/Multiplayer)',
    filename: 'chess-persistent.html',
    description: 'Lightweight chess move tracker that binds white/black to a user and persists moves via NiaAPI.',
    tags: ['game', 'chess', 'board', 'persisted'],
    content: /* html */ `
        ${STORAGE_BOOTSTRAP}
        <div class="chess-shell vivid">
        <div class="hud">
            <div>White: <span id="whitePlayer">-</span></div>
            <div>Black: <span id="blackPlayer">-</span></div>
            <div>Status: <span id="status">active</span></div>
            <div>Turn: <span id="turn">white</span></div>
        </div>
        <div class="controls">
            <div class="session-pill" id="sessionInfo">You: loading…</div>
            <button id="joinWhite">Join White</button>
            <button id="joinBlack">Join Black</button>
            <select id="promotionChoice" disabled>
            <option value="q">♛ Queen</option>
            <option value="r">♜ Rook</option>
            <option value="b">♝ Bishop</option>
            <option value="n">♞ Knight</option>
            </select>
            <button id="endGame">End Game 🔄</button>
        </div>
        <div class="board-row">
            <div class="board" id="board"></div>
            <div class="side-panel">
            <div class="legend">Click a piece, then a highlighted square. Legal moves only.</div>
            <div class="actions">
                <button data-result="draw" class="result-btn">Declare Draw</button>
                <button data-result="surrender" class="result-btn">Resign</button>
            </div>
            <ol id="moves" class="moves"></ol>
            </div>
        </div>
        </div>
        <style>
        :root { --chess-bg: linear-gradient(135deg, #0d1224, #0b1b3c); --accent: #7c3aed; --accent2: #4be1ec; --danger: #ff7b7b; }
        .chess-shell { max-width: 820px; margin: 20px auto; padding: 16px; border-radius: 16px; background: var(--chess-bg); color: #e8f0ff; font-family: "Inter", system-ui, -apple-system, sans-serif; box-shadow: 0 16px 48px rgba(0,0,0,0.45), 0 0 32px rgba(124,58,237,0.25); }
        .hud { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; font-size: 14px; }
        .hud span { font-weight: 700; }
        .controls { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px; }
        .session-pill { display: flex; align-items: center; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: linear-gradient(135deg, rgba(75,225,236,0.12), rgba(124,58,237,0.14)); color: #e8f0ff; font-weight: 700; box-shadow: inset 0 0 18px rgba(124,58,237,0.24); }
        input, select, button { padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: #e8f0ff; font-weight: 700; }
        button { cursor: pointer; background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 8px 24px rgba(124,58,237,0.35); border: none; }
        button:disabled { opacity: 0.5; cursor: not-allowed; background: rgba(255,255,255,0.1); box-shadow: none; }
        select:disabled { opacity: 0.5; cursor: not-allowed; }
        select:not(:disabled) { background: linear-gradient(135deg, rgba(75,225,236,0.3), rgba(124,58,237,0.3)); box-shadow: 0 0 12px rgba(75,225,236,0.4); animation: pulse-promo 1s ease-in-out infinite alternate; }
        @keyframes pulse-promo { from { box-shadow: 0 0 8px rgba(75,225,236,0.3); } to { box-shadow: 0 0 16px rgba(75,225,236,0.6); } }
        .result-btn { background: linear-gradient(135deg, #f97316, #ef4444); }
        .board-row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; align-items: flex-start; }
        .board { position: relative; display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); grid-auto-rows: 1fr; aspect-ratio: 1; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.12); box-shadow: inset 0 0 24px rgba(0,0,0,0.35); }
        .square { position: relative; width: 100%; height: 100%; aspect-ratio: 1; display: grid; place-items: center; font-size: 28px; user-select: none; transition: background 120ms ease, transform 80ms ease; }
        .square.light { background: rgba(255,255,255,0.06); }
        .square.dark { background: rgba(8,14,34,0.9); }
        .square.selected { outline: 2px solid var(--accent2); box-shadow: inset 0 0 0 2px rgba(75,225,236,0.4); }
        .square.legal::after { content: ""; position: absolute; width: 14px; height: 14px; border-radius: 999px; background: rgba(75,225,236,0.7); box-shadow: 0 0 12px rgba(75,225,236,0.5); }
        .square.capture::after { width: 70%; height: 70%; border: 2px solid rgba(255,114,210,0.9); background: rgba(255,114,210,0.16); }
        .square.last { box-shadow: inset 0 0 0 2px rgba(255,209,102,0.6); }
        .square.check { box-shadow: inset 0 0 0 2px rgba(255,123,123,0.7); background: linear-gradient(135deg, rgba(255,123,123,0.2), rgba(255,255,255,0.06)); }
        .side-panel { background: rgba(255,255,255,0.04); border-radius: 12px; padding: 10px; border: 1px solid rgba(255,255,255,0.08); box-shadow: inset 0 0 24px rgba(0,0,0,0.25); }
        .moves { max-height: 320px; overflow: auto; margin: 10px 0 0; padding-left: 16px; }
        .legend { font-size: 12px; opacity: 0.8; margin-bottom: 10px; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .chess-piece { display: block; transition: transform 150ms ease, filter 150ms ease; }
        .chess-piece--w { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); }
        .chess-piece--b { filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); }
        .square:hover .chess-piece { transform: scale(1.08); }
        .square.selected .chess-piece { transform: scale(1.12); filter: drop-shadow(0 0 8px rgba(75,225,236,0.6)); }
        </style>
        <script>
        (() => {
        const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

        // ══════════════════════════════════════════════════════════════════════════════
        // PIECE CONFIGURATION - Edit this section to customize chess piece appearance
        // ══════════════════════════════════════════════════════════════════════════════
        const PIECE_CONFIG = {
            // Color schemes for white and black pieces
            colors: {
            w: { fill: '#f8fafc', stroke: '#334155', shadow: 'rgba(51,65,85,0.4)', glow: 'rgba(248,250,252,0.6)' },
            b: { fill: '#1e293b', stroke: '#94a3b8', shadow: 'rgba(0,0,0,0.5)', glow: 'rgba(148,163,184,0.4)' }
            },
            // SVG path data for each piece type (k=king, q=queen, r=rook, b=bishop, n=knight, p=pawn)
            // Paths are designed for a 24x24 viewBox, centered
            paths: {
            k: 'M12 3L12 5M9 5L15 5M12 5L12 8M7 8C7 8 6 10 6 13C6 16 8 18 12 18C16 18 18 16 18 13C18 10 17 8 17 8L7 8ZM6 18L18 18L18 20L6 20Z',
            q: 'M12 3L14 7L18 5L16 9L20 10L16 12L18 16L12 14L6 16L8 12L4 10L8 9L6 5L10 7L12 3ZM6 18L18 18L18 20L6 20Z',
            r: 'M6 4L6 8L8 8L8 6L10 6L10 8L14 8L14 6L16 6L16 8L18 8L18 4L6 4ZM7 8L7 16L17 16L17 8L7 8ZM5 16L19 16L19 20L5 20Z',
            b: 'M12 3C12 3 10 5 10 7C10 8.5 11 9 12 9C13 9 14 8.5 14 7C14 5 12 3 12 3ZM9 9L9 11L8 12L8 16L16 16L16 12L15 11L15 9L9 9ZM6 16L18 16L18 20L6 20Z',
            n: 'M7 20L7 16C7 16 6 14 8 12C10 10 9 8 9 8L9 6C9 6 10 4 12 4C14 4 15 5 15 7L15 9C15 9 17 10 17 13C17 16 17 20 17 20L7 20ZM10 7C10.5 7 11 6.5 11 6C11 5.5 10.5 5 10 5C9.5 5 9 5.5 9 6C9 6.5 9.5 7 10 7Z',
            p: 'M12 4C10.3 4 9 5.3 9 7C9 8.1 9.6 9 10.5 9.5L9 12L8 12L8 16L16 16L16 12L15 12L13.5 9.5C14.4 9 15 8.1 15 7C15 5.3 13.7 4 12 4ZM6 16L18 16L18 20L6 20Z'
            },
            // Size and styling
            size: 28,       // Piece size in pixels
            strokeWidth: 1.5 // Stroke width for piece outlines
        };

        // Renders a chess piece as styled HTML element
        function renderPiece(color, type) {
            const cfg = PIECE_CONFIG;
            const colors = cfg.colors[color];
            const path = cfg.paths[type];
            if (!path || !colors) return '';
            return '<svg class="chess-piece chess-piece--' + color + '" viewBox="0 0 24 24" width="' + cfg.size + '" height="' + cfg.size + '">' +
            '<defs>' +
                '<filter id="piece-shadow-' + color + '" x="-20%" y="-20%" width="140%" height="140%">' +
                '<feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="' + colors.shadow + '"/>' +
                '</filter>' +
                '<filter id="piece-glow-' + color + '" x="-50%" y="-50%" width="200%" height="200%">' +
                '<feGaussianBlur stdDeviation="1.5" result="blur"/>' +
                '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
                '</filter>' +
            '</defs>' +
            '<path d="' + path + '" fill="' + colors.fill + '" stroke="' + colors.stroke + '" stroke-width="' + cfg.strokeWidth + '" ' +
                'stroke-linejoin="round" stroke-linecap="round" filter="url(#piece-shadow-' + color + ')"/>' +
            '</svg>';
        }
        // ══════════════════════════════════════════════════════════════════════════════

        const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        const boardEl = document.getElementById('board');
        const movesEl = document.getElementById('moves');
        const statusEl = document.getElementById('status');
        const turnEl = document.getElementById('turn');
        const whitePlayerEl = document.getElementById('whitePlayer');
        const blackPlayerEl = document.getElementById('blackPlayer');
        const sessionInfoEl = document.getElementById('sessionInfo');

        let sessionUser = { id: null, name: null };

        const state = {
            players: { white: null, black: null },
            status: 'active',
            winner: null,
            moves: [],
            board: [],
            turn: 'w',
            castling: { w: { k: true, q: true }, b: { k: true, q: true } },
            enPassant: null,
            halfmove: 0,
            fullmove: 1,
            lastMove: null,
            lastSavedAt: null,
            _id: null
        };

        const normalizePlayer = (p) => {
            if (!p) return null;
            if (typeof p === 'string') return { id: p, name: null };
            if (p.id) return { id: p.id, name: p.name || null };
            return null;
        };

        const displayPlayer = (p) => {
            const normalized = normalizePlayer(p);
            if (!normalized) return '-';
            // Always prefer sessionUser.name for current user, regardless of what's stored
            // Use loose equality for ID comparison
            if (sessionUser && sessionUser.id && normalized.id == sessionUser.id && sessionUser.name) {
            return sessionUser.name;
            }
            // Fall back to stored name if available
            if (normalized.name) return normalized.name;
            // Last resort: show the ID
            return normalized.id || '-';
        };

        function updateSessionInfo() {
            if (!sessionInfoEl) return;
            if (sessionUser.id) {
            sessionInfoEl.textContent = 'You: ' + displayPlayer(sessionUser);
            } else {
            sessionInfoEl.textContent = 'You: sign in required to claim';
            }
        }

        function applyAppletSession(cfg) {
            if (!cfg) return;
            sessionUser = {
            id: cfg.userId || cfg.id || null,
            name: cfg.userName || cfg.name || null
            };
            if (sessionUser.id) {
            window.userId = sessionUser.id; // legacy compatibility
            }
            
            // Retroactively update player names in game state if they match the session user
            if (state && state.players && sessionUser.id && sessionUser.name) {
                ['white', 'black'].forEach(role => {
                    const p = state.players[role];
                    if (p) {
                        const pId = (typeof p === 'string') ? p : p.id;
                        if (pId == sessionUser.id) {
                            if (typeof p === 'string') {
                                state.players[role] = { id: sessionUser.id, name: sessionUser.name };
                            } else {
                                p.name = sessionUser.name;
                            }
                        }
                    }
                });
                renderHud();
            }
            
            updateSessionInfo();
        }

        function initSessionListeners() {
            // 1. Try getting config immediately
            const existing = (typeof window.getAppletConfig === 'function' && window.getAppletConfig());
            if (existing) applyAppletSession(existing);

            // 2. Listen for the bridge event
            window.addEventListener('appletConfigReady', (e) => {
                applyAppletSession(e.detail);
                renderHud();
            });

            // 3. Listen for the raw message (backup)
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'APPLET_CONFIG') {
                    applyAppletSession(event.data);
                    renderHud();
                }
            });
            
            // 4. Polling retry mechanism
            let attempts = 0;
            const retryInterval = setInterval(() => {
                attempts++;
                if (sessionUser.id) {
                    clearInterval(retryInterval);
                    return;
                }
                
                // Try getting from bridge again
                const cfg = (typeof window.getAppletConfig === 'function' && window.getAppletConfig());
                if (cfg && cfg.userId) {
                    applyAppletSession(cfg);
                    renderHud();
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
        }

        const opposite = color => (color === 'w' ? 'b' : 'w');
        const pieceColor = p => (p && p === p.toUpperCase() ? 'w' : 'b');
        const pieceType = p => (p || '').toLowerCase();
        const inBounds = (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8;
        const coordToAlgebraic = (x, y) => FILES[x] + (8 - y).toString();
        const algebraicToCoord = (alg) => ({ x: FILES.indexOf(alg[0]), y: 8 - Number(alg[1]) });

        function parseFen(fen) {
            const [placement, turn, castling, ep, half, full] = fen.split(' ');
            const rows = placement.split('/');
            const board = rows.map(row => {
            const acc = [];
            for (const ch of row) {
                if (Number.isInteger(Number(ch))) {
                for (let i = 0; i < Number(ch); i += 1) acc.push(null);
                } else {
                acc.push(ch);
                }
            }
            return acc;
            });
            return {
            board,
            turn: turn === 'w' ? 'w' : 'b',
            castling: {
                w: { k: castling.includes('K'), q: castling.includes('Q') },
                b: { k: castling.includes('k'), q: castling.includes('q') }
            },
            enPassant: ep && ep !== '-' ? algebraicToCoord(ep) : null,
            halfmove: Number(half) || 0,
            fullmove: Number(full) || 1
            };
        }

        function cloneState(src) {
            return {
            ...src,
            board: src.board.map(r => r.slice()),
            castling: { w: { ...src.castling.w }, b: { ...src.castling.b } },
            enPassant: src.enPassant ? { ...src.enPassant } : null,
            moves: [...src.moves],
            lastMove: src.lastMove ? { from: { ...src.lastMove.from }, to: { ...src.lastMove.to } } : null
            };
        }

        function findKing(board, color) {
            for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 1) {
                const p = board[y][x];
                if (p && pieceType(p) === 'k' && pieceColor(p) === color) return { x, y };
            }
            }
            return null;
        }

        function isSquareAttacked(board, x, y, byColor) {
            const enemy = byColor;
            const dir = enemy === 'w' ? -1 : 1;
            const pawnAttacks = [[x - 1, y + dir], [x + 1, y + dir]];
            for (const [px, py] of pawnAttacks) {
            if (inBounds(px, py)) {
                const p = board[py][px];
                if (p && pieceColor(p) === enemy && pieceType(p) === 'p') return true;
            }
            }
            const knightOffsets = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
            for (const [dx, dy] of knightOffsets) {
            const nx = x + dx; const ny = y + dy;
            if (inBounds(nx, ny)) {
                const p = board[ny][nx];
                if (p && pieceColor(p) === enemy && pieceType(p) === 'n') return true;
            }
            }
            const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
            for (const [dx, dy] of directions) {
            let nx = x + dx; let ny = y + dy;
            while (inBounds(nx, ny)) {
                const p = board[ny][nx];
                if (p) {
                const type = pieceType(p);
                const color = pieceColor(p);
                if (color === enemy) {
                    if ((Math.abs(dx) === 1 && Math.abs(dy) === 1 && (type === 'b' || type === 'q')) ||
                        ((dx === 0 || dy === 0) && (type === 'r' || type === 'q')) ||
                        (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && type === 'k')) {
                    return true;
                    }
                }
                break;
                }
                nx += dx; ny += dy;
            }
            }
            return false;
        }

        function generateRawMoves(x, y, state) {
            const board = state.board;
            const piece = board[y][x];
            if (!piece) return [];
            const color = pieceColor(piece);
            const type = pieceType(piece);
            const moves = [];
            if (type === 'p') {
            const dir = color === 'w' ? -1 : 1;
            const startRank = color === 'w' ? 6 : 1;
            const promoRank = color === 'w' ? 0 : 7;
            const oneY = y + dir;
            if (inBounds(x, oneY) && !board[oneY][x]) {
                moves.push({ x, y: oneY, promotion: oneY === promoRank });
                const twoY = y + dir * 2;
                if (y === startRank && !board[twoY][x]) moves.push({ x, y: twoY, enPassantTarget: { x, y: y + dir } });
            }
            for (const dx of [-1, 1]) {
                const tx = x + dx; const ty = y + dir;
                if (!inBounds(tx, ty)) continue;
                if (board[ty][tx] && pieceColor(board[ty][tx]) !== color) {
                moves.push({ x: tx, y: ty, capture: true, promotion: ty === promoRank });
                }
                if (state.enPassant && state.enPassant.x === tx && state.enPassant.y === ty) {
                moves.push({ x: tx, y: ty, capture: true, enPassant: true, promotion: ty === promoRank });
                }
            }
            }
            if (type === 'n') {
            const offsets = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
            offsets.forEach(([dx, dy]) => {
                const nx = x + dx; const ny = y + dy;
                if (!inBounds(nx, ny)) return;
                const target = board[ny][nx];
                if (!target || pieceColor(target) !== color) moves.push({ x: nx, y: ny, capture: Boolean(target) });
            });
            }
            if (type === 'b' || type === 'r' || type === 'q') {
            const dirs = [];
            if (type === 'b' || type === 'q') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
            if (type === 'r' || type === 'q') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
            dirs.forEach(([dx, dy]) => {
                let nx = x + dx; let ny = y + dy;
                while (inBounds(nx, ny)) {
                const target = board[ny][nx];
                if (!target) {
                    moves.push({ x: nx, y: ny });
                } else {
                    if (pieceColor(target) !== color) moves.push({ x: nx, y: ny, capture: true });
                    break;
                }
                nx += dx; ny += dy;
                }
            });
            }
            if (type === 'k') {
            for (let dx = -1; dx <= 1; dx += 1) {
                for (let dy = -1; dy <= 1; dy += 1) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx; const ny = y + dy;
                if (!inBounds(nx, ny)) continue;
                const target = board[ny][nx];
                if (!target || pieceColor(target) !== color) moves.push({ x: nx, y: ny, capture: Boolean(target) });
                }
            }
            const row = color === 'w' ? 7 : 0;
            if (y === row && x === 4) {
                const rights = state.castling[color];
                const enemy = opposite(color);
                if (rights.k && !board[row][5] && !board[row][6] && !isSquareAttacked(board, 4, row, enemy) && !isSquareAttacked(board, 5, row, enemy) && !isSquareAttacked(board, 6, row, enemy)) {
                moves.push({ x: 6, y: row, castle: 'K' });
                }
                if (rights.q && !board[row][1] && !board[row][2] && !board[row][3] && !isSquareAttacked(board, 4, row, enemy) && !isSquareAttacked(board, 3, row, enemy) && !isSquareAttacked(board, 2, row, enemy)) {
                moves.push({ x: 2, y: row, castle: 'Q' });
                }
            }
            }
            return moves;
        }

        function applyMoveInternal(state, move) {
            const board = state.board;
            const from = move.from; const to = { x: move.x, y: move.y };
            const piece = board[from.y][from.x];
            const color = pieceColor(piece);
            let captured = board[to.y][to.x];

            if (move.enPassant) {
            const capY = color === 'w' ? to.y + 1 : to.y - 1;
            captured = board[capY][to.x];
            board[capY][to.x] = null;
            }

            board[from.y][from.x] = null;

            if (move.castle) {
            if (move.castle === 'K') {
                board[to.y][5] = board[to.y][7];
                board[to.y][7] = null;
            } else {
                board[to.y][3] = board[to.y][0];
                board[to.y][0] = null;
            }
            }

            const promo = move.promotion ? (color === 'w' ? move.promotion.toUpperCase() : move.promotion.toLowerCase()) : null;
            board[to.y][to.x] = promo || piece;

            state.enPassant = null;
            if (pieceType(piece) === 'p' && move.enPassantTarget) {
            state.enPassant = { ...move.enPassantTarget };
            }

            if (pieceType(piece) === 'k') state.castling[color] = { k: false, q: false };
            if (pieceType(piece) === 'r') {
            if (color === 'w' && from.y === 7 && from.x === 0) state.castling.w.q = false;
            if (color === 'w' && from.y === 7 && from.x === 7) state.castling.w.k = false;
            if (color === 'b' && from.y === 0 && from.x === 0) state.castling.b.q = false;
            if (color === 'b' && from.y === 0 && from.x === 7) state.castling.b.k = false;
            }
            if (captured && pieceType(captured) === 'r') {
            if (pieceColor(captured) === 'w' && to.y === 7 && to.x === 0) state.castling.w.q = false;
            if (pieceColor(captured) === 'w' && to.y === 7 && to.x === 7) state.castling.w.k = false;
            if (pieceColor(captured) === 'b' && to.y === 0 && to.x === 0) state.castling.b.q = false;
            if (pieceColor(captured) === 'b' && to.y === 0 && to.x === 7) state.castling.b.k = false;
            }

            state.halfmove = pieceType(piece) === 'p' || captured ? 0 : (state.halfmove || 0) + 1;
            if (color === 'b') state.fullmove = (state.fullmove || 1) + 1;
            state.turn = opposite(color);
            state.lastMove = { from: { ...from }, to: { ...to } };

            return { captured, color };
        }

        function legalMovesAt(stateObj, x, y, colorFilter) {
            const board = stateObj.board;
            const piece = board[y][x];
            if (!piece) return [];
            const color = pieceColor(piece);
            if (colorFilter && color !== colorFilter) return [];
            const raw = generateRawMoves(x, y, stateObj);
            const legal = raw.filter(move => {
            const next = cloneState(stateObj);
            applyMoveInternal(next, { ...move, from: { x, y } });
            const king = findKing(next.board, color);
            if (!king) return false;
            return !isSquareAttacked(next.board, king.x, king.y, opposite(color));
            });
            return legal.map(m => ({ ...m, from: { x, y } }));
        }

        function hasAnyLegalMove(color, stateObj) {
            for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 1) {
                const p = stateObj.board[y][x];
                if (p && pieceColor(p) === color) {
                if (legalMovesAt(stateObj, x, y).length) return true;
                }
            }
            }
            return false;
        }

        function kingInCheck(stateObj, color) {
            const king = findKing(stateObj.board, color);
            if (!king) return false;
            return isSquareAttacked(stateObj.board, king.x, king.y, opposite(color));
        }

        function buildNotation(move, captured, wasCheck, wasMate) {
            const piece = state.board[move.from.y][move.from.x];
            const type = pieceType(piece);
            if (move.castle) return move.castle === 'K' ? 'O-O' + (wasMate ? '#' : wasCheck ? '+' : '') : 'O-O-O' + (wasMate ? '#' : wasCheck ? '+' : '');
            const captureMark = captured ? 'x' : '';
            const prefix = type === 'p' ? (captured ? FILES[move.from.x] : '') : type.toUpperCase();
            const dest = coordToAlgebraic(move.x, move.y);
            const promo = move.promotion ? '=' + move.promotion.toUpperCase() : '';
            const suffix = wasMate ? '#' : wasCheck ? '+' : '';
            return prefix + captureMark + dest + promo + suffix;
        }

        function recordMove(notation, color) {
            state.moves.push({ color, notation });
            movesEl.innerHTML = state.moves
            .map((m, i) => '<li>' + (i + 1) + '. ' + (m.color === 'w' ? 'White' : 'Black') + ': ' + m.notation + '</li>')
            .join('');
        }

        function renderBoard(highlightMoves = []) {
            boardEl.innerHTML = '';
            const highlightMap = new Map(highlightMoves.map(m => [m.x + ',' + m.y, m]));
            const renderRows = [7, 6, 5, 4, 3, 2, 1, 0];
            renderRows.forEach(row => {
            for (let col = 0; col < 8; col += 1) {
                const square = document.createElement('div');
                square.className = 'square';
                square.dataset.x = col.toString();
                square.dataset.y = row.toString();
                const isLight = (row + col) % 2 === 0;
                square.classList.add(isLight ? 'light' : 'dark');
                const piece = state.board[row][col];
                if (piece) square.innerHTML = renderPiece(pieceColor(piece), pieceType(piece));
                const key = col + ',' + row;
                if (highlightMap.has(key)) {
                square.classList.add('legal');
                if (highlightMap.get(key).capture) square.classList.add('capture');
                }
                if (state.lastMove && ((state.lastMove.from.x === col && state.lastMove.from.y === row) || (state.lastMove.to.x === col && state.lastMove.to.y === row))) {
                square.classList.add('last');
                }
                const king = findKing(state.board, state.turn);
                if (king && king.x === col && king.y === row && kingInCheck(state, state.turn)) {
                square.classList.add('check');
                }
                boardEl.appendChild(square);
            }
            });
        }

        function renderHud() {
            whitePlayerEl.textContent = displayPlayer(state.players.white);
            blackPlayerEl.textContent = displayPlayer(state.players.black);
            statusEl.textContent = state.status;
            turnEl.textContent = state.turn === 'w' ? 'white' : 'black';
            updateSessionInfo();
            updateJoinButtons();
        }

        function refreshUi() {
            renderBoard();
            movesEl.innerHTML = state.moves
            .map((m, i) => '<li>' + (i + 1) + '. ' + (m.color === 'w' ? 'White' : 'Black') + ': ' + m.notation + '</li>')
            .join('');
            renderHud();
        }

        function persist() {
            if (!window.api?.saveData || !window.api?.updateData) return Promise.resolve();
            const normalizedPlayers = {
            white: normalizePlayer(state.players.white),
            black: normalizePlayer(state.players.black)
            };
            state.players = normalizedPlayers;
            const savedAt = Date.now();
            const payload = { key: 'chess_game_state', state: { ...state, players: normalizedPlayers, lastSavedAt: savedAt } };
            state.lastSavedAt = savedAt;
            if (state._id) {
            return window.api.updateData(state._id, payload).catch(err => console.warn('Chess persist failed', err));
            }
            return window.api.saveData(payload).then(saved => { state._id = saved?._id || null; }).catch(err => console.warn('Chess persist failed', err));
        }

        async function load(options = {}) {
            const refreshUI = options.refreshUI !== false;
            const skipOlder = options.skipOlder !== false;
            let applied = false;
            if (!window.api?.listData) {
            if (refreshUI) refreshUi();
            return applied;
            }
            try {
            const items = await window.api.listData({ key: 'chess_game_state' });
            const first = Array.isArray(items) ? items[0] : null;
            if (first?.data?.state) {
                const s = first.data.state;
                const remoteTs = Number(s.lastSavedAt || 0);
                const localTs = Number(state.lastSavedAt || 0);
                if (skipOlder) {
                if (localTs && !remoteTs) {
                    return applied;
                }
                if (localTs && remoteTs && remoteTs <= localTs) {
                    return applied;
                }
                }
                state.board = s.board || state.board;
                state.turn = s.turn || state.turn;
                state.castling = s.castling || state.castling;
                state.enPassant = s.enPassant || null;
                state.halfmove = s.halfmove || 0;
                state.fullmove = s.fullmove || 1;
                state.players = {
                white: normalizePlayer(s.players?.white) || state.players.white,
                black: normalizePlayer(s.players?.black) || state.players.black
                };

                // Reconcile loaded players with session user
                if (sessionUser && sessionUser.id && sessionUser.name) {
                    ['white', 'black'].forEach(role => {
                        const p = state.players[role];
                        if (p) {
                            const pId = (typeof p === 'string') ? p : p.id;
                            if (pId == sessionUser.id) {
                                if (typeof p === 'string') {
                                    state.players[role] = { id: sessionUser.id, name: sessionUser.name };
                                } else {
                                    p.name = sessionUser.name;
                                }
                            }
                        }
                    });
                }

                state.status = s.status || 'active';
                state.winner = s.winner || null;
                state.moves = s.moves || [];
                state.lastMove = s.lastMove || null;
                state.lastSavedAt = remoteTs || state.lastSavedAt || null;
                state._id = first._id || state._id || null;
                applied = true;
            } else {
                // No remote state found. If we also have no local ID, it means this is a fresh session.
                // Force a reset to ensure the board is initialized correctly and persist the initial state
                // so that other clients can join this game.
                if (!state._id) {
                    console.log('No existing game found. Initializing new game.');
                    resetBoard();
                }
            }
            } catch (err) { console.warn('Chess load failed', err); }
            if (refreshUI || applied) {
            refreshUi();
            }
            return applied;
        }

        let chessPollInterval = null;
        function startPolling() {
            if (chessPollInterval) return;
            chessPollInterval = setInterval(async () => {
            const applied = await load({ refreshUI: false, skipOlder: true });
            if (applied) {
                refreshUi();
            }
            }, 5000);
        }

        function claim(color) {
            if (!sessionUser.id) { alert('Sign in to claim a color.'); return; }
            const slot = color === 'white' ? 'white' : 'black';
            const owner = normalizePlayer(state.players[slot]);
            if (owner && owner.id && owner.id !== sessionUser.id) { alert(slot + ' already taken by ' + displayPlayer(owner)); return; }
            state.players[slot] = { id: sessionUser.id, name: sessionUser.name || null };
            renderHud();
            persist();
        }

        function finishMove(move) {
            const { captured, color } = applyMoveInternal(state, move);
            const enemy = opposite(color);
            const enemyInCheck = kingInCheck(state, enemy);
            const enemyHasMoves = hasAnyLegalMove(enemy, state);
            if (!enemyHasMoves) {
            state.status = enemyInCheck ? 'checkmate' : 'stalemate';
            state.winner = enemyInCheck ? (color === 'w' ? 'white' : 'black') : null;
            } else {
            state.status = 'active';
            state.winner = null;
            }
            const notation = buildNotation(move, captured, enemyInCheck, state.status === 'checkmate');
            recordMove(notation, color);
            renderBoard();
            renderHud();
            persist();
        }

        let selected = null;
        let legalMoves = [];
        let pendingPromotion = null; // { move, fromX, fromY } when awaiting promotion choice

        const promotionSelect = document.getElementById('promotionChoice');

        function updatePromotionUI() {
            if (promotionSelect) {
            promotionSelect.disabled = !pendingPromotion;
            }
        }

        function commitPromotion() {
            if (!pendingPromotion) return;
            const move = { ...pendingPromotion.move };
            move.promotion = promotionSelect?.value || 'q';
            finishMove(move);
            pendingPromotion = null;
            selected = null;
            legalMoves = [];
            updatePromotionUI();
        }

        // When promotion dropdown changes, commit the promotion immediately
        promotionSelect?.addEventListener('change', () => {
            if (pendingPromotion) {
            commitPromotion();
            }
        });

        function handleSquareClick(evt) {
            const target = evt.target.closest('.square');
            if (!target || state.status !== 'active') return;

            // If promotion is pending, ignore board clicks until resolved
            if (pendingPromotion) return;

            const x = Number(target.dataset.x);
            const y = Number(target.dataset.y);
            const piece = state.board[y][x];
            const color = piece ? pieceColor(piece) : null;

            if (selected && selected.x === x && selected.y === y) {
            selected = null; renderBoard(); return;
            }

            const existingMove = legalMoves.find(m => m.x === x && m.y === y);
            if (selected && existingMove) {
            const move = { ...existingMove };
            // Check if this is a pawn promotion move
            if (move.promotion) {
                // Pause for promotion choice
                pendingPromotion = { move, fromX: selected.x, fromY: selected.y };
                updatePromotionUI();
                // Keep the board rendered with the move highlighted
                renderBoard(legalMoves);
                return;
            }
            finishMove(move);
            selected = null; legalMoves = [];
            return;
            }

            if (piece && color === state.turn) {
            const slot = color === 'w' ? 'white' : 'black';
            const owner = normalizePlayer(state.players[slot]);
            if (!sessionUser.id) {
                alert('Sign in and claim ' + slot + ' to move pieces.');
                return;
            }
            if (owner && owner.id && owner.id !== sessionUser.id) {
                alert('Only ' + displayPlayer(owner) + ' can move ' + slot + ' pieces.');
                return;
            }
            if (!owner || !owner.id) {
                alert('Claim ' + slot + ' to move those pieces.');
                return;
            }
            selected = { x, y };
            legalMoves = legalMovesAt(state, x, y, state.turn);
            renderBoard(legalMoves);
            const squares = boardEl.querySelectorAll('.square');
            squares.forEach(sq => {
                if (Number(sq.dataset.x) === x && Number(sq.dataset.y) === y) sq.classList.add('selected');
            });
            }
        }

        function setResult(result) {
            if (state.status !== 'active') return;
            if (result === 'surrender') {
            state.status = 'surrender';
            state.winner = state.turn === 'w' ? 'black' : 'white';
            } else if (result === 'draw') {
            state.status = 'draw';
            state.winner = null;
            }
            renderHud();
            persist().then(() => {
            // Reset board for new game after brief display of result
            setTimeout(() => {
                resetBoard();
            }, 1500);
            });
        }

        function resetBoard() {
            const base = parseFen(INITIAL_FEN);
            state.board = base.board;
            state.turn = base.turn;
            state.castling = base.castling;
            state.enPassant = base.enPassant;
            state.halfmove = base.halfmove;
            state.fullmove = base.fullmove;
            state.status = 'active';
            state.winner = null;
            state.moves = [];
            state.lastMove = null;
            // Clear joined players so new users can claim sides
            state.players = { white: null, black: null };
            // Keep the same ID to overwrite the existing game state so we don't load old games
            // state._id = null;
            state.lastSavedAt = null;
            // Clear selection state
            selected = null;
            legalMoves = [];
            pendingPromotion = null;
            updatePromotionUI();
            movesEl.innerHTML = '';
            renderBoard();
            renderHud();
            persist();
        }

        function updateJoinButtons() {
            const joinWhiteBtn = document.getElementById('joinWhite');
            const joinBlackBtn = document.getElementById('joinBlack');
            const whiteOwner = normalizePlayer(state.players.white);
            const blackOwner = normalizePlayer(state.players.black);
            if (joinWhiteBtn) {
            joinWhiteBtn.disabled = !!(whiteOwner && whiteOwner.id);
            }
            if (joinBlackBtn) {
            joinBlackBtn.disabled = !!(blackOwner && blackOwner.id);
            }
        }

        initSessionListeners();

        boardEl.addEventListener('click', handleSquareClick);
        document.getElementById('joinWhite')?.addEventListener('click', () => claim('white'));
        document.getElementById('joinBlack')?.addEventListener('click', () => claim('black'));
        document.querySelectorAll('.result-btn').forEach(btn => btn.addEventListener('click', (e) => { const result = e.target.dataset.result || ''; setResult(result); }));
        document.getElementById('endGame')?.addEventListener('click', resetBoard);

        const parsed = parseFen(INITIAL_FEN);
        Object.assign(state, parsed);
        renderBoard();
        renderHud();
        load().finally(() => startPolling());
        })();
        </script>`.trim()
}