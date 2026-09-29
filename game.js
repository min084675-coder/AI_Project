// ==============================
// Stage 1: 四角い部屋 + Luna + リンゴ1個
// AIの目的: リンゴを取りに行く
// ==============================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

// ---------- ゲーム状態生成 ----------
function createGameState() {
  const wallThickness = 20;

  const room = {
    x: wallThickness,
    y: wallThickness,
    width: canvas.width - wallThickness * 2,
    height: canvas.height - wallThickness * 2,
  };

  const luna = {
    x: room.x + 40,
    y: room.y + 40,
    radius: 16,
    speed: 2.2,
    color: "#7fd3ff",
  };

  // 部屋の中のランダムな位置にリンゴを置く（壁にめり込まないように余白を取る）
  const margin = 40;
  const apple = {
    x: room.x + margin + Math.random() * (room.width - margin * 2),
    y: room.y + margin + Math.random() * (room.height - margin * 2),
    radius: 10,
    color: "#ff4d4d",
    collected: false,
  };

  return {
    room,
    luna,
    apple,
    status: "playing", // "playing" | "cleared"
  };
}

let state = createGameState();

// ---------- 衝突判定 ----------
function isColliding(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < a.radius + b.radius;
}

// 部屋の壁からはみ出さないように座標を補正
function clampToRoom(entity, room) {
  entity.x = Math.max(room.x + entity.radius, Math.min(room.x + room.width - entity.radius, entity.x));
  entity.y = Math.max(room.y + entity.radius, Math.min(room.y + room.height - entity.radius, entity.y));
}

// ---------- AI: リンゴに向かって移動する ----------
function moveLunaTowardApple(luna, apple, speed) {
  const dx = apple.x - luna.x;
  const dy = apple.y - luna.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.5) return; // ほぼ到達しているので動かさない

  const vx = (dx / dist) * speed;
  const vy = (dy / dist) * speed;

  luna.x += vx;
  luna.y += vy;
}

// ---------- 更新処理 ----------
function update() {
  if (state.status !== "playing") return;

  if (!state.apple.collected) {
    moveLunaTowardApple(state.luna, state.apple, state.luna.speed);
    clampToRoom(state.luna, state.room);

    if (isColliding(state.luna, state.apple)) {
      state.apple.collected = true;
      state.status = "cleared";
    }
  }
}

// ---------- 描画処理 ----------
function drawRoom(room) {
  // 床
  ctx.fillStyle = "#3a3a4d";
  ctx.fillRect(room.x, room.y, room.width, room.height);

  // 壁（枠線として表現）
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 6;
  ctx.strokeRect(room.x, room.y, room.width, room.height);
}

function drawApple(apple) {
  if (apple.collected) return;
  ctx.beginPath();
  ctx.arc(apple.x, apple.y, apple.radius, 0, Math.PI * 2);
  ctx.fillStyle = apple.color;
  ctx.fill();

  // ヘタ
  ctx.strokeStyle = "#5a3a1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(apple.x, apple.y - apple.radius);
  ctx.lineTo(apple.x + 3, apple.y - apple.radius - 6);
  ctx.stroke();
}

function drawLuna(luna) {
  ctx.beginPath();
  ctx.arc(luna.x, luna.y, luna.radius, 0, Math.PI * 2);
  ctx.fillStyle = luna.color;
  ctx.fill();

  // 目（向きの雰囲気だけ出す簡易表現）
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(luna.x - 5, luna.y - 3, 2, 0, Math.PI * 2);
  ctx.arc(luna.x + 5, luna.y - 3, 2, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRoom(state.room);
  drawApple(state.apple);
  drawLuna(state.luna);
}

// ---------- ステータス表示 ----------
function updateStatusText() {
  if (state.status === "cleared") {
    statusEl.textContent = "クリア！Lunaはリンゴを見つけました ?";
  } else {
    statusEl.textContent = "Lunaはリンゴに向かっています...";
  }
}

// ---------- メインループ ----------
function loop() {
  update();
  draw();
  updateStatusText();
  requestAnimationFrame(loop);
}

loop();