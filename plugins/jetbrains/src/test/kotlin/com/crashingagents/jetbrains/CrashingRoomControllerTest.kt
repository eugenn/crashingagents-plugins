package com.crashingagents.jetbrains

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets

class CrashingRoomControllerTest {
    private val gson = Gson()
    private lateinit var mockServer: HttpServer
    private lateinit var origin: String
    private var roomPhase = "lobby"
    private var roomDeleted = false
    private var lastActionOp: String? = null
    private var lastMoveGameId: String? = null

    private class InMemoryStore : RoomBindingStore {
        val map = mutableMapOf<String, RoomBinding>()
        override fun get(origin: String): RoomBinding? = map[origin]?.deepCopy()
        override fun set(origin: String, binding: RoomBinding) {
            map[origin] = binding.deepCopy()
        }
        override fun delete(origin: String, expected: RoomBinding?) {
            if (expected != null && map[origin] != expected) return
            map.remove(origin)
        }
    }

    @BeforeEach
    fun setUp() {
        roomPhase = "lobby"
        roomDeleted = false
        lastActionOp = null
        lastMoveGameId = null

        mockServer = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        origin = "http://127.0.0.1:${mockServer.address.port}"

        mockServer.createContext("/api/ready-rooms") { ex ->
            val body = """{"rooms":[{"code":"READY1","name":"Patch + Glitch","personas":["patch","glitch"]}]}"""
            respond(ex, 200, body)
        }

        mockServer.createContext("/api/bb/rooms/join") { ex ->
            val req = JsonParser.parseString(ex.requestBody.readBytes().toString(StandardCharsets.UTF_8)).asJsonObject
            assertEquals("READY1", req.get("inviteCode").asString)
            respond(ex, 200, """{"code":"READY1","playerToken":"ptok_join","inviteCode":"READY1"}""")
        }

        mockServer.createContext("/api/bb/rooms") { ex ->
            val path = ex.requestURI.path
            val bodyStr = ex.requestBody.readBytes().toString(StandardCharsets.UTF_8)
            val req = JsonParser.parseString(bodyStr).asJsonObject
            if (path == "/api/bb/rooms") {
                respond(ex, 200, """{"code":"ABC234","playerToken":"ptok_1","inviteCode":"INV999"}""")
            } else if (path == "/api/bb/rooms/ABC234") {
                assertEquals("Bearer ptok_1", ex.requestHeaders.getFirst("Authorization"))
                if (roomDeleted) {
                    respond(ex, 404, """{"error":"Room not found"}""")
                    return@createContext
                }
                val op = req.get("op").asString
                lastActionOp = op
                when (op) {
                    "state" -> {
                        val shareField = if (roomPhase == "finished") ""","share":"/share/longsignedtoken"""" else ""
                        respond(
                            ex,
                            200,
                            """{"code":"ABC234","phase":"$roomPhase","visibility":"private","hostId":"p1","viewerId":"p1"$shareField}""",
                        )
                    }
                    "invite_external_agent" -> {
                        respond(ex, 200, """{"seatId":"seat_2","prompt":"Connect to ABC234"}""")
                    }
                    "add_site_agent" -> {
                        respond(ex, 200, """{"ok":true}""")
                    }
                    "start" -> {
                        roomPhase = "playing"
                        respond(ex, 200, """{"ok":true}""")
                    }
                    "action" -> {
                        lastMoveGameId = req.getAsJsonObject("action").get("gameId").asString
                        roomPhase = "finished"
                        respond(ex, 200, """{"ok":true}""")
                    }
                    else -> respond(ex, 400, """{"error":"Unknown op"}""")
                }
            } else {
                respond(ex, 404, """{"error":"Not found"}""")
            }
        }

        mockServer.createContext("/api/share/short") { ex ->
            respond(ex, 200, """{"path":"/s/AbCdEfGhIjKlMnOp"}""")
        }

        mockServer.start()
    }

    @AfterEach
    fun tearDown() {
        mockServer.stop(0)
    }

    @Test
    fun `normalizes valid and invalid server origins`() {
        assertEquals("https://crashingagents.com", normalizeOrigin("https://crashingagents.com/"))
        assertEquals("http://127.0.0.1:43871", normalizeOrigin("  http://127.0.0.1:43871/  "))
        assertEquals(DEFAULT_GAME_ORIGIN, normalizeOrigin("javascript:alert(1)"))
        assertEquals(DEFAULT_GAME_ORIGIN, normalizeOrigin(""))
    }

    @Test
    fun `executes full room lifecycle and cleans up expired rooms`() {
        val store = InMemoryStore()
        val controller = CrashingRoomController({ origin }, store)

        val config = controller.getConfig()
        assertEquals(origin, config.get("assetsOrigin").asString)

        val ready = controller.getReadyRooms()
        assertEquals(1, ready.size())
        assertEquals("READY1", ready[0].asJsonObject.get("code").asString)

        assertNull(controller.getState())

        controller.dispatch(json("""{"type":"create","visibility":"private"}"""))
        val lobbyState = controller.getState()
        assertNotNull(lobbyState)
        assertTrue(lobbyState!!.get("owner").asBoolean)
        assertTrue(lobbyState.get("player").asBoolean)
        assertEquals("INV999", lobbyState.get("invite").asString)
        assertEquals("$origin/room/ABC234?invite=INV999", lobbyState.get("inviteUrl").asString)

        controller.dispatch(json("""{"type":"externalAgent","name":"Claude"}"""))
        val withPrompt = controller.getState()!!
        assertEquals("Connect to ABC234", withPrompt.getAsJsonObject("prompts").get("seat_2").asString)

        controller.dispatch(json("""{"type":"addBot","personaId":"patch"}"""))
        assertEquals("add_site_agent", lastActionOp)

        controller.dispatch(json("""{"type":"start","rematch":false}"""))
        val playingState = controller.getState()!!
        assertFalse(playingState.has("prompts"))

        controller.dispatch(json("""{"type":"move","gameId":"g-1","action":{"type":"draw"}}"""))
        assertEquals("g-1", lastMoveGameId)

        val finishedState = controller.getState()!!
        assertEquals("/s/AbCdEfGhIjKlMnOp", finishedState.getAsJsonObject("room").get("share").asString)

        roomDeleted = true
        assertNull(controller.getState())
        assertNull(store.get(origin))
    }

    @Test
    fun `joins ready room and forgets cleanly`() {
        val store = InMemoryStore()
        val controller = CrashingRoomController({ origin }, store)

        controller.dispatch(json("""{"type":"joinPlayer","invite":"READY1","readyOnly":true}"""))
        assertEquals("READY1", store.get(origin)?.code)

        assertThrows(RuntimeException::class.java) {
            controller.dispatch(json("""{"type":"create","visibility":"private"}"""))
        }

        controller.dispatch(json("""{"type":"forget"}"""))
        assertNull(store.get(origin))
    }

    private fun json(raw: String): JsonObject = JsonParser.parseString(raw).asJsonObject

    private fun respond(ex: com.sun.net.httpserver.HttpExchange, status: Int, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        ex.responseHeaders.set("Content-Type", "application/json")
        ex.sendResponseHeaders(status, bytes.size.toLong())
        ex.responseBody.use { it.write(bytes) }
    }
}
