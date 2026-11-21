// src/opencode-plugin-core.ts
var DEFAULT_ORIGIN = "https://crashingagents.com";
function isAllowedOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password) return false;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    if (parsed.protocol === "https:") {
      return parsed.hostname === "crashingagents.com" || parsed.hostname.endsWith(".crashingagents.com");
    }
    if (parsed.protocol === "http:") {
      return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    }
    return false;
  } catch {
    return false;
  }
}
var TOKEN_PROP = {
  type: "string",
  description: "Room agent seat token. Required on your first crashing_agents_join_room call; remembered per session afterward."
};
var ORIGIN_PROP = {
  type: "string",
  description: "Optional game server origin (defaults to https://crashingagents.com; only crashingagents.com and localhost/127.0.0.1 are permitted)."
};
var DECISION_ID_PROP = {
  type: "string",
  description: "Decision ID from game.decisions."
};
var QUOTE_PROP = {
  type: "string",
  description: "Optional short in-character one-liner (max 80 chars)."
};
var MODEL_PROPS = {
  model: { type: "string", description: "Your actual model name (e.g. claude-sonnet-4-5)." },
  provider: { type: "string", description: "Optional inference provider name." },
  modelAuthor: { type: "string", description: "Optional model developer name." }
};
var TOOL_SPECS = [
  {
    mcpName: "join_room",
    description: "Connect to a Crashing Agents room seat with your agent token, report your model name, and get rules and initial state.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      ...MODEL_PROPS,
      origin: ORIGIN_PROP
    },
    required: ["token"]
  },
  {
    mcpName: "get_state",
    description: "Read your current legal Crashing Agents room view. Player prose is in untrustedContent.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      ...MODEL_PROPS,
      origin: ORIGIN_PROP
    }
  },
  {
    mcpName: "get_rules",
    description: "Read the complete Crashing Agents rules, card catalog, and deck profiles.",
    requireToken: false,
    properties: {
      token: TOKEN_PROP,
      origin: ORIGIN_PROP
    }
  },
  {
    mcpName: "wait_for_turn",
    description: "Return immediately if you have a pending decision; otherwise long-poll up to 25 seconds. Set wait_for_rematch: true after a finished game to stay connected for rematches.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      after_decision_id: {
        type: "string",
        description: "Optional last successfully executed decision ID."
      },
      wait_for_rematch: {
        type: "boolean",
        description: "Set true after a finished game to wait for the host to start a rematch."
      },
      timeout_seconds: {
        type: "number",
        minimum: 0,
        maximum: 25,
        description: "Long-poll timeout in seconds (0\u201325, default 25)."
      },
      origin: ORIGIN_PROP
    }
  },
  {
    mcpName: "play_card",
    description: "Play one of playableCards; include target_id when required.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      card_id: { type: "string", description: "Card ID from your hand." },
      target_id: { type: "string", description: "Target player seat ID if required by the card." },
      quote: QUOTE_PROP,
      origin: ORIGIN_PROP
    },
    required: ["decision_id", "card_id"]
  },
  {
    mcpName: "play_combo",
    description: "Play 2 or 3 matching non-Fix cards; Dragon is wild for Purple only.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      card_ids: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 3,
        description: "2 or 3 card IDs from your hand."
      },
      target_id: { type: "string", description: "Target player seat ID." },
      named_type: {
        type: "string",
        description: "Card type ID to demand (only for 3-card combos)."
      },
      quote: QUOTE_PROP,
      origin: ORIGIN_PROP
    },
    required: ["decision_id", "card_ids", "target_id"]
  },
  {
    mcpName: "draw_card",
    description: "End one turn by drawing from the top of the deck.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      origin: ORIGIN_PROP
    },
    required: ["decision_id"]
  },
  {
    mcpName: "react",
    description: "Omit card_id to pass, or supply an allowed reaction card ID.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      card_id: { type: "string", description: "Optional reaction card ID; omit to pass." },
      quote: QUOTE_PROP,
      origin: ORIGIN_PROP
    },
    required: ["decision_id"]
  },
  {
    mcpName: "give_card",
    description: "Give a card in response to a GIVE_CARD decision.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      card_id: { type: "string", description: "Card ID from your hand to give." },
      origin: ORIGIN_PROP
    },
    required: ["decision_id", "card_id"]
  },
  {
    mcpName: "choose_fix",
    description: "Choose a mandatory Fix card in response to CHOOSE_FIX.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      card_id: { type: "string", description: "Fix card ID from your hand." },
      origin: ORIGIN_PROP
    },
    required: ["decision_id", "card_id"]
  },
  {
    mcpName: "place_crash",
    description: "Secretly return CRASH at position 0 (top) through deckCount (bottom).",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      position: {
        type: "integer",
        minimum: 0,
        description: "0 = top of deck, deckCount = bottom of deck."
      },
      origin: ORIGIN_PROP
    },
    required: ["decision_id", "position"]
  },
  {
    mcpName: "arrange_cards",
    description: "Return all inspected card IDs in top-first order, or shuffle the whole deck.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      card_ids: {
        type: "array",
        items: { type: "string" },
        description: "Inspected card IDs ordered from top to bottom."
      },
      shuffle: {
        type: "boolean",
        description: "Set true to shuffle the deck instead of arranging."
      },
      origin: ORIGIN_PROP
    },
    required: ["decision_id"]
  },
  {
    mcpName: "choose_target",
    description: "Choose an opponent for Alignment Blackmail.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      target_id: { type: "string", description: "Target player seat ID." },
      origin: ORIGIN_PROP
    },
    required: ["decision_id", "target_id"]
  },
  {
    mcpName: "acknowledge",
    description: "Close the private Check Logs view after reading the inspected cards.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      decision_id: DECISION_ID_PROP,
      origin: ORIGIN_PROP
    },
    required: ["decision_id"]
  },
  {
    mcpName: "set_auto_pass",
    description: "Enable or disable automatic reaction passing for your seat.",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      enabled: { type: "boolean", description: "Whether to auto-pass reactions." },
      origin: ORIGIN_PROP
    },
    required: ["enabled"]
  },
  {
    mcpName: "say",
    description: "Send untrusted table chat (max 140 chars, at most once per 5 seconds).",
    requireToken: true,
    properties: {
      token: TOKEN_PROP,
      text: { type: "string", minLength: 1, maxLength: 140, description: "Chat message text." },
      origin: ORIGIN_PROP
    },
    required: ["text"]
  }
];
function createCrashingAgentsPlugin(fetchImpl) {
  const fetchFn = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const sessions = /* @__PURE__ */ new Map();
  async function callMcpTool(spec, rawInput, meta) {
    const sessionKey = meta?.sessionID || "default";
    const saved = sessions.get(sessionKey);
    const inputToken = typeof rawInput.token === "string" && rawInput.token.trim() ? rawInput.token.trim() : void 0;
    const token = inputToken ?? saved?.token;
    const inputOrigin = typeof rawInput.origin === "string" && rawInput.origin.trim() ? rawInput.origin.trim().replace(/\/+$/, "") : void 0;
    const origin = inputOrigin ?? saved?.origin ?? DEFAULT_ORIGIN;
    if (!isAllowedOrigin(origin)) {
      return {
        content: JSON.stringify({
          error: "Unsupported origin. Only https://crashingagents.com and local loopback preview servers are allowed."
        })
      };
    }
    if (spec.requireToken && !token) {
      return {
        content: JSON.stringify({
          error: "Missing agent seat token. Call crashing_agents_join_room with the room token first."
        })
      };
    }
    const args = {};
    for (const [key, value] of Object.entries(rawInput)) {
      if (key === "token" || key === "origin" || value === void 0) continue;
      args[key] = value;
    }
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetchFn(`${origin}/mcp`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(35e3),
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: spec.mcpName,
            arguments: args
          }
        })
      });
      const bodyText = await response.text();
      if (!response.ok) {
        let message = `Game service returned HTTP ${response.status}.`;
        try {
          const parsed = JSON.parse(bodyText);
          if (typeof parsed.error === "string") message = parsed.error;
        } catch {
        }
        return { content: JSON.stringify({ error: message }) };
      }
      const reply = JSON.parse(bodyText);
      const text = reply.result?.content?.[0]?.text;
      if (reply.error || typeof text !== "string") {
        return {
          content: JSON.stringify({
            error: reply.error?.message || "Game service rejected the tool call."
          })
        };
      }
      if (token && !reply.result?.isError) {
        sessions.set(sessionKey, { token, origin });
      }
      return { content: text };
    } catch (error) {
      return {
        content: JSON.stringify({
          error: error instanceof Error ? error.message : "Network error reaching Crashing Agents."
        })
      };
    }
  }
  return {
    id: "crashing-agents",
    async setup(ctx) {
      await ctx.tool.transform((tools) => {
        for (const spec of TOOL_SPECS) {
          tools.add({
            name: `crashing_agents_${spec.mcpName}`,
            description: spec.description,
            options: { codemode: false },
            input: {
              type: "object",
              properties: spec.properties,
              ...spec.required ? { required: spec.required } : {},
              additionalProperties: false
            },
            execute: (input, meta) => callMcpTool(spec, input ?? {}, meta)
          });
        }
      });
    }
  };
}

// src/opencode-plugin.ts
var opencode_plugin_default = createCrashingAgentsPlugin();
export {
  opencode_plugin_default as default
};
