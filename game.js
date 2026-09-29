// ==============================
// Stage 1: 四角い部屋 + Luna + 自分のアバター + リンゴ1個
//
// 方針:
// - Lunaは最初は待機している（いきなりリンゴに突進しない）
// - 話しかけると、少しずつ・ゆっくりリンゴに向かって歩き出す
//   （会話しながら移動する = 目的地に着くまで何度もやり取りできる）
// - プレイヤーは矢印キー/WASDで自分のアバターを動かせる
// ==============================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

// server.py のエンドポイント
const CHAT_API_URL = "http://localhost:5000/chat";

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
    speed: 0.35, // ゆっくり移動。会話しながら向かうイメージ
    color: "#7fd3ff",
    speechText: "",
    speechTimer: null,
  };

  const player = {
    x: room.x + room.width - 40,
    y: room.y + room.height - 40,
    radius: 16,
    speed: 2.5,
    color: "#8affa0",
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
    player,
    apple,
    // waiting: 話しかけられるまで待機 / moving: リンゴへゆっくり移動中 / cleared: 取得済み
    status: "waiting",
  };
}

let state = createGameState();

// ---------- キーボード入力（プレイヤー操作） ----------
const keysPressed = new Set();

window.addEventListener("keydown", (e) => {
  keysPressed.add(e.key.toLowerCase());
});
window.addEventListener("keyup", (e) => {
  keysPressed.delete(e.key.toLowerCase());
});

function movePlayerFromInput(player, speed) {
  let dx = 0;
  let dy = 0;

  if (keysPressed.has("arrowup") || keysPressed.has("w")) dy -= 1;
  if (keysPressed.has("arrowdown") || keysPressed.has("s")) dy += 1;
  if (keysPressed.has("arrowleft") || keysPressed.has("a")) dx -= 1;
  if (keysPressed.has("arrowright") || keysPressed.has("d")) dx += 1;

  if (dx === 0 && dy === 0) return;

  const len = Math.sqrt(dx * dx + dy * dy);
  player.x += (dx / len) * speed;
  player.y += (dy / len) * speed;
}

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

// ---------- AI: リンゴに向かってゆっくり移動する ----------
function moveLunaTowardApple(luna, apple, speed) {
  const dx = apple.x - luna.x;
  const dy = apple.y - luna.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.5) return;

  const vx = (dx / dist) * speed;
  const vy = (dy / dist) * speed;

  luna.x += vx;
  luna.y += vy;
}

// ---------- 更新処理 ----------
function update() {
  movePlayerFromInput(state.player, state.player.speed);
  clampToRoom(state.player, state.room);

  if (state.status === "moving" && !state.apple.collected) {
    moveLunaTowardApple(state.luna, state.apple, state.luna.speed);
    clampToRoom(state.luna, state.room);

    if (isColliding(state.luna, state.apple)) {
      state.apple.collected = true;
      state.status = "cleared";
      showLunaSpeech("やった、リンゴ見つけた！");
    }
  }
}

// ---------- 描画処理 ----------
function drawRoom(room) {
  ctx.fillStyle = "#3a3a4d";
  ctx.fillRect(room.x, room.y, room.width, room.height);

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

  ctx.strokeStyle = "#5a3a1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(apple.x, apple.y - apple.radius);
  ctx.lineTo(apple.x + 3, apple.y - apple.radius - 6);
  ctx.stroke();
}

function drawCharacter(character, eyeColor = "#222") {
  ctx.beginPath();
  ctx.arc(character.x, character.y, character.radius, 0, Math.PI * 2);
  ctx.fillStyle = character.color;
  ctx.fill();

  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(character.x - 5, character.y - 3, 2, 0, Math.PI * 2);
  ctx.arc(character.x + 5, character.y - 3, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawLabel(character, text) {
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#ccc";
  ctx.textAlign = "center";
  ctx.fillText(text, character.x, character.y + character.radius + 14);
  ctx.textAlign = "left";
}

function drawSpeechBubble(luna) {
  const text = luna.speechText;
  if (!text) return;

  ctx.font = "13px sans-serif";
  const paddingX = 10;
  const paddingY = 6;
  const textWidth = ctx.measureText(text).width;
  const bubbleWidth = textWidth + paddingX * 2;
  const bubbleHeight = 26;

  const bx = Math.min(
    Math.max(luna.x - bubbleWidth / 2, state.room.x),
    state.room.x + state.room.width - bubbleWidth
  );
  const by = luna.y - luna.radius - bubbleHeight - 10;

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(bx, by, bubbleWidth, bubbleHeight, 6);
  } else {
    ctx.rect(bx, by, bubbleWidth, bubbleHeight);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#222";
  ctx.fillText(text, bx + paddingX, by + bubbleHeight / 2 + 4);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRoom(state.room);
  drawApple(state.apple);
  drawCharacter(state.player, "#123");
  drawLabel(state.player, "You");
  drawCharacter(state.luna);
  drawLabel(state.luna, "Luna");
  drawSpeechBubble(state.luna);
}

// ---------- ステータス表示 ----------
function updateStatusText() {
  if (state.status === "cleared") {
    statusEl.textContent = "クリア！Lunaはリンゴを見つけました 🍎";
  } else if (state.status === "moving") {
    statusEl.textContent = "Lunaはリンゴに向かって少しずつ歩いています...";
  } else {
    statusEl.textContent = "Lunaはまだ待機中。下の欄から話しかけてみましょう。";
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

// ---------- Lunaの吹き出し ----------
function showLunaSpeech(text, durationMs = 6000) {
  state.luna.speechText = text;
  if (state.luna.speechTimer) clearTimeout(state.luna.speechTimer);
  state.luna.speechTimer = setTimeout(() => {
    state.luna.speechText = "";
  }, durationMs);
}

// ---------- server.py (LunaChat API) との連携 ----------
// 「リンゴを取りに行くべきか」はキーワード判定ではなく、
// Lunaが発言した後にモデル自身が判定した結果 (data.fetch_apple) を使う。
async function sendChatMessage(message) {
  if (!message) return;

  appendChatLine("You", message);

  try {
    const response = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errText = data.error || "サーバーとの通信に失敗しました。";
      appendChatLine("System", errText);
      return;
    }

    showLunaSpeech(data.reply);
    appendChatLine("Luna", data.reply);

    // Lunaがしゃべった後、モデルが「これは指示だった」と判定したら動き出す
    if (state.status === "waiting" && data.fetch_apple) {
      state.status = "moving";
      appendChatLine("System", "（Lunaがリンゴに向かって歩き出しました）");
    }
  } catch (err) {
    appendChatLine("System", "server.py に接続できません。起動していますか？ (python server.py)");
    console.error(err);
  }
}

function appendChatLine(speaker, text) {
  const log = document.getElementById("chatLog");
  if (!log) return;
  const line = document.createElement("div");
  line.className = "chat-line";
  line.innerHTML = `<span class="chat-speaker">${speaker}:</span> ${escapeHtml(text)}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ---------- チャット欄の配線 ----------
// <form>のsubmitを使うとEnterキー等でページ遷移(=ゲームがリセット)されることがあるため、
// formを使わずボタンクリック/Enterキー押下を直接ハンドリングする。
(function setupChatUI() {
  const input = document.getElementById("chatInput");
  const button = document.getElementById("chatSendBtn");

  function trigger() {
    const message = input.value.trim();
    if (!message) return;
    sendChatMessage(message);
    input.value = "";
  }

  if (button) {
    button.addEventListener("click", trigger);
  }

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        trigger();
      }
    });
  }
})();