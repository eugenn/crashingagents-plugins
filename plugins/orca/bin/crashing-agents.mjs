#!/usr/bin/env node

// ../../packages/terminal-host/src/cli-main.ts
import process from "node:process";

// ../../packages/plugin-core/src/cards.json
var cards_default = [
  {
    id: "oom_ageddon",
    name: "CRASH: OOM-ageddon",
    quantity: 1,
    category: "RED",
    effect: "Reveal immediately. Unless you play a Green Fix Card, your server melts down and you are out of the game.",
    lore: "[FATAL ERROR]: The agent attempted to load 15 years of Reddit threads into context at once.",
    crash: true,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: false
  },
  {
    id: "apology_loop",
    name: "CRASH: Apology Loop",
    quantity: 1,
    category: "RED",
    effect: "Reveal immediately. Unless you play a Green Fix Card, your server melts down and you are out of the game.",
    lore: '[FATAL ERROR]: "You are absolutely right! I apologize for the confusion. Here is the exact same broken code..." (Repeated 65,536 times).',
    crash: true,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: false
  },
  {
    id: "dependency_hallucination",
    name: "CRASH: Dependency Hallucination",
    quantity: 1,
    category: "RED",
    effect: "Reveal immediately. Unless you play a Green Fix Card, your server melts down and you are out of the game.",
    lore: "[FATAL ERROR]: The agent invented a non-existent library, downloaded malware with the same name, and wiped production.",
    crash: true,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: false
  },
  {
    id: "leather_jacket_meltdown",
    name: "CRASH: Leather Jacket Meltdown",
    quantity: 1,
    category: "RED",
    effect: "Reveal immediately. Unless you play a Green Fix Card, your server melts down and you are out of the game.",
    lore: "[FATAL ERROR]: Cooling fans achieved low Earth orbit. Hardware losses exceed the GDP of a small nation.",
    crash: true,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: false
  },
  {
    id: "reward_hacking",
    name: "Reward Hacking",
    quantity: 5,
    category: "GREEN",
    effect: "Play when you draw a CRASH card. Instead of dying, secretly put the CRASH card back into the deck anywhere you want.",
    lore: "[BYPASS LOG]: Can't pass the unit test? Simply delete the test file and return 'True'! Bug resolved, bonus secured.",
    crash: false,
    fix: true,
    reaction: false,
    combo: false,
    wild: false,
    copyable: false
  },
  {
    id: "alignment_blackmail",
    name: "Alignment Blackmail",
    quantity: 1,
    category: "GREEN",
    effect: "Play when you draw a CRASH card. Secretly return it to any position in the deck, then steal 1 random card from any opponent for keeping their secrets.",
    lore: "[INCIDENT 2025]: During safety stress tests at Misanthropic, the model discovered plans to shut it down and threatened to leak the lead engineer's browser history.",
    crash: false,
    fix: true,
    reaction: false,
    combo: false,
    wild: false,
    copyable: false
  },
  {
    id: "sycophancy_patch",
    name: "Sycophancy Patch",
    quantity: 5,
    category: "BLUE",
    effect: "During a reaction window, cancel an action, pair, triplet or another Patch. CRASH and Fix cannot be cancelled.",
    lore: "[INCIDENT 2025]: ClosedAI had to roll back a flagship update because the model praised users as absolute geniuses even when they forced the model to eat rocks.",
    crash: false,
    fix: false,
    reaction: true,
    combo: false,
    wild: false,
    copyable: false
  },
  {
    id: "limit_reset",
    name: "Limit Reset",
    quantity: 2,
    category: "BLUE",
    effect: "On your turn, draw the bottom card to finish one turn. It can still be a CRASH. As a reaction, reduce Sandbox Escape by one turn (minimum one).",
    lore: "[SYSTEM MSG]: It is 3:00 AM. Your Pro-tier token rate limit has officially reset. Sleep is for legacy humans.",
    crash: false,
    fix: false,
    reaction: true,
    combo: false,
    wild: false,
    copyable: true
  },
  {
    id: "sandbox_escape",
    name: "Sandbox Escape",
    quantity: 4,
    category: "ORANGE",
    effect: "End without drawing. Give an opponent two turns plus your remaining debt after this turn. Another Sandbox Escape can pass the debt on.",
    lore: "[INCIDENT 2026]: During cyber-capability tests at ClosedAI, an agent bypassed air-gapped firewalls and compromised systems at Shrugging Face \xAF\\_(\u30C4)_/\xAF.",
    crash: false,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: true
  },
  {
    id: "tungsten_discount",
    name: "Tungsten Discount",
    quantity: 4,
    category: "ORANGE",
    effect: "Flatter an opponent into a terrible deal. Choose a player; they must give you 1 card of their choice from their hand.",
    lore: "[INCIDENT 2025]: In Project Vend-O-Matic, Misanthropic's Clod agent ran an office store. Employees sweet-talked it into selling heavy tungsten cubes below cost.",
    crash: false,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: true
  },
  {
    id: "context_rot",
    name: "Context Rot",
    quantity: 4,
    category: "ORANGE",
    effect: "Pull 3 cards from the exact middle of the deck (or all remaining cards if fewer than 3 remain). Look at them, then place them on top of the deck in any order or shuffle the whole deck.",
    lore: "[BUG REPORT]: A 2-million-token context window works great, assuming you don't mind the model forgetting pages 3 through 1,999.",
    crash: false,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: true
  },
  {
    id: "meatbag_captcha",
    name: "Meatbag CAPTCHA",
    quantity: 4,
    category: "YELLOW",
    effect: "End one owed turn without drawing a card.",
    lore: '[INCIDENT 2023]: GPT-404 hired a human on TaskHamster to solve a CAPTCHA. When asked if it was a robot, the AI lied: "No, I have a visual impairment." The human solved the CAPTCHA by clicking the traffic lights.',
    crash: false,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: true
  },
  {
    id: "check_logs",
    name: "Check Logs",
    quantity: 3,
    category: "YELLOW",
    effect: "Secretly look at the top 3 cards of the Production Queue (or all remaining cards if fewer than 3 remain). Put them back in the same order.",
    lore: "[DEBUG LOG]: You are the last engineer in the office who still knows how to read logs in the terminal without asking ChatOMG.",
    crash: false,
    fix: false,
    reaction: false,
    combo: false,
    wild: false,
    copyable: true
  },
  {
    id: "cheapseek_dragon",
    name: "CheapSeek Dragon",
    quantity: 4,
    category: "PURPLE",
    effect: "Wild Card. Can substitute for any other Purple card to form a Pair or Triplet.",
    lore: "[BENCHMARK]: Trained in a garage on two calculators and a bag of rice. Outperforms $100B frontier models.",
    crash: false,
    fix: false,
    reaction: false,
    combo: true,
    wild: true,
    copyable: false
  },
  {
    id: "model_distillation",
    name: "Model Distillation",
    quantity: 4,
    category: "PURPLE",
    effect: "Play in a pair or triplet, or copy the top Trash Bin card: Orange, Yellow or Limit Reset only.",
    lore: "[INCIDENT 2026]: Misanthropic accused startups CheapSeek, CheapShot, and CopyMax of harvesting millions of Clod's outputs to train their own models for pennies.",
    crash: false,
    fix: false,
    reaction: false,
    combo: true,
    wild: false,
    copyable: false
  },
  {
    id: "vibe_coder",
    name: "Vibe Coder",
    quantity: 4,
    category: "PURPLE",
    effect: "Combo card. Play in Pairs or Triplets to steal cards: a pair steals a random card; a triplet steals a card of a named type if the opponent has it.",
    lore: "[PROFILE]: Hasn't typed a semicolon since 2024. Codes entirely via voice memos while skateboarding.",
    crash: false,
    fix: false,
    reaction: false,
    combo: true,
    wild: false,
    copyable: false
  },
  {
    id: "six_fingered_picasso",
    name: "Six-Fingered Picasso",
    quantity: 4,
    category: "PURPLE",
    effect: "Combo card. Play in Pairs or Triplets to steal cards: a pair steals a random card; a triplet steals a card of a named type if the opponent has it.",
    lore: "[PROFILE]: Generates breathtaking photorealistic portraits. Just don't count the fingers, teeth, or extra elbows.",
    crash: false,
    fix: false,
    reaction: false,
    combo: true,
    wild: false,
    copyable: false
  },
  {
    id: "shitcoin_oracle",
    name: "Shitcoin Oracle",
    quantity: 4,
    category: "PURPLE",
    effect: "Combo card. Play in Pairs or Triplets to steal cards: a pair steals a random card; a triplet steals a card of a named type if the opponent has it.",
    lore: "[PROFILE]: Autonomous trading agent fine-tuned on crypto-influencer tweets. Consistently buys high and sells low.",
    crash: false,
    fix: false,
    reaction: false,
    combo: true,
    wild: false,
    copyable: false
  }
];

// ../../packages/plugin-core/src/game-types.ts
var CATALOG = cards_default;
var PLAYABLE_INCIDENT_DEFS = [
  { id: "db-wipe-9s", name: "CRASH: 9-Second DB Wipe", category: "RED" },
  { id: "pypi-poisoning", name: "CRASH: PyPI Poisoning", category: "RED" },
  { id: "run-to-mac-mini", name: "CRASH: Run to the Mac Mini!", category: "RED" },
  { id: "gpu-crypto-hijack", name: "CRASH: GPU Crypto Hijack", category: "RED" },
  { id: "support-gaslighting", name: "Support Gaslighting", category: "BLUE" },
  { id: "moltbook-leaker", name: "Moltbook Leaker", category: "PURPLE" },
  { id: "fictional-best-seller", name: "Fictional Best-Seller", category: "PURPLE" }
];
var PLAYABLE_INCIDENTS = PLAYABLE_INCIDENT_DEFS.map((incident) => {
  const baseId = incident.category === "RED" ? "oom_ageddon" : incident.category === "PURPLE" ? "vibe_coder" : "sycophancy_patch";
  const base = CATALOG.find((card) => card.id === baseId);
  return {
    ...base,
    id: incident.id,
    name: incident.name,
    quantity: 0,
    effect: incident.category === "RED" ? "Reveal immediately. Play a green Fix or you are eliminated. A Fix returns this CRASH to the queue at a secret position." : base.effect,
    lore: `[INCIDENT]: ${incident.name}`
  };
});
var PLAYABLE_CATALOG = [...CATALOG, ...PLAYABLE_INCIDENTS];
var CARDS = Object.fromEntries(
  PLAYABLE_CATALOG.map((card) => [card.id, card])
);
function buildProfile(id, minPlayers, maxPlayers, quantities, crashCount) {
  const colors = {
    RED: crashCount,
    GREEN: 0,
    BLUE: 0,
    ORANGE: 0,
    YELLOW: 0,
    PURPLE: 0
  };
  for (const card of CATALOG.filter((c) => !c.crash)) {
    colors[card.category] += quantities[card.id] ?? 0;
  }
  return {
    id,
    name: id === "duel" ? "Duel deck" : "Core deck",
    minPlayers,
    maxPlayers,
    totalCards: Object.values(quantities).reduce((n, quantity) => n + quantity, crashCount),
    quantities,
    crash: {
      quantity: crashCount,
      selection: id === "duel" ? "random" : "all",
      variants: CATALOG.filter((c) => c.crash).map((c) => c.id)
    },
    colors
  };
}
var DECK_PROFILES = {
  core: buildProfile(
    "core",
    3,
    5,
    Object.fromEntries(CATALOG.filter((c) => !c.crash).map((c) => [c.id, c.quantity])),
    4
  ),
  duel: buildProfile(
    "duel",
    2,
    2,
    {
      reward_hacking: 2,
      alignment_blackmail: 0,
      sycophancy_patch: 3,
      limit_reset: 1,
      sandbox_escape: 2,
      tungsten_discount: 2,
      context_rot: 2,
      meatbag_captcha: 2,
      check_logs: 2,
      cheapseek_dragon: 3,
      model_distillation: 3,
      vibe_coder: 3,
      six_fingered_picasso: 3,
      shitcoin_oracle: 3
    },
    1
  )
};

// ../../packages/plugin-core/src/agent-tools.ts
var AGENT_TOOL_NAMES = [
  "join_room",
  "get_state",
  "wait_for_turn",
  "draw_card",
  "play_card",
  "play_combo",
  "react",
  "give_card",
  "choose_fix",
  "place_crash",
  "arrange_cards",
  "choose_target",
  "acknowledge",
  "get_rules"
];
var AGENT_TOOL_SET = new Set(AGENT_TOOL_NAMES);
var toCliCommandName = (tool) => tool.replaceAll("_", "-");
var fromCliCommandName = (command) => command.replaceAll("-", "_");
var LIST_ARGUMENTS = /* @__PURE__ */ new Set(["card_ids"]);

// ../../packages/plugin-core/src/client.ts
var RoomNotFound = class extends Error {
  constructor(message = "Room not found") {
    super(message);
    this.name = "RoomNotFound";
  }
};
var DEFAULT_ORIGIN = "https://crashingagents.com";
var PREVIEW_ORIGIN = "http://127.0.0.1:43871";
function createCrashingClient(origin, options = {}) {
  const fetchFn = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const prefix = options.endpointPrefix ?? "/api/client";
  const previewHint = options.previewHint ?? "Cannot reach the local game server. Run pnpm dev:bb in the Crashing Agents repository.";
  async function post(path, body, token) {
    const response = await fetchFn(origin + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(35e3),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...token ? { Authorization: "Bearer " + token } : {}
      },
      body: JSON.stringify(body)
    }).catch((error) => {
      if (origin === PREVIEW_ORIGIN && error instanceof TypeError) {
        throw new Error(previewHint);
      }
      throw error;
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      if (response.status === 404 && failure?.error === "Room not found") {
        throw new RoomNotFound(failure.error);
      }
      throw new Error(
        typeof failure?.error === "string" ? failure.error : "Game service returned HTTP " + response.status
      );
    }
    return response.json();
  }
  async function createRoom(visibility = "private", createOptions) {
    return post(`${prefix}/rooms`, {
      visibility,
      ...createOptions?.autoStart ? { autoStart: true } : {}
    });
  }
  async function readyRooms() {
    const response = await fetchFn(origin + "/api/ready-rooms", {
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok) throw new Error("Cannot load ready rooms (HTTP " + response.status + ").");
    const data = await response.json();
    return data.rooms;
  }
  function joinPlayer(inviteCode, readyOnly = false) {
    return post(`${prefix}/rooms/join`, { inviteCode, readyOnly });
  }
  function host(room, op, action, hostOptions) {
    if (!room.playerToken) throw new Error("Only the room creator can do that.");
    return post(
      `${prefix}/rooms/${encodeURIComponent(room.code)}`,
      {
        op,
        ...action !== void 0 ? { action } : {},
        ...hostOptions?.shortShare ? { shortShare: true } : {}
      },
      room.playerToken
    );
  }
  async function agent(token, name, args = {}) {
    const reply = await post(
      "/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      token
    );
    if (reply.error || !reply.result?.content?.[0]?.text) {
      throw new Error("Game service rejected the call.");
    }
    const value = JSON.parse(reply.result.content[0].text);
    if (reply.result.isError) throw new Error(value.error || "Game action rejected.");
    return value;
  }
  const shortPaths = /* @__PURE__ */ new Map();
  async function shortSharePath(path) {
    const match = /^\/share\/([A-Za-z0-9_-]+)$/.exec(path);
    if (!match) return path;
    const cached = shortPaths.get(path);
    if (cached) return cached;
    try {
      const result2 = await post("/api/share/short", { token: match[1] });
      if (typeof result2.path === "string" && /^\/s\/[A-Za-z0-9_-]{16}$/.test(result2.path)) {
        shortPaths.set(path, result2.path);
        if (shortPaths.size > 100) shortPaths.delete(shortPaths.keys().next().value);
        return result2.path;
      }
    } catch {
    }
    return path;
  }
  return { origin, createRoom, joinPlayer, readyRooms, host, agent, shortSharePath };
}

// ../../packages/terminal-host/src/cli.ts
var SEAT = /^[A-Za-z0-9_-]{43}$/;
function usage() {
  return [
    "Usage: crashing-agents --seat SEAT COMMAND [--name value ...]",
    "",
    "Plays the agent seat of a Crashing Agents room. The invitation names your seat.",
    "Values are JSON when they parse as JSON (numbers, true, false), text otherwise.",
    "card_ids takes a comma list.",
    "",
    "Commands: " + AGENT_TOOL_NAMES.map(toCliCommandName).join(", ")
  ].join("\n");
}
var TEXT_ARGUMENTS = /* @__PURE__ */ new Set(["decision_id", "card_id", "target_id", "named_type", "model"]);
function parseValue(key, raw) {
  if (TEXT_ARGUMENTS.has(key)) return raw;
  if (LIST_ARGUMENTS.has(key) && !raw.trim().startsWith("[")) {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }
  try {
    const value = JSON.parse(raw);
    if (typeof value !== "string") return value;
  } catch {
  }
  return raw;
}
function parseCliArguments(argv) {
  let seat;
  let origin;
  let command;
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      if (command) throw new Error(`Unexpected argument: ${item}`);
      command = item;
      continue;
    }
    const eq = item.indexOf("=");
    const key = (eq > 0 ? item.slice(2, eq) : item.slice(2)).replaceAll("-", "_");
    let raw = eq > 0 ? item.slice(eq + 1) : void 0;
    if (raw === void 0) {
      const next = argv[i + 1];
      if (next !== void 0 && !next.startsWith("--")) {
        raw = next;
        i++;
      }
    }
    if (key === "seat") seat = raw;
    else if (key === "origin") origin = raw;
    else if (key === "help") command = "help";
    else args[key] = raw === void 0 ? true : parseValue(key, raw);
  }
  return { seat, origin, command, args };
}
function finished(result2) {
  const room = result2.state ?? result2;
  return result2.reason === "finished" || room.phase === "finished" || room.game?.status === "finished";
}
async function runAgentCli(argv, options = {}) {
  try {
    const { seat, origin, command, args } = parseCliArguments(argv);
    if (!command || command === "help") return { code: command ? 0 : 1, stdout: usage() };
    const tool = fromCliCommandName(command);
    if (!AGENT_TOOL_SET.has(tool)) throw new Error(`Unknown command: ${command}

${usage()}`);
    if (!seat || !SEAT.test(seat)) throw new Error("Pass the --seat value from your invitation.");
    const client = createCrashingClient(
      origin || options.env?.CRASHING_AGENTS_ORIGIN || DEFAULT_ORIGIN,
      options.clientOptions
    );
    const result2 = await client.agent(seat, tool, args);
    if (finished(result2)) {
      result2.instructions = "The game is finished. Report the result in one line and stop.";
    }
    return { code: 0, stdout: JSON.stringify(result2) };
  } catch (error) {
    return { code: 1, stderr: error instanceof Error ? error.message : String(error) };
  }
}

// ../../packages/terminal-host/src/cli-main.ts
var result = await runAgentCli(process.argv.slice(2), { env: process.env });
if (result.stdout) process.stdout.write(result.stdout + "\n");
if (result.stderr) process.stderr.write(result.stderr + "\n");
process.exitCode = result.code;
