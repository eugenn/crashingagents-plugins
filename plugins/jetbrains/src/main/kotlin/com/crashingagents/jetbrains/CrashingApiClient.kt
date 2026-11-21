package com.crashingagents.jetbrains

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Collections

class RoomNotFoundException(message: String = "Room not found") : RuntimeException(message)

class CrashingApiClient(
    val origin: String,
    private val endpointPrefix: String = "/api/bb",
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build(),
) {
    private val gson = Gson()
    private val normalizedOrigin = origin.trimEnd('/')
    private val shortPaths = Collections.synchronizedMap(
        object : LinkedHashMap<String, String>(64, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean = size > 100
        },
    )

    fun createRoom(visibility: String = "private", autoStart: Boolean = false): RoomBinding {
        val body = JsonObject().apply {
            addProperty("visibility", visibility)
            if (autoStart) addProperty("autoStart", true)
        }
        val json = postJson("$endpointPrefix/rooms", body).asJsonObject
        return parseBinding(json)
    }

    fun joinPlayer(inviteCode: String, readyOnly: Boolean = false): RoomBinding {
        val body = JsonObject().apply {
            addProperty("inviteCode", inviteCode)
            addProperty("readyOnly", readyOnly)
        }
        val json = postJson("$endpointPrefix/rooms/join", body).asJsonObject
        return parseBinding(json)
    }

    fun readyRooms(): JsonArray {
        val request = HttpRequest.newBuilder()
            .uri(URI.create("$normalizedOrigin/api/ready-rooms"))
            .timeout(Duration.ofSeconds(10))
            .header("Accept", "application/json")
            .GET()
            .build()
        val response = send(request)
        if (response.statusCode() !in 200..299) {
            throw RuntimeException("Cannot load ready rooms (HTTP ${response.statusCode()}).")
        }
        val root = JsonParser.parseString(response.body()).asJsonObject
        return root.getAsJsonArray("rooms") ?: JsonArray()
    }

    fun host(
        room: RoomBinding,
        op: String,
        action: JsonElement? = null,
        shortShare: Boolean = false,
    ): JsonObject {
        val token = room.playerToken?.takeIf { it.isNotBlank() }
            ?: throw RuntimeException("Only the room creator can do that.")
        val encodedCode = URLEncoder.encode(room.code, StandardCharsets.UTF_8)
        val body = JsonObject().apply {
            addProperty("op", op)
            if (action != null && !action.isJsonNull) {
                add("action", action)
            }
            if (shortShare) {
                addProperty("shortShare", true)
            }
        }
        return postJson("$endpointPrefix/rooms/$encodedCode", body, token).asJsonObject
    }

    fun agent(token: String, name: String, args: JsonObject = JsonObject()): JsonObject {
        val params = JsonObject().apply {
            addProperty("name", name)
            add("arguments", args)
        }
        val body = JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", 1)
            addProperty("method", "tools/call")
            add("params", params)
        }
        val reply = postJson("/mcp", body, token).asJsonObject
        if (reply.has("error") && !reply.get("error").isJsonNull) {
            throw RuntimeException("Game service rejected the call.")
        }
        val result = reply.getAsJsonObject("result")
            ?: throw RuntimeException("Game service rejected the call.")
        val content = result.getAsJsonArray("content")
        val text = content?.takeIf { it.size() > 0 }?.get(0)?.asJsonObject?.get("text")?.asString
            ?: throw RuntimeException("Game service rejected the call.")
        val value = JsonParser.parseString(text).asJsonObject
        if (result.get("isError")?.asBoolean == true) {
            val err = value.get("error")?.takeIf { !it.isJsonNull }?.asString ?: "Game action rejected."
            throw RuntimeException(err)
        }
        return value
    }

    fun shortSharePath(path: String): String {
        val match = SHARE_TOKEN_REGEX.matchEntire(path) ?: return path
        shortPaths[path]?.let { return it }
        return try {
            val body = JsonObject().apply { addProperty("token", match.groupValues[1]) }
            val result = postJson("/api/share/short", body).asJsonObject
            val shortPath = result.get("path")?.takeIf { it.isJsonPrimitive }?.asString
            if (shortPath != null && SHORT_SHARE_REGEX.matches(shortPath)) {
                shortPaths[path] = shortPath
                shortPath
            } else {
                path
            }
        } catch (_: Throwable) {
            path
        }
    }

    private fun postJson(path: String, body: JsonObject, bearerToken: String? = null): JsonElement {
        val builder = HttpRequest.newBuilder()
            .uri(URI.create("$normalizedOrigin$path"))
            .timeout(Duration.ofSeconds(35))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .POST(HttpRequest.BodyPublishers.ofString(gson.toJson(body), StandardCharsets.UTF_8))
        if (!bearerToken.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $bearerToken")
        }
        val response = send(builder.build())
        if (response.statusCode() !in 200..299) {
            val failureError = runCatching {
                JsonParser.parseString(response.body()).asJsonObject
                    .get("error")?.takeIf { it.isJsonPrimitive }?.asString
            }.getOrNull()
            if (response.statusCode() == 404 && failureError == "Room not found") {
                throw RoomNotFoundException(failureError)
            }
            throw RuntimeException(failureError ?: "Game service returned HTTP ${response.statusCode()}")
        }
        return JsonParser.parseString(response.body())
    }

    private fun send(request: HttpRequest): HttpResponse<String> {
        return try {
            httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        } catch (e: IOException) {
            if (normalizedOrigin == PREVIEW_GAME_ORIGIN) {
                throw RuntimeException(
                    "Cannot reach the local game server. Run pnpm dev:bb in the Crashing Agents repository.",
                    e,
                )
            }
            throw RuntimeException(e.message ?: "Network error contacting game server.", e)
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw RuntimeException("Request interrupted.", e)
        }
    }

    private fun parseBinding(json: JsonObject): RoomBinding = RoomBinding(
        code = json.get("code")?.takeIf { !it.isJsonNull }?.asString.orEmpty(),
        playerToken = json.get("playerToken")?.takeIf { !it.isJsonNull }?.asString,
        agentToken = json.get("agentToken")?.takeIf { !it.isJsonNull }?.asString,
        inviteCode = json.get("inviteCode")?.takeIf { !it.isJsonNull }?.asString,
    )

    companion object {
        private val SHARE_TOKEN_REGEX = Regex("^/share/([A-Za-z0-9_-]+)$")
        private val SHORT_SHARE_REGEX = Regex("^/s/[A-Za-z0-9_-]{16}$")
    }
}
