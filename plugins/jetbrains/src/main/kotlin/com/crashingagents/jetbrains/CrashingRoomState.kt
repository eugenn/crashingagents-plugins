package com.crashingagents.jetbrains

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.StoragePathMacros
import com.intellij.openapi.project.Project

data class RoomBinding(
    var code: String = "",
    var playerToken: String? = null,
    var agentToken: String? = null,
    var inviteCode: String? = null,
    var autoStart: Boolean = false,
    var prompts: MutableMap<String, String> = mutableMapOf(),
) {
    fun deepCopy(): RoomBinding = RoomBinding(
        code = code,
        playerToken = playerToken,
        agentToken = agentToken,
        inviteCode = inviteCode,
        autoStart = autoStart,
        prompts = LinkedHashMap(prompts),
    )
}

interface RoomBindingStore {
    fun get(origin: String): RoomBinding?
    fun set(origin: String, binding: RoomBinding)
    fun delete(origin: String, expected: RoomBinding? = null)
}

@Service(Service.Level.PROJECT)
@State(
    name = "CrashingAgentsRoomState",
    storages = [Storage(StoragePathMacros.WORKSPACE_FILE)],
)
class CrashingRoomState : PersistentStateComponent<CrashingRoomState.StateData>, RoomBindingStore {
    data class StateData(
        var bindingsByOrigin: MutableMap<String, RoomBinding> = mutableMapOf(),
    )

    private var stateData = StateData()

    @Synchronized
    override fun getState(): StateData = stateData

    @Synchronized
    override fun loadState(state: StateData) {
        val copy = mutableMapOf<String, RoomBinding>()
        for ((k, v) in state.bindingsByOrigin) {
            if (v.code.isNotBlank()) {
                copy[k] = v.deepCopy()
            }
        }
        stateData = StateData(copy)
    }

    @Synchronized
    override fun get(origin: String): RoomBinding? =
        stateData.bindingsByOrigin[origin]?.deepCopy()

    @Synchronized
    override fun set(origin: String, binding: RoomBinding) {
        stateData.bindingsByOrigin[origin] = binding.deepCopy()
    }

    @Synchronized
    override fun delete(origin: String, expected: RoomBinding?) {
        if (expected != null) {
            val current = stateData.bindingsByOrigin[origin]
            if (current != expected) return
        }
        stateData.bindingsByOrigin.remove(origin)
    }

    companion object {
        fun getInstance(project: Project): CrashingRoomState =
            project.getService(CrashingRoomState::class.java)
    }
}
