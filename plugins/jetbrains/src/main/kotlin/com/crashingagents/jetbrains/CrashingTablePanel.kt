package com.crashingagents.jetbrains

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.BorderLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JPanel

class CrashingTablePanel(
    private val project: Project,
    private val surface: WebviewSurface,
) : JPanel(BorderLayout()), Disposable {
    private var browser: JBCefBrowser? = null

    init {
        val jcefReady = try {
            JBCefApp.isSupported()
        } catch (_: LinkageError) {
            false
        }
        if (jcefReady) {
            val cefBrowser = JBCefBrowser.createBuilder()
                .setWindowlessFramerate(30)
                .build()
            Disposer.register(this, cefBrowser)
            browser = cefBrowser
            add(cefBrowser.component, BorderLayout.CENTER)
            loadUrl()
        } else {
            add(buildFallbackPanel(), BorderLayout.CENTER)
        }
    }

    fun reload() {
        val cefBrowser = browser ?: return
        cefBrowser.loadURL(CrashingProjectServer.getInstance(project).urlFor(surface))
    }

    private fun loadUrl() {
        val cefBrowser = browser ?: return
        cefBrowser.loadURL(CrashingProjectServer.getInstance(project).urlFor(surface))
    }

    private fun buildFallbackPanel(): JPanel {
        val fallback = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            gridx = 0
            insets = Insets(6, 12, 6, 12)
        }
        gbc.gridy = 0
        fallback.add(
            JLabel("<html><b>Crashing Agents</b> requires JCEF (JetBrains Runtime) to display the table inside the IDE.</html>"),
            gbc,
        )
        gbc.gridy = 1
        val openButton = JButton("Open Crashing Agents in Browser").apply {
            addActionListener {
                BrowserUtil.browse(CrashingSettingsState.getInstance().effectiveOrigin())
            }
        }
        fallback.add(openButton, gbc)
        return fallback
    }

    override fun dispose() {
        browser = null
    }
}
