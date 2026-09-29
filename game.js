// ==============================
// Stage 1: 広い部屋 + 自動生成される壁 + 複数の物体 + ステータスシステム
//
// 🍎リンゴ = HP回復 / 💧水 = MP回復 / 🎁宝箱 = アイテム入手 / 👾敵 = 簡易オートバトル(仮)
// 効果は「Lunaが指示で向かった時」「プレイヤーが直接触れた時」どちらでも発動する。
// ==============================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");

const CHAT_API_URL = "http://localhost:5000/chat";
const PROACTIVE_API_URL = "http://localhost:5000/proactive";
const CELL_SIZE = 20;

const OBJECT_TYPES = {
  apple: { label: "リンゴ", emoji: "🍎", radius: 12 },
  water: { label: "水", emoji: "💧", radius: 12 },
  treasure: { label: "宝箱", emoji: "🎁", radius: 14 },
  enemy: { label: "敵", emoji: "👾", radius: 14 },
};

// 各タイプをいくつ配置するか
const OBJECT_COUNTS = { apple: 2, water: 2, treasure: 2, enemy: 2 };

const ITEM_POOL = ["ポーション", "エーテル", "古い鍵", "謎の宝石", "防具の欠片"];
const AUTONOMY_API_URL = "http://localhost:5000/autonomy";
let visibilityEnabled = true;
const RELATIONSHIP_STORAGE_KEY = "lunaRelationship";
const GAME_DATA_STORAGE_KEY = "lunaGameData";
const AREA_CONFIG = [
  { name: "月影の広間", color: "#3a3a4d" },
  { name: "青い遺跡", color: "#263f52" },
  { name: "星降る庭", color: "#403452" },
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function loadRelationship() {
  try {
    const saved = JSON.parse(localStorage.getItem(RELATIONSHIP_STORAGE_KEY) || "null");
    return {
      affinity: Number.isFinite(saved?.affinity) ? Math.max(0, Math.min(100, saved.affinity)) : 0,
      memories: Array.isArray(saved?.memories) ? saved.memories.slice(-12) : [],
    };
  } catch (error) {
    return { affinity: 0, memories: [] };
  }
}

function saveRelationship() {
  localStorage.setItem(RELATIONSHIP_STORAGE_KEY, JSON.stringify(state.relationship));
}

function changeAffinity(amount) {
  state.relationship.affinity = Math.max(0, Math.min(100, state.relationship.affinity + amount));
  saveRelationship();
}

function remember(event) {
  state.relationship.memories.push(event);
  state.relationship.memories = state.relationship.memories.slice(-12);
  saveRelationship();
}

// ---------- グリッドユーティリティ ----------
function buildGrid(room) {
  return { cellSize: CELL_SIZE, cols: Math.floor(room.width / CELL_SIZE), rows: Math.floor(room.height / CELL_SIZE) };
}
function cellToPixel(room, grid, col, row) {
  return { x: room.x + col * grid.cellSize + grid.cellSize / 2, y: room.y + row * grid.cellSize + grid.cellSize / 2 };
}
function pixelToCell(room, grid, p) {
  return {
    c: Math.max(0, Math.min(grid.cols - 1, Math.floor((p.x - room.x) / grid.cellSize))),
    r: Math.max(0, Math.min(grid.rows - 1, Math.floor((p.y - room.y) / grid.cellSize))),
  };
}
function circleRectOverlap(cx, cy, radius, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}
function isCellBlocked(room, grid, walls, col, row, margin) {
  const p = cellToPixel(room, grid, col, row);
  return walls.some((wall) => circleRectOverlap(p.x, p.y, margin, wall));
}
function computeReachableCells(room, grid, walls, startCell, margin) {
  const key = (c, r) => `${c},${r}`;
  const visited = new Set([key(startCell.c, startCell.r)]);
  const queue = [startCell];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length > 0) {
    const { c, r } = queue.shift();
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
      if (isCellBlocked(room, grid, walls, nc, nr, margin)) continue;
      const k = key(nc, nr);
      if (visited.has(k)) continue;
      visited.add(k);
      queue.push({ c: nc, r: nr });
    }
  }
  return visited;
}

// ---------- 壁の自動生成 ----------
function randomWallRect(room, grid) {
  const horizontal = Math.random() < 0.5;
  const lengthCells = 4 + Math.floor(Math.random() * Math.max(6, Math.floor(grid.cols * 0.2)));
  const thickness = CELL_SIZE;
  if (horizontal) {
    const col = Math.floor(Math.random() * Math.max(1, grid.cols - lengthCells));
    const row = Math.floor(Math.random() * grid.rows);
    return { x: room.x + col * CELL_SIZE, y: room.y + row * CELL_SIZE, width: lengthCells * CELL_SIZE, height: thickness, color: "#5b5b73" };
  } else {
    const col = Math.floor(Math.random() * grid.cols);
    const row = Math.floor(Math.random() * Math.max(1, grid.rows - lengthCells));
    return { x: room.x + col * CELL_SIZE, y: room.y + row * CELL_SIZE, width: thickness, height: lengthCells * CELL_SIZE, color: "#5b5b73" };
  }
}

function getSpawnPoints(room) {
  return {
    lunaStart: { x: room.x + 40, y: room.y + 40 },
    playerStart: { x: room.x + room.width - 40, y: room.y + room.height - 40 },
  };
}

function generateWalls(room) {
  const grid = buildGrid(room);
  const { lunaStart, playerStart } = getSpawnPoints(room);
  const lunaCell = pixelToCell(room, grid, lunaStart);
  const playerCell = pixelToCell(room, grid, playerStart);
  const spawnMargin = 22;
  const maxAttempts = 40;
  const wallCount = 10 + Math.floor(Math.random() * 6);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const walls = [];
    for (let i = 0; i < wallCount; i++) {
      const wall = randomWallRect(room, grid);
      if (circleRectOverlap(lunaStart.x, lunaStart.y, spawnMargin, wall) || circleRectOverlap(playerStart.x, playerStart.y, spawnMargin, wall)) continue;
      walls.push(wall);
    }
    const reachable = computeReachableCells(room, grid, walls, lunaCell, 16);
    const totalCells = grid.cols * grid.rows;
    const reachablePlayer = reachable.has(`${playerCell.c},${playerCell.r}`);
    if (reachablePlayer && reachable.size / totalCells > 0.5) {
      return { walls, grid, reachableFromLuna: reachable };
    }
  }
  const reachable = computeReachableCells(room, grid, [], lunaCell, 16);
  return { walls: [], grid, reachableFromLuna: reachable };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickDistinctSpots(room, grid, reachableFromLuna, lunaStart, playerStart, count) {
  const candidates = shuffle(
    [...reachableFromLuna].map((k) => {
      const [c, r] = k.split(",").map(Number);
      return cellToPixel(room, grid, c, r);
    })
  ).filter((p) => Math.hypot(p.x - lunaStart.x, p.y - lunaStart.y) > 80 && Math.hypot(p.x - playerStart.x, p.y - playerStart.y) > 40);

  const chosen = [];
  const minSeparation = 55;
  for (const p of candidates) {
    if (chosen.every((c) => Math.hypot(c.x - p.x, c.y - p.y) > minSeparation)) {
      chosen.push(p);
      if (chosen.length === count) break;
    }
  }
  let i = 0;
  while (chosen.length < count && candidates.length > 0) {
    chosen.push(candidates[i % candidates.length]);
    i++;
  }
  return chosen;
}

// ---------- キャラクターの初期ステータス ----------
function createCharacterStats() {
  return { hp: 100, hpMax: 100, mp: 50, mpMax: 50, inventory: [], level: 1, xp: 0, xpNext: 100 };
}

function gainExperience(character, characterLabel, amount) {
  character.xp += amount;
  while (character.xp >= character.xpNext) {
    character.xp -= character.xpNext;
    character.level += 1;
    character.xpNext = Math.floor(character.xpNext * 1.25);
    character.hpMax += 10;
    character.mpMax += 5;
    character.hp = character.hpMax;
    character.mp = character.mpMax;
    appendChatLine("System", `⬆️ ${characterLabel}がレベル${character.level}になった！ HP/MPが全回復した。`);
  }
}

// ---------- ゲーム状態生成 ----------
function createGameState(relationship = loadRelationship(), areaIndex = 0, entrySide = null, carriedCharacters = null) {
  const wallThickness = 20;
  const room = { x: wallThickness, y: wallThickness, width: canvas.width - wallThickness * 2, height: canvas.height - wallThickness * 2 };
  const { lunaStart, playerStart } = getSpawnPoints(room);
  const { walls, grid, reachableFromLuna } = generateWalls(room);
  const objectList = [];
  Object.entries(OBJECT_COUNTS).forEach(([type, count]) => {
    for (let i = 0; i < count; i++) objectList.push(type);
  });
  const spots = pickDistinctSpots(room, grid, reachableFromLuna, lunaStart, playerStart, objectList.length);
  const objects = objectList.map((type, i) => ({
    id: `${type}_${i}`,
    type,
    label: OBJECT_TYPES[type].label,
    emoji: OBJECT_TYPES[type].emoji,
    radius: OBJECT_TYPES[type].radius,
    x: spots[i] ? spots[i].x : room.x + room.width / 2,
    y: spots[i] ? spots[i].y : room.y + room.height / 2,
    found: false,
    reward: type === "treasure" && i === 4 ? "謎の宝石" : type === "treasure" && i === 5 ? "古い鍵" : undefined,
    hp: type === "enemy" ? randomInt(25, 45) : undefined,
    wanderTarget: null,
    wanderTimer: randomInt(30, 150),
  }));

  const luna = {
    x: lunaStart.x, y: lunaStart.y, radius: 16, speed: 1.8, color: "#7fd3ff",
    speechText: "", speechTimer: null,
    path: null, pathIndex: 0, currentGoalType: null, targetObject: null,
    ...createCharacterStats(),
  };

  const player = {
    x: playerStart.x, y: playerStart.y, radius: 16, speed: 3, color: "#8affa0",
    ...createCharacterStats(),
  };

  if (entrySide === "left") {
    player.x = room.x + 80;
    player.y = room.y + room.height / 2;
  } else if (entrySide === "right") {
    player.x = room.x + room.width - 80;
    player.y = room.y + room.height / 2;
  }

  if (carriedCharacters) {
    const lunaPosition = { x: luna.x, y: luna.y };
    const playerPosition = { x: player.x, y: player.y };
    Object.assign(luna, carriedCharacters.luna);
    Object.assign(player, carriedCharacters.player);
    luna.x = lunaPosition.x;
    luna.y = lunaPosition.y;
    player.x = playerPosition.x;
    player.y = playerPosition.y;
    luna.path = null;
    luna.targetObject = null;
    luna.currentGoalType = null;
  }

  const gates = [{ x: room.x + room.width / 2 - 10, y: room.y + room.height / 2 - 60, width: 20, height: 120, open: false }];
  const portalSpots = pickDistinctSpots(room, grid, reachableFromLuna, lunaStart, playerStart, 2);
  const areaPortals = [];
  if (areaIndex > 0) areaPortals.push({ direction: "previous", x: portalSpots[0].x, y: portalSpots[0].y, radius: 24 });
  if (areaIndex < AREA_CONFIG.length - 1) areaPortals.push({ direction: "next", x: portalSpots[1].x, y: portalSpots[1].y, radius: 24 });
  return { room, walls, grid, luna, player, objects, gates, areaPortals, relationship, areaIndex, portalCooldown: 60, status: "waiting", lastActionResult: "新しいエリアを観察中", fieldEffects: [], lastAutonomyAt: 0, autonomyBusy: false, lastLunaTalkAt: 0 };
}

let state = createGameState();

// ---------- キーボード入力（プレイヤー操作） ----------
const keysPressed = new Set();
window.addEventListener("keydown", (e) => keysPressed.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => keysPressed.delete(e.key.toLowerCase()));

function movePlayerFromInput(player, speed) {
  let dx = 0, dy = 0;
  if (keysPressed.has("arrowup") || keysPressed.has("w")) dy -= 1;
  if (keysPressed.has("arrowdown") || keysPressed.has("s")) dy += 1;
  if (keysPressed.has("arrowleft") || keysPressed.has("a")) dx -= 1;
  if (keysPressed.has("arrowright") || keysPressed.has("d")) dx += 1;
  if (dx === 0 && dy === 0) return;
  const len = Math.sqrt(dx * dx + dy * dy);
  player.x += (dx / len) * speed;
  player.y += (dy / len) * speed;
}

function isColliding(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius;
}

function resolveWallCollisions(entity, walls) {
  for (const wall of walls) {
    const closestX = Math.max(wall.x, Math.min(entity.x, wall.x + wall.width));
    const closestY = Math.max(wall.y, Math.min(entity.y, wall.y + wall.height));
    const dx = entity.x - closestX, dy = entity.y - closestY;
    const distSq = dx * dx + dy * dy;
    if (distSq < entity.radius * entity.radius) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const overlap = entity.radius - dist;
      entity.x += (dx / dist) * overlap;
      entity.y += (dy / dist) * overlap;
    }
  }
}

function resolveCharacterCollision(first, second) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const distance = Math.hypot(dx, dy);
  const minimumDistance = first.radius + second.radius;
  if (distance >= minimumDistance) return;
  const safeDistance = distance || 0.001;
  const overlap = minimumDistance - safeDistance;
  first.x += (dx / safeDistance) * overlap;
  first.y += (dy / safeDistance) * overlap;
  clampToRoom(first, state.room);
}

function getBlockingWalls() {
  return state.walls.concat(state.gates.filter((gate) => !gate.open));
}

function checkGateInteractions(character, characterLabel) {
  for (const gate of state.gates) {
    if (gate.open || !circleRectOverlap(character.x, character.y, character.radius + 4, gate)) continue;
    const keyIndex = character.inventory.indexOf("古い鍵");
    if (keyIndex >= 0) {
      character.inventory.splice(keyIndex, 1);
      gate.open = true;
      changeAffinity(character === state.luna ? 2 : 0);
      remember(`${characterLabel}が古い鍵でゲートを開けた`);
      appendChatLine("System", `🔑 ${characterLabel}が古い鍵でゲートを開けた！`);
    } else if (character === state.player) {
      appendChatLine("System", "🔒 ゲートは閉じている。古い鍵が必要です。");
    }
  }
}

function clampToRoom(entity, room) {
  entity.x = Math.max(room.x + entity.radius, Math.min(room.x + room.width - entity.radius, entity.x));
  entity.y = Math.max(room.y + entity.radius, Math.min(room.y + room.height - entity.radius, entity.y));
}

// ---------- 経路探索 ----------
function findPath(start, end) {
  const { room, grid, walls } = state;
  const startCell = pixelToCell(room, grid, start);
  const endCell = pixelToCell(room, grid, end);
  const key = (c, r) => `${c},${r}`;
  const visited = new Set([key(startCell.c, startCell.r)]);
  const cameFrom = new Map();
  const queue = [startCell];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length > 0) {
    const { c, r } = queue.shift();
    if (c === endCell.c && r === endCell.r) break;
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
      if (isCellBlocked(room, grid, getBlockingWalls(), nc, nr, state.luna.radius * 0.9)) continue;
      const k = key(nc, nr);
      if (visited.has(k)) continue;
      visited.add(k);
      cameFrom.set(k, key(c, r));
      queue.push({ c: nc, r: nr });
    }
  }
  const endKey = key(endCell.c, endCell.r);
  if (!visited.has(endKey)) return null;
  const path = [];
  let curKey = endKey;
  const startKey = key(startCell.c, startCell.r);
  while (curKey !== startKey) {
    const [c, r] = curKey.split(",").map(Number);
    path.push(cellToPixel(room, grid, c, r));
    const prev = cameFrom.get(curKey);
    if (!prev) break;
    curKey = prev;
  }
  path.reverse();
  path.push({ x: end.x, y: end.y });
  return path;
}

// 最も近い、まだ見つかっていない対象タイプの物体を選ぶ
function findNearestObject(type, from) {
  const candidates = state.objects.filter((o) => o.type === type && !o.found);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
  return candidates[0];
}

function trySetGoal(targetType) {
  if (!targetType || !OBJECT_TYPES[targetType]) return;
  const obj = findNearestObject(targetType, state.luna);
  if (!obj) {
    appendChatLine("System", `（${OBJECT_TYPES[targetType].label}はもう見当たりません）`);
    return;
  }
  const path = findPath({ x: state.luna.x, y: state.luna.y }, { x: obj.x, y: obj.y });
  if (!path) {
    appendChatLine("System", "（経路が見つかりませんでした…新しいマップを生成してみてください）");
    return;
  }
  state.luna.path = path;
  state.luna.pathIndex = 0;
  state.luna.currentGoalType = targetType;
  state.luna.targetObject = obj;
  state.status = "moving";
  state.lastActionResult = `${obj.label}へ向かい始めた`;
  appendChatLine("System", `（Lunaが${obj.label}${obj.emoji}に向かって歩き出しました）`);
}

function moveLunaAlongPath(luna, speed) {
  if (!luna.path || luna.pathIndex >= luna.path.length) return;
  const target = luna.path[luna.pathIndex];
  const dx = target.x - luna.x, dy = target.y - luna.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 4) { luna.pathIndex++; return; }
  luna.x += (dx / dist) * speed;
  luna.y += (dy / dist) * speed;
}

// ---------- 物体との相互作用（HP回復/MP回復/アイテム/戦闘） ----------
function applyObjectEffect(character, characterLabel, obj) {
  switch (obj.type) {
    case "apple": {
      const healed = Math.min(30, character.hpMax - character.hp);
      character.hp += healed;
      appendChatLine("System", `🍎 ${characterLabel}はリンゴを食べてHPが${healed}回復した！ (HP ${character.hp}/${character.hpMax})`);
      obj.found = true;
      break;
    }
    case "water": {
      const restored = Math.min(25, character.mpMax - character.mp);
      character.mp += restored;
      appendChatLine("System", `💧 ${characterLabel}は水を飲んでMPが${restored}回復した！ (MP ${character.mp}/${character.mpMax})`);
      obj.found = true;
      break;
    }
    case "treasure": {
      const item = obj.reward || ITEM_POOL[randomInt(0, ITEM_POOL.length - 1)];
      character.inventory.push(item);
      appendChatLine("System", `🎁 ${characterLabel}は宝箱を開けた！「${item}」を手に入れた！`);
      obj.found = true;
      break;
    }
    case "enemy": {
      startBattle(character, characterLabel, obj);
      break;
    }
  }

  if (obj.found && state.luna.targetObject === obj) {
    state.luna.targetObject = null;
    state.luna.currentGoalType = null;
    state.status = "waiting";
    if (character === state.luna) showLunaSpeech(`${obj.label}${obj.emoji} 見つけた！`);
    if (character === state.luna) {
      changeAffinity(1);
      remember(`${obj.label}を見つけた`);
    }
  }
  if (obj.found) {
    gainExperience(character, characterLabel, obj.type === "enemy" ? 30 : 8);
    state.lastActionResult = `${characterLabel}が${obj.label}を解決した`;
  }
}

function createFieldEffect(x, y, color = "#b58cff", type = "burst") {
  state.fieldEffects.push({ x, y, color, type, age: 0, duration: type === "rune" ? 90 : 45, lastDamageAt: -30 });
}

function useItem(character, characterLabel, item) {
  const itemIndex = character.inventory.indexOf(item);
  if (itemIndex < 0) {
    appendChatLine("System", `${characterLabel}の持ち物に「${item}」はありません。`);
    return false;
  }

  if (item === "謎の宝石") {
    character.inventory.splice(itemIndex, 1);
    const restored = Math.min(20, character.mpMax - character.mp);
    character.mp += restored;
    const defeated = state.objects.filter((obj) => obj.type === "enemy" && !obj.found && Math.hypot(obj.x - character.x, obj.y - character.y) < 180);
    defeated.forEach((enemy) => {
      enemy.hp = Math.max(0, enemy.hp - 25);
      if (enemy.hp === 0) enemy.found = true;
    });
    createFieldEffect(character.x, character.y, "#b58cff", "rune");
    appendChatLine("Magic", `🔮 ${characterLabel}が謎の宝石を砕き、魔法陣を展開した！ MPが${restored}回復。`);
    if (defeated.length > 0) appendChatLine("Magic", `魔法の波動が近くの敵${defeated.length}体を包み込んだ。`);
    return true;
  }

  appendChatLine("System", `「${item}」はまだ使い道がありません。`);
  return false;
}

function castLunaSpell() {
  castSpell(state.luna, "Luna");
}

function castPlayerSpell() {
  castSpell(state.player, "You");
}

function castPersistentSpell(caster, casterLabel) {
  const spellCost = 20;
  if (caster.mp < spellCost) {
    appendChatLine("Magic", `${casterLabel}のMPが足りない…`);
    return;
  }
  caster.mp -= spellCost;
  state.fieldEffects.push({ x: caster.x, y: caster.y, color: "#ff8ac2", type: "storm", age: 0, duration: 360, radius: 110, lastDamageAt: -30 });
  appendChatLine("Magic", `🌩️ ${casterLabel}が持続魔法をフィールドに残した！`);
}

function updateFieldEffects() {
  for (const effect of state.fieldEffects) {
    if (effect.type !== "storm" || effect.age - effect.lastDamageAt < 30) continue;
    effect.lastDamageAt = effect.age;
    state.objects.forEach((obj) => {
      if (obj.type !== "enemy" || obj.found) return;
      if (Math.hypot(obj.x - effect.x, obj.y - effect.y) <= effect.radius) {
        obj.hp = Math.max(0, obj.hp - 4);
        createFieldEffect(obj.x, obj.y, "#ff8ac2", "burst");
        if (obj.hp === 0) {
          obj.found = true;
          appendChatLine("Magic", "🌩️ 持続魔法が敵を倒した！");
        }
      }
    });
  }
}

function castSpell(caster, casterLabel) {
  const spellCost = 15;
  if (caster.mp < spellCost) {
    appendChatLine("Magic", `${casterLabel}のMPが足りない…`);
    return;
  }
  caster.mp -= spellCost;
  const target = state.objects
    .filter((obj) => obj.type === "enemy" && !obj.found)
    .sort((a, b) => Math.hypot(a.x - caster.x, a.y - caster.y) - Math.hypot(b.x - caster.x, b.y - caster.y))[0];
  createFieldEffect(caster.x, caster.y, "#6bc7ff", "rune");
  if (target) {
    target.hp = Math.max(0, target.hp - 20);
    if (target.hp === 0) {
      target.found = true;
      gainExperience(caster, casterLabel, 35);
    }
    createFieldEffect(target.x, target.y, "#ff8ac2");
    appendChatLine("Magic", `✨ ${casterLabel}が魔法を放ち、${target.label}に20ダメージ！`);
  } else {
    appendChatLine("Magic", `✨ ${casterLabel}が静かな魔法をフィールドに放った。`);
  }
}

// ---------- 簡易オートバトル（仮システム） ----------
function startBattle(attacker, attackerLabel, enemyObj) {
  appendChatLine("Battle", `⚔ ${attackerLabel} が ${enemyObj.label}${enemyObj.emoji} と戦闘開始！`);

  let turn = 0;
  while (enemyObj.hp > 0 && attacker.hp > 0 && turn < 20) {
    turn++;
    const dmgToEnemy = randomInt(8, 16);
    const dmgToAttacker = randomInt(4, 10);
    enemyObj.hp = Math.max(0, enemyObj.hp - dmgToEnemy);
    attacker.hp = Math.max(0, attacker.hp - dmgToAttacker);
    appendChatLine(
      "Battle",
      `ターン${turn}: ${attackerLabel}の攻撃で${dmgToEnemy}ダメージ(敵残りHP ${enemyObj.hp}) / 反撃で${attackerLabel}に${dmgToAttacker}ダメージ(HP ${attacker.hp})`
    );
  }

  if (enemyObj.hp <= 0) {
    appendChatLine("Battle", `🏆 ${attackerLabel}が${enemyObj.label}を倒した！`);
    enemyObj.found = true;
    gainExperience(attacker, attackerLabel, 35);
    state.lastActionResult = `${attackerLabel}が敵を倒した`;
    if (attacker === state.luna) showLunaSpeech("倒した！");
  } else if (attacker.hp <= 0) {
    appendChatLine("Battle", `💀 ${attackerLabel}は力尽きてしまった…（HPを1で持ちこたえた）`);
    attacker.hp = 1;
  } else {
    appendChatLine("Battle", `${attackerLabel}は${enemyObj.label}との戦闘から離脱した。`);
  }
}

function checkObjectInteractions(character, characterLabel) {
  for (const obj of state.objects) {
    if (obj.found) continue;
    if (isColliding(character, obj)) {
      applyObjectEffect(character, characterLabel, obj);
    }
  }
}

function updateEnemies() {
  for (const enemy of state.objects.filter((obj) => obj.type === "enemy" && !obj.found)) {
    const distance = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y);
    const canAttack = isPointVisible(enemy) && distance <= 360;
    if (canAttack && distance > enemy.radius + state.player.radius + 4) {
      enemy.x += ((state.player.x - enemy.x) / distance) * 1.05;
      enemy.y += ((state.player.y - enemy.y) / distance) * 1.05;
      resolveWallCollisions(enemy, getBlockingWalls());
      clampToRoom(enemy, state.room);
    } else if (canAttack) {
      enemy.lastAttackAt = enemy.lastAttackAt || 0;
      if (Date.now() - enemy.lastAttackAt > 1200) {
        enemy.lastAttackAt = Date.now();
        state.player.hp = Math.max(1, state.player.hp - 5);
        appendChatLine("Battle", `👾 敵がYouを襲い、5ダメージ！ (HP ${state.player.hp})`);
      }
    } else {
      enemy.wanderTimer -= 1;
      if (!enemy.wanderTarget || enemy.wanderTimer <= 0 || Math.hypot(enemy.x - enemy.wanderTarget.x, enemy.y - enemy.wanderTarget.y) < 12) {
        enemy.wanderTarget = {
          x: state.room.x + randomInt(40, state.room.width - 40),
          y: state.room.y + randomInt(40, state.room.height - 40),
        };
        enemy.wanderTimer = randomInt(90, 220);
      }
      const wanderDistance = Math.hypot(enemy.wanderTarget.x - enemy.x, enemy.wanderTarget.y - enemy.y) || 1;
      enemy.x += ((enemy.wanderTarget.x - enemy.x) / wanderDistance) * 0.35;
      enemy.y += ((enemy.wanderTarget.y - enemy.y) / wanderDistance) * 0.35;
      resolveWallCollisions(enemy, getBlockingWalls());
      clampToRoom(enemy, state.room);
    }
  }
}

// ---------- 更新処理 ----------
function update() {
  if (state.portalCooldown > 0) state.portalCooldown -= 1;
  movePlayerFromInput(state.player, state.player.speed);
  checkGateInteractions(state.player, "You");
  resolveWallCollisions(state.player, getBlockingWalls());
  clampToRoom(state.player, state.room);
  checkAreaPortalInteractions();
  resolveCharacterCollision(state.player, state.luna);
  checkObjectInteractions(state.player, "You");
  updateEnemies();

  if (state.status === "moving" && state.luna.targetObject) {
    moveLunaAlongPath(state.luna, state.luna.speed);
    checkGateInteractions(state.luna, "Luna");
    resolveWallCollisions(state.luna, getBlockingWalls());
    clampToRoom(state.luna, state.room);
  }
  checkObjectInteractions(state.luna, "Luna");
  updateFieldEffects();
  maybeLunaTalk();
  state.fieldEffects = state.fieldEffects.filter((effect) => {
    effect.age += 1;
    return effect.age < effect.duration;
  });
}

function checkAreaPortalInteractions() {
  if (state.portalCooldown > 0) return;
  const portal = state.areaPortals.find((candidate) => Math.hypot(candidate.x - state.player.x, candidate.y - state.player.y) < candidate.radius + state.player.radius);
  if (!portal) return;
  if (portal.direction === "next") advanceArea("next");
  if (portal.direction === "previous") advanceArea("previous");
}

// ---------- 描画処理 ----------
function drawRoom(room) {
  ctx.fillStyle = AREA_CONFIG[state.areaIndex]?.color || AREA_CONFIG[0].color;
  ctx.fillRect(room.x, room.y, room.width, room.height);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 6;
  ctx.strokeRect(room.x, room.y, room.width, room.height);
}
function drawWalls(walls) {
  for (const wall of walls) {
    ctx.fillStyle = wall.color;
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
    ctx.strokeStyle = "#2c2c3a";
    ctx.lineWidth = 2;
    ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
  }
}
function drawGates(gates) {
  for (const gate of gates) {
    if (gate.open) continue;
    ctx.fillStyle = "#c49a44";
    ctx.fillRect(gate.x, gate.y, gate.width, gate.height);
    ctx.strokeStyle = "#ffe29a";
    ctx.lineWidth = 2;
    ctx.strokeRect(gate.x, gate.y, gate.width, gate.height);
    ctx.font = "18px serif";
    ctx.fillText("🔒", gate.x - 2, gate.y - 8);
  }
}
function drawObjects(objects, visibleOnly = false) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const obj of objects) {
    if (obj.found) continue;
    const dimmed = visibleOnly && visibilityEnabled && !isPointVisible(obj);
    ctx.save();
    ctx.globalAlpha = dimmed ? 0.22 : 1;
    ctx.font = `${obj.radius * 2}px serif`;
    ctx.fillText(obj.emoji, obj.x, obj.y);
    ctx.restore();
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
function drawFieldEffects(effects) {
  for (const effect of effects) {
    const dimmed = visibilityEnabled && !isPointVisible(effect);
    const progress = effect.age / effect.duration;
    const radius = effect.type === "storm" ? effect.radius : effect.type === "rune" ? 24 + progress * 90 : 10 + progress * 35;
    ctx.save();
    ctx.globalAlpha = (1 - progress) * (dimmed ? 0.22 : 1);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = effect.type === "storm" ? 4 : effect.type === "rune" ? 3 : 5;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (effect.type === "storm") {
      ctx.fillStyle = "rgba(255, 138, 194, 0.12)";
      ctx.fill();
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (effect.type === "rune") {
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
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
  const textWidth = ctx.measureText(text).width;
  const bubbleWidth = textWidth + paddingX * 2;
  const bubbleHeight = 26;
  const bx = Math.min(Math.max(luna.x - bubbleWidth / 2, state.room.x), state.room.x + state.room.width - bubbleWidth);
  const by = luna.y - luna.radius - bubbleHeight - 10;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, bubbleWidth, bubbleHeight, 6);
  else ctx.rect(bx, by, bubbleWidth, bubbleHeight);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.fillText(text, bx + paddingX, by + bubbleHeight / 2 + 4);
}

function rayRectDistance(origin, direction, rect) {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (const axis of ["x", "y"]) {
    const start = origin[axis];
    const directionValue = direction[axis];
    const min = rect[axis];
    const max = rect[axis] + (axis === "x" ? rect.width : rect.height);
    if (Math.abs(directionValue) < 0.000001) {
      if (start < min || start > max) return null;
      continue;
    }
    const first = (min - start) / directionValue;
    const second = (max - start) / directionValue;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (far < near) return null;
  }
  if (far < 0) return null;
  return near >= 0 ? near : far;
}

function isPointVisible(point) {
  if (!visibilityEnabled) return true;
  const dx = point.x - state.player.x;
  const dy = point.y - state.player.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return true;
  const direction = { x: dx / distance, y: dy / distance };
  return !getBlockingWalls().some((wall) => {
    const wallDistance = rayRectDistance(state.player, direction, wall);
    return wallDistance !== null && wallDistance < distance - 8;
  });
}

function drawVisibilityMask() {
  if (!visibilityEnabled) return;
  const origin = state.player;
  const bounds = state.room;
  const points = [];
  const rayCount = 360;
  for (let i = 0; i < rayCount; i++) {
    // ポリゴンの継ぎ目が壁の角に重なると、片側だけ長い直線が出るため半ステップずらす。
    const angle = ((i + 0.5) / rayCount) * Math.PI * 2;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    let distance = Number.POSITIVE_INFINITY;
    const roomDistance = rayRectDistance(origin, direction, bounds);
    if (roomDistance !== null) distance = roomDistance;
    for (const wall of state.walls) {
      const wallDistance = rayRectDistance(origin, direction, wall);
      if (wallDistance !== null && wallDistance < distance) distance = wallDistance;
    }
    points.push({ x: origin.x + direction.x * distance, y: origin.y + direction.y * distance });
  }

  ctx.save();
  ctx.fillStyle = "rgba(8, 8, 16, 0.86)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawRoom(state.room);
  drawWalls(state.walls);
  drawGates(state.gates);
  drawVisibilityMask();
  drawGates(state.gates);
  drawFieldEffects(state.fieldEffects);
  drawObjects(state.objects, true);
  ctx.save();
  ctx.globalAlpha = visibilityEnabled && !isPointVisible(state.luna) ? 0.22 : 1;
  drawCharacter(state.luna);
  drawLabel(state.luna, "Luna");
  drawSpeechBubble(state.luna);
  ctx.restore();
  drawCharacter(state.player, "#123");
  drawLabel(state.player, "You");
  drawAreaPortals(state.areaPortals);
}

function drawAreaPortals(portals) {
  for (const portal of portals) {
    const dimmed = visibilityEnabled && !isPointVisible(portal);
    ctx.save();
    ctx.globalAlpha = dimmed ? 0.22 : 1;
    ctx.fillStyle = portal.direction === "next" ? "#6ce0c1" : "#d09aff";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(portal.x, portal.y, portal.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#171722";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(portal.direction === "next" ? "次" : "戻", portal.x, portal.y + 4);
    ctx.restore();
  }
}

// ---------- ステータス表示 ----------
function updateStatusText() {
  const remaining = state.objects.filter((o) => !o.found).length;
  if (state.status === "moving" && state.luna.targetObject) {
    statusEl.textContent = `${AREA_CONFIG[state.areaIndex].name} / Lunaは${state.luna.targetObject.label}に向かっています...`;
  } else if (remaining === 0) {
    statusEl.textContent = `${AREA_CONFIG[state.areaIndex].name} / すべての物体に決着がつきました！`;
  } else {
    statusEl.textContent = `${AREA_CONFIG[state.areaIndex].name} / Lunaは待機中。`;
  }
}

function updateStatsPanel() {
  setBar("lunaHpBar", state.luna.hp, state.luna.hpMax);
  setBar("lunaMpBar", state.luna.mp, state.luna.mpMax);
  setText("lunaHpText", `HP ${state.luna.hp}/${state.luna.hpMax}`);
  setText("lunaMpText", `MP ${state.luna.mp}/${state.luna.mpMax}`);
  setInventory("lunaInventory", state.luna.inventory);

  setBar("playerHpBar", state.player.hp, state.player.hpMax);
  setBar("playerMpBar", state.player.mp, state.player.mpMax);
  setText("playerHpText", `HP ${state.player.hp}/${state.player.hpMax}`);
  setText("playerMpText", `MP ${state.player.mp}/${state.player.mpMax}`);
  setInventory("playerInventory", state.player.inventory);
  setText("lunaAffinityText", `好感度 ${state.relationship.affinity}/100`);
  setText("lunaMemoryText", state.relationship.memories.length > 0 ? `記憶: ${state.relationship.memories.slice(-3).join(" / ")}` : "記憶: まだありません");
  setText("lunaLevelText", `Lv.${state.luna.level} EXP ${state.luna.xp}/${state.luna.xpNext}`);
  setText("playerLevelText", `Lv.${state.player.level} EXP ${state.player.xp}/${state.player.xpNext}`);
}

function setBar(id, value, max) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  el.style.width = `${pct}%`;
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function setInventory(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  const inventoryKey = items.join("\u0001");
  if (el.dataset.inventoryKey === inventoryKey) return;
  el.dataset.inventoryKey = inventoryKey;
  el.replaceChildren();
  const label = document.createElement("span");
  label.textContent = items.length > 0 ? `持ち物: ${items.join(", ")}` : "持ち物: なし";
  el.appendChild(label);
  if (items.includes("謎の宝石")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "use-item-btn";
    button.textContent = "🔮 使う";
    button.addEventListener("click", () => useItem(id === "lunaInventory" ? state.luna : state.player, id === "lunaInventory" ? "Luna" : "You", "謎の宝石"));
    el.appendChild(button);
  }
}

async function requestAutonomousAction() {
  if (state.autonomyBusy || state.status === "moving" || Date.now() - state.lastAutonomyAt < 4000) return;
  state.autonomyBusy = true;
  state.lastAutonomyAt = Date.now();
  try {
    const remainingObjects = state.objects.filter((obj) => !obj.found);
    const terrain = Object.fromEntries(Object.keys(OBJECT_TYPES).map((type) => [
      type,
      remainingObjects.filter((obj) => obj.type === type).length,
    ]));
    const response = await fetch(AUTONOMY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        area: AREA_CONFIG[state.areaIndex].name,
        status: state.status,
        terrain,
        remaining: remainingObjects.map((obj) => obj.label),
        luna: { hp: state.luna.hp, hpMax: state.luna.hpMax, mp: state.luna.mp, mpMax: state.luna.mpMax, inventory: state.luna.inventory, level: state.luna.level },
        affinity: state.relationship.affinity,
        memories: state.relationship.memories.slice(-8),
        lastResult: state.lastActionResult,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      if (data.reply) {
        showLunaSpeech(data.reply);
        appendChatLine("Luna", data.reply);
      }
      if (data.target) trySetGoal(data.target);
      if (data.spell) castLunaSpell();
      if (!data.target && !data.spell) runLocalAutonomy();
    } else {
      runLocalAutonomy();
    }
  } catch (err) {
    console.warn("自律行動APIに接続できません", err);
    runLocalAutonomy();
  } finally {
    state.autonomyBusy = false;
  }
}

function runLocalAutonomy() {
  if (state.status !== "waiting") return;
  if (state.luna.inventory.includes("謎の宝石") && state.luna.mp < state.luna.mpMax) {
    useItem(state.luna, "Luna", "謎の宝石");
    return;
  }
  const nextTarget = state.luna.hp < 70 ? "apple" : state.luna.mp < 25 ? "water" : "treasure";
  if (findNearestObject(nextTarget, state.luna)) trySetGoal(nextTarget);
}

// ---------- メインループ ----------
function loop() {
  update();
  draw();
  updateStatusText();
  updateStatsPanel();
  if (state.status === "waiting") requestAutonomousAction();
  requestAnimationFrame(loop);
}
loop();

// ---------- Lunaの吹き出し ----------
function showLunaSpeech(text, durationMs = 6000) {
  state.luna.speechText = text;
  if (state.luna.speechTimer) clearTimeout(state.luna.speechTimer);
  state.luna.speechTimer = setTimeout(() => { state.luna.speechText = ""; }, durationMs);
}

async function maybeLunaTalk() {
  if (Date.now() - state.lastLunaTalkAt < 9000) return;
  state.lastLunaTalkAt = Date.now();
  let line = "";
  const remainingObjects = state.objects.filter((obj) => !obj.found);
  const terrain = Object.fromEntries(Object.keys(OBJECT_TYPES).map((type) => [
    type,
    remainingObjects.filter((obj) => obj.type === type).length,
  ]));
  try {
    const response = await fetch(PROACTIVE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        area: AREA_CONFIG[state.areaIndex].name,
        status: state.status,
        target: state.luna.targetObject ? state.luna.targetObject.label : null,
        terrain,
        luna: { hp: state.luna.hp, hpMax: state.luna.hpMax, mp: state.luna.mp, mpMax: state.luna.mpMax, inventory: state.luna.inventory, level: state.luna.level },
        affinity: state.relationship.affinity,
        memories: state.relationship.memories.slice(-6),
        lastResult: state.lastActionResult,
        nearby: remainingObjects.filter((obj) => isPointVisible(obj)).map((obj) => obj.label),
      }),
    });
    const data = await response.json();
    if (response.ok) line = data.reply;
  } catch (err) {
    console.warn("Lunaの自発発話APIに接続できません", err);
  }
  if (!line) {
    const lines = state.status === "moving"
      ? ["この先に何かいる気がする…", "少しずつ進むね。", "壁の向こうはまだ見えない。"]
      : ["あなた、何か見つけた？", "次はどこへ行こうか。", "この場所、少し気になる。"];
    line = lines[randomInt(0, lines.length - 1)];
  }
  showLunaSpeech(line);
  appendChatLine("Luna", line);
}

// ---------- server.py (LunaChat API) との連携 ----------
async function sendChatMessage(message) {
  if (!message) return;
  appendChatLine("You", message);
  changeAffinity(2);
  remember(`あなたが「${message.slice(0, 30)}」と話しかけた`);

  try {
    const response = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        gameContext: {
          area: AREA_CONFIG[state.areaIndex].name,
          status: state.status,
          luna: { hp: state.luna.hp, hpMax: state.luna.hpMax, mp: state.luna.mp, mpMax: state.luna.mpMax, inventory: state.luna.inventory, level: state.luna.level },
          affinity: state.relationship.affinity,
          memories: state.relationship.memories.slice(-8),
          lastResult: state.lastActionResult,
        },
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      appendChatLine("System", data.error || "サーバーとの通信に失敗しました。");
      return;
    }

    showLunaSpeech(data.reply);
    appendChatLine("Luna", data.reply);

    if (data.target) trySetGoal(data.target);
  } catch (err) {
    appendChatLine("System", "server.py に接続できません。起動していますか？ (python server.py)");
    console.error(err);
  }
}

function appendChatLine(speaker, text) {
  const log = document.getElementById("chatLog");
  if (!log) return;
  const line = document.createElement("div");
  line.className = "chat-line" + (speaker === "Battle" ? " chat-battle" : "");
  line.innerHTML = `<span class="chat-speaker">${speaker}:</span> ${escapeHtml(text)}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function serializeCharacter(character) {
  return {
    hp: character.hp,
    hpMax: character.hpMax,
    mp: character.mp,
    mpMax: character.mpMax,
    inventory: [...character.inventory],
    level: character.level,
    xp: character.xp,
    xpNext: character.xpNext,
  };
}

function getSaveData() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    areaIndex: state.areaIndex,
    relationship: state.relationship,
    luna: serializeCharacter(state.luna),
    player: serializeCharacter(state.player),
  };
}

function applySaveData(saved) {
  state = createGameState(saved.relationship || loadRelationship(), saved.areaIndex || 0, null, {
    luna: saved.luna || state.luna,
    player: saved.player || state.player,
  });
}

function saveGameData() {
  const saveData = getSaveData();
  localStorage.setItem(GAME_DATA_STORAGE_KEY, JSON.stringify(saveData));
  const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "luna-save.json";
  link.click();
  URL.revokeObjectURL(url);
  appendChatLine("System", "💾 ゲームデータを保存しました。");
}

function loadGameData() {
  try {
    const saved = JSON.parse(localStorage.getItem(GAME_DATA_STORAGE_KEY) || "null");
    if (!saved) {
      appendChatLine("System", "保存データがありません。");
      return;
    }
    applySaveData(saved);
    appendChatLine("System", "📂 ゲームデータを読み込みました。");
  } catch (error) {
    appendChatLine("System", "保存データを読み込めませんでした。");
  }
}

function loadGameFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      applySaveData(JSON.parse(reader.result));
      appendChatLine("System", "📂 データファイルを読み込みました。");
    } catch (error) {
      appendChatLine("System", "データファイルの形式が正しくありません。");
    }
  });
  reader.readAsText(file);
}

window.addEventListener("beforeunload", () => {
  localStorage.setItem(GAME_DATA_STORAGE_KEY, JSON.stringify(getSaveData()));
});

// ---------- 新しいマップを生成 ----------
function regenerateMap() {
  state = createGameState(state.relationship, state.areaIndex, null, { luna: state.luna, player: state.player });
  appendChatLine("System", "（新しいマップを生成しました）");
}

function advanceArea(direction = "next") {
  const step = direction === "previous" ? -1 : 1;
  const nextAreaIndex = state.areaIndex + step;
  if (nextAreaIndex < 0 || nextAreaIndex >= AREA_CONFIG.length) {
    appendChatLine("System", "（これ以上進めるエリアはありません）");
    return;
  }
  const entrySide = direction === "next" ? "left" : "right";
  remember(`${AREA_CONFIG[state.areaIndex].name}から${AREA_CONFIG[nextAreaIndex].name}へ${direction === "next" ? "進んだ" : "戻った"}`);
  changeAffinity(3);
  state = createGameState(state.relationship, nextAreaIndex, entrySide, { luna: state.luna, player: state.player });
  appendChatLine("System", `（${AREA_CONFIG[nextAreaIndex].name}へ進みました）`);
}

// ---------- UIの配線 ----------
(function setupUI() {
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSendBtn");
  const newMapBtn = document.getElementById("newMapBtn");
  const saveGameBtn = document.getElementById("saveGameBtn");
  const loadGameBtn = document.getElementById("loadGameBtn");
  const loadGameFileInput = document.getElementById("loadGameFileInput");
  const nextAreaBtn = document.getElementById("nextAreaBtn");
  const commandButtons = document.querySelectorAll("[data-luna-target]");
  const spellBtn = document.getElementById("lunaSpellBtn");
  const useGemBtn = document.getElementById("useLunaGemBtn");
  const playerSpellBtn = document.getElementById("playerSpellBtn");
  const playerStormBtn = document.getElementById("playerStormBtn");
  const usePlayerGemBtn = document.getElementById("usePlayerGemBtn");
  const visibilityToggle = document.getElementById("visibilityToggle");

  function trigger() {
    const message = input.value.trim();
    if (!message) return;
    sendChatMessage(message);
    input.value = "";
  }

  if (sendBtn) sendBtn.addEventListener("click", trigger);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); trigger(); }
    });
  }
  if (newMapBtn) newMapBtn.addEventListener("click", regenerateMap);
  if (saveGameBtn) saveGameBtn.addEventListener("click", saveGameData);
  if (loadGameBtn) loadGameBtn.addEventListener("click", () => loadGameFileInput?.click());
  if (loadGameFileInput) loadGameFileInput.addEventListener("change", () => loadGameFile(loadGameFileInput.files[0]));
  if (nextAreaBtn) nextAreaBtn.addEventListener("click", advanceArea);
  commandButtons.forEach((button) => button.addEventListener("click", () => trySetGoal(button.dataset.lunaTarget)));
  if (spellBtn) spellBtn.addEventListener("click", castLunaSpell);
  if (useGemBtn) useGemBtn.addEventListener("click", () => useItem(state.luna, "Luna", "謎の宝石"));
  if (playerSpellBtn) playerSpellBtn.addEventListener("click", castPlayerSpell);
  if (playerStormBtn) playerStormBtn.addEventListener("click", () => castPersistentSpell(state.player, "You"));
  if (usePlayerGemBtn) usePlayerGemBtn.addEventListener("click", () => useItem(state.player, "You", "謎の宝石"));
  if (visibilityToggle) visibilityToggle.addEventListener("change", () => { visibilityEnabled = visibilityToggle.checked; });
})();