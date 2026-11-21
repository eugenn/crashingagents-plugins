package com.crashingagents.jetbrains

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList

class CrashingLoopbackServerTest {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()

    private fun newTestServer(
        copied: MutableList<String> = CopyOnWriteArrayList(),
        openedUrls: MutableList<String> = CopyOnWriteArrayList(),
    ): LoopbackBridgeServer {
        val store = object : RoomBindingStore {
            override fun get(origin: String): RoomBinding? = null
            override fun set(origin: String, binding: RoomBinding) = Unit
            override fun delete(origin: String, expected: RoomBinding?) = Unit
        }
        val controller = CrashingRoomController({ DEFAULT_GAME_ORIGIN }, store)
        val theme = JsonObject().apply {
            addProperty("mode", "dark")
            add("tokens", JsonObject().apply { addProperty("--jb-bg", "#1e1f22") })
        }
        return LoopbackBridgeServer(
            controller = controller,
            themeProvider = { theme },
            localeProvider = { "ru" },
            copyToClipboard = {
                copied.add(it)
                true
            },
            openExternalUrl = { openedUrls.add(it) },
            resourceLoader = { path ->
                when (path) {
                    "/webview/index.html" ->
                        "<script>window.__CRASHING_JETBRAINS__ = /*__BOOTSTRAP_JSON__*/ null;</script>".toByteArray()
                    "/webview/main.js" -> "console.log('ok');".toByteArray()
                    "/webview/styles.css" -> "body {}".toByteArray()
                    else -> null
                }
            },
        )
    }

    @Test
    fun `rejects unauthorized requests and serves authenticated bootstrap html`() {
        newTestServer().use { server ->
            val unauthHtml = http.send(
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:${server.port}/")).GET().build(),
                HttpResponse.BodyHandlers.ofString(),
            )
            assertEquals(403, unauthHtml.statusCode())

            val unauthBridge = http.send(
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:${server.port}/api/bridge"))
                    .POST(HttpRequest.BodyPublishers.ofString("""{"method":"getConfig"}"""))
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )
            assertEquals(403, unauthBridge.statusCode())

            val authHtml = http.send(
                HttpRequest.newBuilder(URI.create(server.urlFor(WebviewSurface.EDITOR))).GET().build(),
                HttpResponse.BodyHandlers.ofString(),
            )
            assertEquals(200, authHtml.statusCode())
            assertTrue(authHtml.body().contains(""""surface":"editor""""))
            assertTrue(authHtml.body().contains(""""locale":"ru""""))
            assertTrue(authHtml.body().contains(""""mode":"dark""""))
        }
    }

    @Test
    fun `dispatches bridge methods and validates external URLs`() {
        val copied = CopyOnWriteArrayList<String>()
        val opened = CopyOnWriteArrayList<String>()
        newTestServer(copied, opened).use { server ->
            val stateRes = callBridge(server, """{"method":"getState"}""")
            assertTrue(stateRes.has("result"))
            assertTrue(stateRes.get("result").isJsonNull)

            val configRes = callBridge(server, """{"method":"getConfig"}""")
            assertEquals(DEFAULT_GAME_ORIGIN, configRes.getAsJsonObject("result").get("assetsOrigin").asString)

            val clipRes = callBridge(server, """{"method":"copyToClipboard","params":{"text":"ROOM42"}}""")
            assertTrue(clipRes.get("result").asBoolean)
            assertEquals(listOf("ROOM42"), copied)

            callBridge(server, """{"method":"openExternalUrl","params":{"url":"https://crashingagents.com/s/123"}}""")
            callBridge(server, """{"method":"openExternalUrl","params":{"url":"javascript:alert(1)"}}""")
            assertEquals(listOf("https://crashingagents.com/s/123"), opened)
            assertFalse(LoopbackBridgeServer.isAllowedExternalUrl("file:///etc/passwd"))
        }
    }

    @Test
    fun `streams live theme and refresh events over SSE`() {
        newTestServer().use { server ->
            val uri = URI.create("http://127.0.0.1:${server.port}/api/events?token=${server.authToken}")
            val response = http.send(
                HttpRequest.newBuilder(uri).GET().build(),
                HttpResponse.BodyHandlers.ofInputStream(),
            )
            assertEquals(200, response.statusCode())

            BufferedReader(InputStreamReader(response.body(), StandardCharsets.UTF_8)).use { reader ->
                assertEquals("event: connected", reader.readLine())
                assertEquals("data: {}", reader.readLine())
                assertEquals("", reader.readLine())

                server.broadcastRefresh()
                assertEquals("event: refresh", reader.readLine())
                assertEquals("data: {}", reader.readLine())
                assertEquals("", reader.readLine())
            }
        }
    }

    private fun callBridge(server: LoopbackBridgeServer, body: String): JsonObject {
        val res = http.send(
            HttpRequest.newBuilder(URI.create("http://127.0.0.1:${server.port}/api/bridge"))
                .header("Content-Type", "application/json")
                .header("X-Crashing-Token", server.authToken)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        assertEquals(200, res.statusCode())
        return JsonParser.parseString(res.body()).asJsonObject
    }
}
