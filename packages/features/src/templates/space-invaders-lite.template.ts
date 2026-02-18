import type { LibraryTemplateDescriptor } from './library-templates';
import { buildStorageBootstrapSnippet } from './storage-library.template';

const STORAGE_BOOTSTRAP = buildStorageBootstrapSnippet();

export const spaceInvadersLiteTemplate: LibraryTemplateDescriptor = {
    id: 'space_invaders_lite',
    libraryType: 'game',
    name: 'Space Invaders Lite',
    filename: 'space-invaders-lite.html',
    description: 'Simple version of the arcade classic lane shooter with high-score persistence.',
    tags: ['game', 'shooter', 'arcade', 'persisted'],
    content: /* html */ `
    ${STORAGE_BOOTSTRAP}
    <div class="game-shell neon">
      <div class="starfield"></div>
      <div class="hud">
        <div class="pill"><span>Score</span><strong id="score">0</strong></div>
        <div class="pill accent"><span>High</span><strong id="highScore">0</strong></div>
        <div class="pill danger"><span>Lives</span><strong id="lives">3</strong></div>
      </div>
      <div class="playfield" id="playfield">
        <div class="gradient"></div>
        <div class="obstacles" id="obstacles"></div>
        <div class="player" id="player"><div class="thruster"></div></div>
      </div>
      <div class="controls-row">← → to move • Space to shoot</div>
      <button id="restart">Restart</button>
    </div>
    <style>
      :root {
        --cyan: #4be1ec;
        --magenta: #ff72d2;
        --violet: #7c3aed;
        --amber: #ffd166;
        --bg: radial-gradient(circle at 20% 20%, rgba(255,114,210,0.18), transparent 30%),
              radial-gradient(circle at 80% 0%, rgba(75,225,236,0.18), transparent 28%),
              #070d1f;
      }
      .game-shell { position: relative; max-width: 460px; margin: 18px auto; padding: 14px; border-radius: 16px; background: var(--bg); color: #e8f0ff; font-family: "Inter", system-ui, -apple-system, sans-serif; box-shadow: 0 16px 50px rgba(0,0,0,0.45), 0 0 40px rgba(124,58,237,0.25); overflow: hidden; isolation: isolate; }
      .game-shell .starfield::before, .game-shell .starfield::after { content: ""; position: absolute; inset: 0; background: repeating-radial-gradient(circle at 10% 20%, rgba(255,255,255,0.12), transparent 8%), repeating-radial-gradient(circle at 70% 30%, rgba(255,255,255,0.08), transparent 10%); mix-blend-mode: screen; opacity: 0.6; animation: drift 22s linear infinite; }
      .game-shell .starfield::after { animation-duration: 32s; transform: scale(1.3); opacity: 0.35; }
      @keyframes drift { from { transform: translateY(0); } to { transform: translateY(-20%); } }
      .hud { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; font-size: 14px; }
      .pill { background: linear-gradient(135deg, rgba(75,225,236,0.18), rgba(124,58,237,0.18)); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 10px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 8px 24px rgba(0,0,0,0.28); }
      .pill strong { font-size: 16px; letter-spacing: 0.2px; }
      .pill.accent { background: linear-gradient(135deg, rgba(255,114,210,0.2), rgba(75,225,236,0.18)); }
      .pill.danger { background: linear-gradient(135deg, rgba(255,104,99,0.22), rgba(255,209,102,0.18)); }
      .playfield { position: relative; width: 100%; height: 360px; background: linear-gradient(180deg, rgba(9,13,30,0.8), rgba(12,10,34,0.9)); overflow: hidden; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); box-shadow: inset 0 0 32px rgba(124,58,237,0.3); }
      .playfield .gradient { position: absolute; inset: 0; background: radial-gradient(circle at 50% 80%, rgba(75,225,236,0.12), transparent 42%), radial-gradient(circle at 20% 20%, rgba(255,114,210,0.14), transparent 40%); filter: blur(1px); }
      .player { position: absolute; bottom: 10px; left: 45%; width: 38px; height: 20px; background: linear-gradient(90deg, var(--cyan), var(--magenta)); border-radius: 6px; box-shadow: 0 0 12px rgba(255,114,210,0.5), 0 0 22px rgba(75,225,236,0.4); transition: transform 80ms ease; }
      .player .thruster { position: absolute; left: 50%; bottom: -10px; width: 8px; height: 12px; background: linear-gradient(180deg, rgba(255,209,102,0.9), rgba(255,114,210,0)); border-radius: 10px; transform: translateX(-50%); filter: blur(0.5px); animation: thrust 320ms ease-in-out infinite; }
      @keyframes thrust { 0% { height: 12px; } 50% { height: 18px; } 100% { height: 12px; } }
      .obstacles { position: absolute; inset: 0; pointer-events: none; }
      .obstacle { position: absolute; bottom: 70px; width: 78px; height: 48px; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 2px; padding: 0; border: none; background: transparent; box-shadow: none; }
      .obstacle-block { background: linear-gradient(145deg, rgba(255,255,255,0.78), rgba(124,58,237,0.32)); border-radius: 4px; box-shadow: inset 0 0 6px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.25); }
      .bullet { position: absolute; width: 3px; height: 16px; background: linear-gradient(180deg, #fff, var(--cyan)); border-radius: 2px; box-shadow: 0 0 10px rgba(75,225,236,0.65); }
      .enemy-bullet { position: absolute; width: 4px; height: 12px; background: linear-gradient(180deg, #ff9bf2 0%, #ff5c8d 50%, #ff9bf2 100%); border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; box-shadow: 0 0 12px rgba(255,92,141,0.7), 0 0 4px rgba(255,155,242,0.9); filter: blur(0.4px); animation: squiggle 120ms ease-in-out infinite; }
      @keyframes squiggle { 0%, 100% { transform: scaleX(1) skewX(0deg); } 50% { transform: scaleX(0.85) skewX(8deg); } }
      .enemy { position: absolute; width: 30px; height: 20px; background: linear-gradient(135deg, #ff9bf2, #7f5bff); border-radius: 6px; box-shadow: 0 0 14px rgba(255,114,210,0.45); animation: bob 1.2s ease-in-out infinite; }
      .enemy::after { content: ""; position: absolute; inset: 3px; border-radius: 4px; background: linear-gradient(135deg, rgba(255,255,255,0.5), transparent); opacity: 0.8; }
      @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
      .hit { animation: pulse 220ms ease; }
      @keyframes pulse { from { box-shadow: inset 0 0 0 rgba(255,255,255,0.0); } to { box-shadow: inset 0 0 40px rgba(255,114,210,0.25); } }
      #restart { margin-top: 12px; width: 100%; padding: 12px; border: none; border-radius: 12px; background: linear-gradient(135deg, var(--violet), var(--magenta)); color: #fff; font-weight: 800; letter-spacing: 0.3px; cursor: pointer; box-shadow: 0 12px 32px rgba(124,58,237,0.45); }
      .controls-row { margin-top: 12px; font-size: 12px; text-align: center; opacity: 0.86; letter-spacing: 0.3px; text-transform: uppercase; }
      .gameover { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,0.55); color: #e8f0ff; font-weight: 800; font-size: 22px; letter-spacing: 0.5px; text-shadow: 0 4px 14px rgba(0,0,0,0.45); opacity: 0; pointer-events: none; transition: opacity 200ms ease; }
      .gameover.visible { opacity: 1; }
    </style>
    <script>
      (() => {
        const MAX_BULLETS = 3;
        const MAX_ENEMIES = 14;
        const SHOT_COOLDOWN_MS = 240;
        const BULLET_SPEED = 3;
        const ENEMY_STEP_PX = 8;
        const ENEMY_DROP_PX = 18;
        const ENEMY_STEP_INTERVAL = 12;
        const PLAYER_SPEED = 4;

        const state = { score: 0, highScore: 0, lives: 3, running: true, bullets: [], enemyBullets: [], enemies: [], obstacles: [], enemyDir: 1, enemyStepCounter: 0, _id: null, lastShotAt: 0, rafId: null };
        const field = document.getElementById('playfield');
        const player = document.getElementById('player');
        const gameOverEl = document.createElement('div');
        gameOverEl.className = 'gameover';
        gameOverEl.textContent = 'Game Over';
        field?.appendChild(gameOverEl);
        const obstaclesLayer = document.getElementById('obstacles');
        const scoreEl = document.getElementById('score');
        const highScoreEl = document.getElementById('highScore');
        const livesEl = document.getElementById('lives');
        let moveDir = 0;
        let destroyed = false;
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

        const hasDom = () => !!(field?.isConnected && player?.isConnected && scoreEl?.isConnected && highScoreEl?.isConnected && livesEl?.isConnected);

        function stopLoop(reason) {
          state.running = false;
          if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
          }
          console.warn('[Space Invaders Lite] stopped:', reason);
        }

        function scheduleNext() {
          if (destroyed || !state.running) return;
          state.rafId = requestAnimationFrame(tick);
        }

        function renderHud() {
          if (!scoreEl || !highScoreEl || !livesEl) return;
          scoreEl.textContent = state.score.toString();
          highScoreEl.textContent = state.highScore.toString();
          livesEl.textContent = state.lives.toString();
        }

        function flashField() {
          if (!field) return;
          field.classList.add('hit');
          setTimeout(() => field.classList.remove('hit'), 180);
        }

        function removeObstacleColumn(obstacle, col) {
          if (!obstacle || !obstacle.blocks) return true;
          let anyRemaining = false;
          obstacle.blocks.forEach((blk) => {
            if (!blk) return;
            if (blk.destroyed) return;
            if (blk.col === col) {
              blk.destroyed = true;
              if (blk.el) blk.el.style.visibility = 'hidden';
            } else {
              anyRemaining = true;
            }
          });
          if (!anyRemaining) {
            obstacle.el?.remove();
            return true;
          }
          return false;
        }

        function removeObstacleBlock(obstacle, target) {
          if (!obstacle || !obstacle.blocks) return true;
          let anyRemaining = false;
          obstacle.blocks.forEach((blk) => {
            if (!blk) return;
            if (blk === target) {
              blk.destroyed = true;
              if (blk.el) blk.el.style.visibility = 'hidden';
            } else if (!blk.destroyed) {
              anyRemaining = true;
            }
          });
          if (!anyRemaining) {
            obstacle.el?.remove();
            return true;
          }
          return false;
        }

        function saveHighScore() {
          if (!window.api?.saveData || !window.api?.updateData) return;
          const payload = { key: 'space_invaders_high_scores', state: { highScore: state.highScore } };
          if (state._id) {
            window.api.updateData(state._id, payload).catch(err => console.warn('High score update failed', err));
          } else {
            window.api.saveData(payload).then(saved => { state._id = saved?._id || null; }).catch(err => console.warn('High score save failed', err));
          }
        }

        async function loadHighScore() {
          if (!window.api?.listData) return;
          try {
            const items = await window.api.listData({ key: 'space_invaders_high_scores' });
            const first = Array.isArray(items) ? items[0] : null;
            if (first?.data?.state?.highScore) {
              state.highScore = Number(first.data.state.highScore) || 0;
              state._id = first._id || null;
            }
          } catch (err) {
            console.warn('High score load failed', err);
          }
          renderHud();
        }

        function spawnEnemyFormation() {
          if (!field) return;
          state.enemies.forEach(e => e?.remove());
          state.enemies = [];
          const fieldWidth = field.clientWidth || 0;
          const enemyWidth = 30;
          const enemyHeight = 20;
          const cols = 7;
          const rows = 2;
          const gapX = 18;
          const gapY = 20;
          const totalWidth = cols * enemyWidth + (cols - 1) * gapX;
          const startX = Math.max(8, (fieldWidth - totalWidth) / 2);
          const startY = 10;

          for (let r = 0; r < rows; r += 1) {
            for (let c = 0; c < cols; c += 1) {
              const enemy = document.createElement('div');
              enemy.className = 'enemy';
              enemy.style.left = startX + c * (enemyWidth + gapX) + 'px';
              enemy.style.top = startY + r * (enemyHeight + gapY) + 'px';
              enemy.style.filter = 'hue-rotate(' + Math.floor(Math.random() * 360) + 'deg)';
              field.appendChild(enemy);
              state.enemies.push(enemy);
            }
          }
          state.enemyDir = 1;
          state.enemyStepCounter = 0;
        }

        function moveFormationStep() {
          if (!field || state.enemies.length === 0) return;
          let minLeft = Infinity;
          let maxRight = -Infinity;
          state.enemies.forEach((e) => {
            if (!e?.isConnected) return;
            const left = e.offsetLeft;
            const right = left + e.offsetWidth;
            minLeft = Math.min(minLeft, left);
            maxRight = Math.max(maxRight, right);
          });

          const fieldWidth = field.clientWidth || 0;
          const step = ENEMY_STEP_PX * state.enemyDir;
          const shouldDrop = (state.enemyDir === 1 && maxRight + ENEMY_STEP_PX >= fieldWidth) || (state.enemyDir === -1 && minLeft - ENEMY_STEP_PX <= 0);

          if (shouldDrop) {
            state.enemies.forEach((e) => {
              if (!e?.isConnected) return;
              const nextTop = e.offsetTop + ENEMY_DROP_PX;
              e.style.top = nextTop + 'px';
            });
            state.enemyDir *= -1;
          } else {
            state.enemies.forEach((e) => {
              if (!e?.isConnected) return;
              e.style.left = (e.offsetLeft + step) + 'px';
            });
          }

          let maxBottomAfter = -Infinity;
          state.enemies.forEach((e) => {
            if (!e?.isConnected) return;
            maxBottomAfter = Math.max(maxBottomAfter, e.offsetTop + e.offsetHeight);
          });

          const lossLine = field.clientHeight - 40;
          if (maxBottomAfter >= lossLine) {
            gameOver('Invaders landed');
          }
        }

        function spawnObstacles() {
          if (!obstaclesLayer) return;
          obstaclesLayer.innerHTML = '';
          state.obstacles = [];
          const slots = [15, 42.5, 70];
          slots.forEach((left) => {
            const el = document.createElement('div');
            el.className = 'obstacle';
            el.style.left = left + '%';
            const blocks = [];
            for (let row = 0; row < 3; row += 1) {
              for (let col = 0; col < 3; col += 1) {
                const block = document.createElement('div');
                block.className = 'obstacle-block';
                block.dataset.col = col.toString();
                block.dataset.row = row.toString();
                el.appendChild(block);
                blocks.push({ el: block, col, row });
              }
            }
            obstaclesLayer.appendChild(el);
            state.obstacles.push({ el, blocks });
          });
        }

        function shoot() {
          if (!state.running || !player || !field) return;
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          if (now - state.lastShotAt < SHOT_COOLDOWN_MS) return;
          if (state.bullets.length >= MAX_BULLETS) return;
          state.lastShotAt = now;
          const bullet = document.createElement('div');
          bullet.className = 'bullet';
          bullet.style.left = player.offsetLeft + player.offsetWidth / 2 - 2 + 'px';
          bullet.style.top = (player.offsetTop - 10) + 'px';
          field.appendChild(bullet);
          state.bullets.push(bullet);
        }

        function enemyShoot(fromEnemy) {
          if (!field || !fromEnemy) return;
          const bullet = document.createElement('div');
          bullet.className = 'enemy-bullet';
          bullet.style.left = fromEnemy.offsetLeft + fromEnemy.offsetWidth / 2 - 2 + 'px';
          bullet.style.top = (fromEnemy.offsetTop + fromEnemy.offsetHeight) + 'px';
          field.appendChild(bullet);
          state.enemyBullets.push(bullet);
        }

        function resetGame() {
          stopLoop('reset');
          state.score = 0;
          state.lives = 3;
          state.running = true;
          state.enemyDir = 1;
          state.enemyStepCounter = 0;
          state.bullets.forEach(b => b?.remove());
          state.enemyBullets.forEach(b => b?.remove());
          state.enemies.forEach(e => e?.remove());
          state.obstacles = [];
          state.bullets = [];
          state.enemyBullets = [];
          state.enemies = [];
          if (player) player.style.left = '45%';
          if (gameOverEl) gameOverEl.classList.remove('visible');
          renderHud();
          spawnObstacles();
          spawnEnemyFormation();
          scheduleNext();
        }

        function gameOver(reason) {
          state.running = false;
          flashField();
          if (state.score > state.highScore) {
            state.highScore = state.score;
            saveHighScore();
            renderHud();
          }
          if (gameOverEl) {
            gameOverEl.textContent = 'Game Over — Score ' + state.score + (reason ? ' (' + reason + ')' : '');
            gameOverEl.classList.add('visible');
          }
          stopLoop('game over');
        }

        function tick() {
          if (!hasDom()) {
            stopLoop('playfield missing');
            return;
          }
          if (!state.running) {
            scheduleNext();
            return;
          }

          try {
            const playerX = clamp((player?.offsetLeft || 0) + moveDir * PLAYER_SPEED, 0, Math.max(0, (field?.clientWidth || 0) - (player?.offsetWidth || 0)));
            if (player) player.style.left = playerX + 'px';

            for (let i = state.bullets.length - 1; i >= 0; i--) {
              const b = state.bullets[i];
              if (!b || !b.isConnected) {
                state.bullets.splice(i, 1);
                continue;
              }
              const nextTop = b.offsetTop - BULLET_SPEED;
              b.style.top = nextTop + 'px';
              if (nextTop < -12) {
                b.remove();
                state.bullets.splice(i, 1);
              }
            }

            for (let i = state.enemies.length - 1; i >= 0; i--) {
              const e = state.enemies[i];
              if (!e || !e.isConnected) {
                state.enemies.splice(i, 1);
                continue;
              }
              // rare enemy shots
              if (Math.random() < 0.0007) {
                enemyShoot(e);
              }
            }

            state.enemyStepCounter += 1;
            if (state.enemyStepCounter >= ENEMY_STEP_INTERVAL) {
              state.enemyStepCounter = 0;
              moveFormationStep();
            }

            const hitObstacle = (rect, removeColumn) => {
              if (!rect) return false;
              const bulletCx = (rect.left + rect.right) / 2;
              const bulletCy = (rect.top + rect.bottom) / 2;
              for (let oi = state.obstacles.length - 1; oi >= 0; oi--) {
                const obs = state.obstacles[oi];
                if (!obs?.el || !obs.el.isConnected) { state.obstacles.splice(oi, 1); continue; }
                if (!Array.isArray(obs.blocks)) { obs.blocks = []; }
                const activeBlocks = obs.blocks.filter(b => b && !b.destroyed);
                if (activeBlocks.length === 0) { obs.el.remove(); state.obstacles.splice(oi, 1); continue; }

                const obsRect = obs.el.getBoundingClientRect();
                // Each obstacle is 78px wide x 48px tall, 3x3 grid with 2px gaps
                // Cell size: (78 - 2*2) / 3 = 24.67px wide, (48 - 2*2) / 3 = 14.67px tall
                const cellW = (obsRect.width - 4) / 3;
                const cellH = (obsRect.height - 4) / 3;
                const gapPx = 2;

                let best = null;
                let bestOverlap = 0;

                for (let bi = 0; bi < obs.blocks.length; bi++) {
                  const blk = obs.blocks[bi];
                  if (!blk?.el || !blk.el.isConnected || blk.destroyed) continue;
                  // Calculate block position from row/col
                  const blkLeft = obsRect.left + blk.col * (cellW + gapPx);
                  const blkTop = obsRect.top + blk.row * (cellH + gapPx);
                  const blkRight = blkLeft + cellW;
                  const blkBottom = blkTop + cellH;

                  const overlapX = Math.max(0, Math.min(rect.right, blkRight) - Math.max(rect.left, blkLeft));
                  const overlapY = Math.max(0, Math.min(rect.bottom, blkBottom) - Math.max(rect.top, blkTop));
                  const area = overlapX * overlapY;
                  if (area > bestOverlap) {
                    bestOverlap = area;
                    best = blk;
                  }
                }

                if (best) {
                  const removedAll = removeColumn ? removeObstacleColumn(obs, best.col) : removeObstacleBlock(obs, best);
                  if (removedAll) { state.obstacles.splice(oi, 1); }
                  return true;
                }
              }
              return false;
            };

            // Enemy bullets
            for (let bi = state.enemyBullets.length - 1; bi >= 0; bi--) {
              const b = state.enemyBullets[bi];
              if (!b || !b.isConnected) { state.enemyBullets.splice(bi, 1); continue; }
              const nextTop = b.offsetTop + BULLET_SPEED * 0.85;
              b.style.top = nextTop + 'px';
              if (nextTop > field.clientHeight + 20) {
                b.remove();
                state.enemyBullets.splice(bi, 1);
                continue;
              }
              const bb = b.getBoundingClientRect();
              if (hitObstacle(bb, false)) {
                b.remove();
                state.enemyBullets.splice(bi, 1);
                continue;
              }
              const pb = player?.getBoundingClientRect();
              if (pb && !(bb.right < pb.left || bb.left > pb.right || bb.bottom < pb.top || bb.top > pb.bottom)) {
                b.remove();
                state.enemyBullets.splice(bi, 1);
                state.lives -= 1;
                flashField();
                renderHud();
                if (state.lives <= 0) {
                  gameOver('Hit by fire');
                  break;
                }
                // Brief invulnerability and respawn to center
                if (player && field) {
                  player.style.left = (field.offsetWidth / 2 - player.offsetWidth / 2) + 'px';
                }
                continue;
              }
            }

            for (let ei = state.enemies.length - 1; ei >= 0; ei--) {
              const e = state.enemies[ei];
              if (!e || !e.isConnected) {
                state.enemies.splice(ei, 1);
                continue;
              }
              const eb = e.getBoundingClientRect();
              if (hitObstacle(eb, false)) {
                e.remove();
                state.enemies.splice(ei, 1);
                continue;
              }
              for (let bi = state.bullets.length - 1; bi >= 0; bi--) {
                const b = state.bullets[bi];
                if (!b || !b.isConnected) {
                  state.bullets.splice(bi, 1);
                  continue;
                }
                const bb = b.getBoundingClientRect();
                if (!(bb.right < eb.left || bb.left > eb.right || bb.bottom < eb.top || bb.top > eb.bottom)) {
                  e.remove();
                  b.remove();
                  state.enemies.splice(ei, 1);
                  state.bullets.splice(bi, 1);
                  state.score += 10;
                  if (state.score > state.highScore) {
                    state.highScore = state.score;
                    saveHighScore();
                  }
                  renderHud();
                  break;
                }
              }
            }

            // Bullets vs obstacles (carve a column / single block depending on flag)
            for (let bi = state.bullets.length - 1; bi >= 0; bi--) {
              const b = state.bullets[bi];
              if (!b || !b.isConnected) { state.bullets.splice(bi, 1); continue; }
              const bb = b.getBoundingClientRect();
              if (hitObstacle(bb, false)) {
                b.remove();
                state.bullets.splice(bi, 1);
              }
            }
            if (state.enemies.length === 0 && state.running) {
              spawnEnemyFormation();
            }
          } catch (err) {
            console.error('[Space Invaders Lite] loop error', err);
            stopLoop('runtime error');
            return;
          }

          if (state.running) {
            scheduleNext();
          }
        }

        document.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowLeft') { moveDir = -1; e.preventDefault(); }
          if (e.key === 'ArrowRight') { moveDir = 1; e.preventDefault(); }
          if (e.key === ' ') { shoot(); e.preventDefault(); }
        });

        document.addEventListener('keyup', (e) => {
          if (e.key === 'ArrowLeft' && moveDir === -1) moveDir = 0;
          if (e.key === 'ArrowRight' && moveDir === 1) moveDir = 0;
        });

        const restartBtn = document.getElementById('restart');
        if (restartBtn) restartBtn.addEventListener('click', () => resetGame());

        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            state.running = false;
          } else if (!state.running && hasDom()) {
            state.running = true;
            scheduleNext();
          }
        });

        window.addEventListener('beforeunload', () => {
          destroyed = true;
          stopLoop('unload');
        });

        window.onerror = (msg, src, line, col, err) => {
          console.error('[Space Invaders Lite] window error', { msg, src, line, col, err });
          stopLoop('window error');
          return true; // prevent default logging cascade
        };

        loadHighScore().finally(() => {
          renderHud();
          spawnObstacles();
          spawnEnemyFormation();
          scheduleNext();
        });
      })();
    </script>`.trim()
}