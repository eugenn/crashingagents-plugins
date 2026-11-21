package com.crashingagents.jetbrains

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.awt.datatransfer.StringSelection
import java.io.IOException
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

enum class WebviewSurface(val id: String) {
    TOOLWINDOW("toolwindow"),
    EDITOR("editor"),
}

class LoopbackBridgeServer(
    private val controller: CrashingRoomController,
    private val themeProvider: () -> JsonObject,
    private val localeProvider: () -> String = { Locale.getDefault().language.ifBlank { "en" } },
    private val copyToClipboard: (String) -> Boolean = { false },
    private val openExternalUrl: (String) -> Unit = {},
    private val resourceLoader: (String) -> ByteArray? = { path ->
        LoopbackBridgeServer::class.java.getResourceAsStream(path)?.use { it.readBytes() }
    },
) : AutoCloseable {
    private val gson: Gson = GsonBuilder().serializeNulls().create()
    private val token: String = generateToken()
    private val closed = AtomicBoolean(false)
    private val sseClients = CopyOnWriteArrayList<SseClient>()
    private val executor: ExecutorService = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "crashing-agents-loopback").apply { isDaemon = true }
    }
    private val server: HttpServer = HttpServer.create(
        InetSocketAddress(InetAddress.getLoopbackAddress(), 0),
        0,
    ).apply {
        executor = this@LoopbackBridgeServer.executor
        createContext("/") { exchange -> handleStatic(exchange) }
        createContext("/api/bridge") { exchange -> handleBridge(exchange) }
        createContext("/api/events") { exchange -> handleEvents(exchange) }
        start()
    }

    val port: Int
        get() = server.address.port

    val authToken: String
        get() = token

    fun urlFor(surface: WebviewSurface): String {
        val encodedToken = URLEncoder.encode(token, StandardCharsets.UTF_8)
        return "http://127.0.0.1:$port/?token=$encodedToken&surface=${surface.id}"
    }

    fun broadcastTheme(theme: JsonObject = themeProvider()) {
        broadcastSse("theme", gson.toJson(theme))
    }

    fun broadcastRefresh() {
        invalidateStateCache()
        broadcastSse("refresh", "{}")
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        for (client in sseClients) {
            client.close()
        }
        sseClients.clear()
        server.stop(0)
        executor.shutdownNow()
    }

    private fun handleStatic(exchange: HttpExchange) {
        try {
            if (exchange.requestMethod != "GET") {
                sendText(exchange, 405, "text/plain", "Method Not Allowed")
                return
            }
            val path = exchange.requestURI.path
            when (path) {
                "/", "/index.html" -> {
                    val query = parseQuery(exchange.requestURI.rawQuery)
                    if (!validToken(query["token"])) {
                        sendText(exchange, 403, "text/plain", "Forbidden")
                        return
                    }
                    val surface = if (query["surface"] == WebviewSurface.EDITOR.id) {
                        WebviewSurface.EDITOR.id
                    } else {
                        WebviewSurface.TOOLWINDOW.id
                    }
                    val template = resourceLoader("/webview/index.html")
                        ?.toString(StandardCharsets.UTF_8)
                        ?: run {
                            sendText(exchange, 500, "text/plain", "Missing webview/index.html resource")
                            return
                        }
                    val bootstrap = JsonObject().apply {
                        addProperty("token", token)
                        addProperty("surface", surface)
                        addProperty("locale", localeProvider())
                        add("theme", themeProvider())
                    }
                    // Escape '<' so the injected JSON cannot close the <script> tag.
                    val safeBootstrap = gson.toJson(bootstrap).replace("<", "\\u003c")
                    val html = template.replace("/*__BOOTSTRAP_JSON__*/ null", safeBootstrap)
                    sendBytes(exchange, 200, "text/html; charset=utf-8", html.toByteArray(StandardCharsets.UTF_8))
                }
                "/main.js" -> {
                    val bytes = resourceLoader("/webview/main.js")
                    if (bytes == null) {
                        sendText(exchange, 404, "text/plain", "Not Found")
                    } else {
                        sendBytes(exchange, 200, "application/javascript; charset=utf-8", bytes)
                    }
                }
                "/styles.css" -> {
                    val bytes = resourceLoader("/webview/styles.css")
                    if (bytes == null) {
                        sendText(exchange, 404, "text/plain", "Not Found")
                    } else {
                        sendBytes(exchange, 200, "text/css; charset=utf-8", bytes)
                    }
                }
                else -> sendText(exchange, 404, "text/plain", "Not Found")
            }
        } catch (_: Throwable) {
            runCatching { sendText(exchange, 500, "text/plain", "Internal Server Error") }
        }
    }

    @Volatile
    private var cachedStateJson: JsonElement? = null
    @Volatile
    private var cachedStateAtMs: Long = 0L

    private fun invalidateStateCache() {
        cachedStateAtMs = 0L
        cachedStateJson = null
    }

    private fun readCachedState(): JsonElement {
        val now = System.currentTimeMillis()
        val cached = cachedStateJson
        if (cached != null && now - cachedStateAtMs < 600L) {
            return cached
        }
        val fresh = controller.getState() ?: JsonNull.INSTANCE
        cachedStateJson = fresh
        cachedStateAtMs = System.currentTimeMillis()
        return fresh
    }

    private fun handleBridge(exchange: HttpExchange) {
        try {
            if (exchange.requestMethod != "POST") {
                sendJson(exchange, 405, errorJson("Method not allowed."))
                return
            }
            if (!validToken(exchange.requestHeaders.getFirst("X-Crashing-Token"))) {
                sendJson(exchange, 403, errorJson("Unauthorized bridge request."))
                return
            }
            val rawBody = readBoundedBody(exchange, MAX_BRIDGE_BODY_BYTES)
            val request = JsonParser.parseString(rawBody).asJsonObject
            val method = request.get("method")?.takeIf { it.isJsonPrimitive }?.asString
                ?: throw IllegalArgumentException("Missing bridge method.")
            val params = request.get("params")

            val result: JsonElement = when (method) {
                "getConfig" -> controller.getConfig()
                "getState" -> readCachedState()
                "getReadyRooms" -> controller.getReadyRooms()
                "dispatch" -> {
                    val cmd = params?.takeIf { it.isJsonObject }?.asJsonObject
                        ?: throw IllegalArgumentException("Missing dispatch command.")
                    controller.dispatch(cmd)
                    invalidateStateCache()
                    broadcastRefresh()
                    JsonNull.INSTANCE
                }
                "copyToClipboard" -> {
                    val text = params?.takeIf { it.isJsonObject }?.asJsonObject
                        ?.get("text")?.takeIf { it.isJsonPrimitive }?.asString.orEmpty()
                    gson.toJsonTree(copyToClipboard(text))
                }
                "openExternalUrl" -> {
                    val url = params?.takeIf { it.isJsonObject }?.asJsonObject
                        ?.get("url")?.takeIf { it.isJsonPrimitive }?.asString.orEmpty()
                    if (isAllowedExternalUrl(url)) {
                        openExternalUrl(url)
                    }
                    JsonNull.INSTANCE
                }
                else -> throw IllegalArgumentException("Unknown bridge method: $method")
            }

            val response = JsonObject().apply { add("result", result) }
            sendJson(exchange, 200, response)
        } catch (e: Throwable) {
            sendJson(exchange, 400, errorJson(e.message ?: "Bridge call failed."))
        }
    }

    private fun handleEvents(exchange: HttpExchange) {
        if (exchange.requestMethod != "GET") {
            sendText(exchange, 405, "text/plain", "Method Not Allowed")
            return
        }
        val query = parseQuery(exchange.requestURI.rawQuery)
        if (!validToken(query["token"])) {
            sendText(exchange, 403, "text/plain", "Forbidden")
            return
        }
        exchange.responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8")
        exchange.responseHeaders.set("Cache-Control", "no-store")
        exchange.responseHeaders.set("Connection", "keep-alive")
        exchange.sendResponseHeaders(200, 0)

        val client = SseClient(exchange, exchange.responseBody)
        sseClients.add(client)
        try {
            client.send("connected", "{}")
            while (!closed.get() && !client.isClosed()) {
                Thread.sleep(25_000)
                client.heartbeat()
            }
        } catch (_: Throwable) {
            // Client disconnected or server closing.
        } finally {
            sseClients.remove(client)
            client.close()
        }
    }

    private fun broadcastSse(event: String, data: String) {
        for (client in sseClients) {
            if (!client.send(event, data)) {
                sseClients.remove(client)
                client.close()
            }
        }
    }

    private fun validToken(candidate: String?): Boolean {
        if (candidate.isNullOrEmpty()) return false
        return MessageDigest.isEqual(
            candidate.toByteArray(StandardCharsets.UTF_8),
            token.toByteArray(StandardCharsets.UTF_8),
        )
    }

    private fun readBoundedBody(exchange: HttpExchange, maxBytes: Int): String {
        val buffer = ByteArray(maxBytes + 1)
        var total = 0
        exchange.requestBody.use { stream ->
            while (total < buffer.size) {
                val read = stream.read(buffer, total, buffer.size - total)
                if (read == -1) break
                total += read
            }
        }
        if (total > maxBytes) {
            throw IllegalArgumentException("Request body too large.")
        }
        return String(buffer, 0, total, StandardCharsets.UTF_8)
    }

    private fun sendJson(exchange: HttpExchange, status: Int, body: JsonObject) {
        sendBytes(exchange, status, "application/json; charset=utf-8", gson.toJson(body).toByteArray(StandardCharsets.UTF_8))
    }

    private fun sendText(exchange: HttpExchange, status: Int, contentType: String, body: String) {
        sendBytes(exchange, status, "$contentType; charset=utf-8", body.toByteArray(StandardCharsets.UTF_8))
    }

    private fun sendBytes(exchange: HttpExchange, status: Int, contentType: String, bytes: ByteArray) {
        exchange.responseHeaders.set("Content-Type", contentType)
        exchange.responseHeaders.set("Cache-Control", "no-store")
        exchange.responseHeaders.set("X-Content-Type-Options", "nosniff")
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    private fun errorJson(message: String): JsonObject =
        JsonObject().apply { addProperty("error", message) }

    private fun parseQuery(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrBlank()) return emptyMap()
        val map = LinkedHashMap<String, String>()
        for (part in rawQuery.split('&')) {
            val eq = part.indexOf('=')
            if (eq > 0) {
                val key = URLDecoder.decode(part.substring(0, eq), StandardCharsets.UTF_8)
                val value = URLDecoder.decode(part.substring(eq + 1), StandardCharsets.UTF_8)
                map[key] = value
            }
        }
        return map
    }

    private class SseClient(
        private val exchange: HttpExchange,
        private val out: OutputStream,
    ) {
        private val closed = AtomicBoolean(false)

        fun isClosed(): Boolean = closed.get()

        @Synchronized
        fun send(event: String, data: String): Boolean {
            if (closed.get()) return false
            return try {
                val payload = "event: $event\ndata: $data\n\n".toByteArray(StandardCharsets.UTF_8)
                out.write(payload)
                out.flush()
                true
            } catch (_: IOException) {
                close()
                false
            }
        }

        @Synchronized
        fun heartbeat(): Boolean {
            if (closed.get()) return false
            return try {
                out.write(": ping\n\n".toByteArray(StandardCharsets.UTF_8))
                out.flush()
                true
            } catch (_: IOException) {
                close()
                false
            }
        }

        fun close() {
            if (!closed.compareAndSet(false, true)) return
            runCatching { out.close() }
            runCatching { exchange.close() }
        }
    }

    companion object {
        private const val MAX_BRIDGE_BODY_BYTES = 128 * 1024

        fun isAllowedExternalUrl(raw: String): Boolean {
            val uri = runCatching { URI(raw) }.getOrNull() ?: return false
            val scheme = uri.scheme?.lowercase()
            return (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
        }

        private fun generateToken(): String {
            val bytes = ByteArray(24)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}

@Service(Service.Level.PROJECT)
class CrashingProjectServer(private val project: Project) : Disposable {
    private val controller = CrashingRoomController(
        originProvider = { CrashingSettingsState.getInstance().effectiveOrigin() },
        store = CrashingRoomState.getInstance(project),
    )

    val server: LoopbackBridgeServer = LoopbackBridgeServer(
        controller = controller,
        themeProvider = { CrashingThemeProvider.currentThemeJson() },
        copyToClipboard = { text ->
            try {
                CopyPasteManager.getInstance().setContents(StringSelection(text))
                true
            } catch (_: Throwable) {
                false
            }
        },
        openExternalUrl = { url ->
            ApplicationManager.getApplication().invokeLater {
                BrowserUtil.browse(url)
            }
        },
    )

    init {
        val connection = ApplicationManager.getApplication().messageBus.connect(this)
        connection.subscribe(
            LafManagerListener.TOPIC,
            LafManagerListener {
                ApplicationManager.getApplication().invokeLater {
                    server.broadcastTheme()
                }
            },
        )
        connection.subscribe(
            CrashingSettingsListener.TOPIC,
            CrashingSettingsListener {
                server.broadcastRefresh()
            },
        )
    }

    fun urlFor(surface: WebviewSurface): String = server.urlFor(surface)

    fun notifyRefresh() {
        server.broadcastRefresh()
    }

    override fun dispose() {
        server.close()
    }

    companion object {
        fun getInstance(project: Project): CrashingProjectServer =
            project.getService(CrashingProjectServer::class.java)
    }
}
