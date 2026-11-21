package com.crashingagents.jetbrains

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.options.Configurable
import com.intellij.util.messages.Topic
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import java.net.URI
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JTextField

const val DEFAULT_GAME_ORIGIN = "https://crashingagents.com"
const val PREVIEW_GAME_ORIGIN = "http://127.0.0.1:43871"

fun interface CrashingSettingsListener {
    fun settingsChanged()

    companion object {
        val TOPIC: Topic<CrashingSettingsListener> = Topic.create(
            "CrashingAgentsSettingsChanged",
            CrashingSettingsListener::class.java,
        )
    }
}

fun normalizeOrigin(raw: String?): String {
    val trimmed = raw?.trim()?.trimEnd('/') ?: return DEFAULT_GAME_ORIGIN
    if (trimmed.isEmpty()) return DEFAULT_GAME_ORIGIN
    val uri = runCatching { URI(trimmed) }.getOrNull() ?: return DEFAULT_GAME_ORIGIN
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return DEFAULT_GAME_ORIGIN
    if (uri.host.isNullOrBlank()) return DEFAULT_GAME_ORIGIN
    val portPart = if (uri.port != -1) ":${uri.port}" else ""
    return "$scheme://${uri.host}$portPart"
}

@Service(Service.Level.APP)
@State(
    name = "CrashingAgentsSettings",
    storages = [Storage("crashingAgents.xml")],
)
class CrashingSettingsState : PersistentStateComponent<CrashingSettingsState.StateData> {
    data class StateData(
        var origin: String = DEFAULT_GAME_ORIGIN,
        var localPreview: Boolean = false,
    )

    private var stateData = StateData()

    override fun getState(): StateData = stateData

    override fun loadState(state: StateData) {
        stateData = StateData(
            origin = normalizeOrigin(state.origin),
            localPreview = state.localPreview,
        )
    }

    fun effectiveOrigin(): String =
        if (stateData.localPreview) PREVIEW_GAME_ORIGIN else normalizeOrigin(stateData.origin)

    fun update(origin: String, localPreview: Boolean) {
        stateData = StateData(
            origin = normalizeOrigin(origin),
            localPreview = localPreview,
        )
        ApplicationManager.getApplication().messageBus
            .syncPublisher(CrashingSettingsListener.TOPIC)
            .settingsChanged()
    }

    companion object {
        fun getInstance(): CrashingSettingsState =
            ApplicationManager.getApplication().getService(CrashingSettingsState::class.java)
    }
}

class CrashingSettingsConfigurable : Configurable {
    private var panel: JPanel? = null
    private var originField: JTextField? = null
    private var localPreviewCheckbox: JCheckBox? = null

    override fun getDisplayName(): String = "Crashing Agents"

    override fun createComponent(): JComponent {
        val root = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            insets = Insets(6, 6, 6, 6)
            anchor = GridBagConstraints.WEST
            fill = GridBagConstraints.HORIZONTAL
        }

        val originLabel = JLabel("Game server URL:")
        val originInput = JTextField(32)
        val previewBox = JCheckBox("Use local preview server ($PREVIEW_GAME_ORIGIN)")
        val hintLabel = JLabel("<html><small>Default: $DEFAULT_GAME_ORIGIN. Start local preview with <code>pnpm dev:bb</code>.</small></html>")

        previewBox.addActionListener {
            originInput.isEnabled = !previewBox.isSelected
        }

        gbc.gridx = 0
        gbc.gridy = 0
        gbc.weightx = 0.0
        root.add(originLabel, gbc)

        gbc.gridx = 1
        gbc.weightx = 1.0
        root.add(originInput, gbc)

        gbc.gridx = 0
        gbc.gridy = 1
        gbc.gridwidth = 2
        root.add(previewBox, gbc)

        gbc.gridy = 2
        root.add(hintLabel, gbc)

        gbc.gridy = 3
        gbc.weighty = 1.0
        gbc.fill = GridBagConstraints.BOTH
        root.add(JPanel(), gbc)

        panel = root
        originField = originInput
        localPreviewCheckbox = previewBox
        reset()
        return root
    }

    override fun isModified(): Boolean {
        val current = CrashingSettingsState.getInstance().state
        val inputOrigin = normalizeOrigin(originField?.text)
        val preview = localPreviewCheckbox?.isSelected ?: false
        return inputOrigin != current.origin || preview != current.localPreview
    }

    override fun apply() {
        CrashingSettingsState.getInstance().update(
            origin = originField?.text ?: DEFAULT_GAME_ORIGIN,
            localPreview = localPreviewCheckbox?.isSelected ?: false,
        )
    }

    override fun reset() {
        val current = CrashingSettingsState.getInstance().state
        originField?.text = current.origin
        localPreviewCheckbox?.isSelected = current.localPreview
        originField?.isEnabled = !current.localPreview
    }

    override fun disposeUIResources() {
        panel = null
        originField = null
        localPreviewCheckbox = null
    }
}
