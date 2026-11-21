package com.crashingagents.jetbrains

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import java.util.concurrent.atomic.AtomicBoolean

class CrashingRoomController(
    private val originProvider: () -> String,
    private val store: RoomBindingStore,
    private val clientFactory: (String) -> CrashingApiClient = { CrashingApiClient(it) },
) {
    private val busy = AtomicBoolean(false)
    @Volatile
    private var cachedClient: CrashingApiClient? = null

    private fun client(): CrashingApiClient {
        val origin = normalizeOrigin(originProvider())
        val existing = cachedClient
        if (existing != null && existing.origin == origin) return existing
        val created = clientFactory(origin)
        cachedClient = created
        return created
    }

    fun getConfig(): JsonObject {
        val capabilities = JsonObject().apply {
            addProperty("canInviteLocalAgent", false)
            addProperty("canOpenAgentChat", false)
            addProperty("agentTransport", "prompt")
        }
        return JsonObject().apply {
            addProperty("assetsOrigin", client().origin)
            add("capabilities", capabilities)
        }
    }

    fun getReadyRooms(): JsonArray = client().readyRooms()

    fun getState(): JsonObject? {
        val api = client()
        val binding = store.get(api.origin) ?: return null
        val room: JsonObject = try {
            if (!binding.playerToken.isNullOrBlank()) {
                api.host(binding, "state", shortShare = true)
            } else {
                val agentToken = binding.agentToken?.takeIf { it.isNotBlank() }
                    ?: return null
                api.agent(agentToken, "get_state")
            }
        } catch (_: RoomNotFoundException) {
            store.delete(api.origin, expected = binding)
            return null
        }

        val share = room.get("share")?.takeIf { it.isJsonPrimitive }?.asString
        if (!share.isNullOrBlank()) {
            room.addProperty("share", api.shortSharePath(share))
        }

        val phase = room.get("phase")?.takeIf { it.isJsonPrimitive }?.asString.orEmpty()
        var autoStart = binding.autoStart
        if (autoStart && phase != "lobby") {
            autoStart = false
            store.set(api.origin, binding.copy(autoStart = false))
        }

        val hostId = room.get("hostId")?.takeIf { it.isJsonPrimitive }?.asString
        val viewerId = room.get("viewerId")?.takeIf { it.isJsonPrimitive }?.asString
        val visibility = room.get("visibility")?.takeIf { it.isJsonPrimitive }?.asString
        val hasPlayerToken = !binding.playerToken.isNullOrBlank()
        val isOwner = hasPlayerToken && hostId != null && hostId == viewerId

        return JsonObject().apply {
            add("room", room)
            addProperty("owner", isOwner)
            addProperty("player", hasPlayerToken)
            addProperty("waitingForAgent", autoStart && phase == "lobby")
            addProperty("agent", !binding.agentToken.isNullOrBlank())
            if (binding.prompts.isNotEmpty() && phase == "lobby" && isOwner) {
                val promptsJson = JsonObject()
                for ((seatId, prompt) in binding.prompts) {
                    promptsJson.addProperty(seatId, prompt)
                }
                add("prompts", promptsJson)
            }
            if (!binding.inviteCode.isNullOrBlank()) {
                addProperty("invite", binding.inviteCode)
                val suffix = if (visibility == "private") "?invite=${binding.inviteCode}" else ""
                addProperty("inviteUrl", "${api.origin}/room/${binding.code}$suffix")
            }
        }
    }

    fun dispatch(command: JsonObject) {
        val type = command.get("type")?.takeIf { it.isJsonPrimitive }?.asString
            ?: throw IllegalArgumentException("Missing command type.")
        withLock {
            val api = client()
            when (type) {
                "create" -> {
                    if (store.get(api.origin) != null) {
                        throw RuntimeException("Disconnect the current room first.")
                    }
                    val visibility = command.get("visibility")?.takeIf { it.isJsonPrimitive }?.asString ?: "private"
                    store.set(api.origin, api.createRoom(visibility))
                }
                "joinPlayer" -> {
                    if (store.get(api.origin) != null) {
                        throw RuntimeException("Disconnect the current room first.")
                    }
                    val invite = command.get("invite")?.takeIf { it.isJsonPrimitive }?.asString
                        ?: throw IllegalArgumentException("Missing invite code.")
                    val readyOnly = command.get("readyOnly")?.takeIf { it.isJsonPrimitive }?.asBoolean ?: false
                    store.set(api.origin, api.joinPlayer(invite, readyOnly))
                }
                "joinSeat" -> {
                    if (store.get(api.origin) != null) {
                        throw RuntimeException("Disconnect the current room first.")
                    }
                    val token = command.get("token")?.takeIf { it.isJsonPrimitive }?.asString
                        ?: throw IllegalArgumentException("Missing agent token.")
                    val result = api.agent(token, "join_room")
                    val roomCode = result.get("roomCode")?.takeIf { it.isJsonPrimitive }?.asString
                        ?: throw RuntimeException("Missing roomCode from join_room.")
                    store.set(api.origin, RoomBinding(code = roomCode, agentToken = token))
                }
                "externalAgent" -> {
                    val room = requireRoom(api.origin)
                    val name = command.get("name")?.takeIf { it.isJsonPrimitive }?.asString.orEmpty()
                    val action = JsonObject().apply { addProperty("name", name) }
                    val res = api.host(room, "invite_external_agent", action)
                    val seatId = res.get("seatId")?.asString
                        ?: throw RuntimeException("Missing seatId in external agent response.")
                    val prompt = res.get("prompt")?.asString
                        ?: throw RuntimeException("Missing prompt in external agent response.")
                    val updated = room.deepCopy()
                    updated.prompts[seatId] = prompt
                    store.set(api.origin, updated)
                }
                "addBot" -> {
                    val room = requireRoom(api.origin)
                    val personaId = command.get("personaId")?.takeIf { it.isJsonPrimitive }?.asString
                        ?: throw IllegalArgumentException("Missing personaId.")
                    val action = JsonObject().apply { addProperty("personaId", personaId) }
                    api.host(room, "add_site_agent", action)
                }
                "start" -> {
                    val room = requireRoom(api.origin)
                    val rematch = command.get("rematch")?.takeIf { it.isJsonPrimitive }?.asBoolean ?: false
                    api.host(room, if (rematch) "rematch" else "start")
                }
                "move" -> {
                    val room = requireRoom(api.origin)
                    val gameId = command.get("gameId")?.takeIf { it.isJsonPrimitive }?.asString
                        ?: throw IllegalArgumentException("Missing gameId.")
                    val action = command.getAsJsonObject("action")?.deepCopy() ?: JsonObject()
                    action.addProperty("gameId", gameId)
                    api.host(room, "action", action)
                }
                "forget" -> {
                    store.delete(api.origin)
                }
                "duel", "inviteAgent" -> {
                    throw RuntimeException("Use 'Add AI agent' to invite an external or IDE agent via MCP or prompt.")
                }
                else -> throw IllegalArgumentException("Unsupported command type: $type")
            }
        }
    }

    private fun requireRoom(origin: String): RoomBinding =
        store.get(origin) ?: throw RuntimeException("Open Crashing Agents and create or join a room first.")

    private inline fun withLock(block: () -> Unit) {
        if (!busy.compareAndSet(false, true)) {
            throw RuntimeException("Another room operation is in progress.")
        }
        try {
            block()
        } finally {
            busy.set(false)
        }
    }
}
