package com.crashingagents.jetbrains

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class CrashingToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = CrashingTablePanel(project, WebviewSurface.TOOLWINDOW)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        content.setDisposer(panel)
        Disposer.register(content, panel)
        toolWindow.contentManager.addContent(content)

        val reloadAction = object : AnAction(
            "Reload Table",
            "Reload the Crashing Agents game table",
            AllIcons.Actions.Refresh,
        ), DumbAware {
            override fun actionPerformed(e: AnActionEvent) {
                panel.reload()
            }

            override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT
        }

        val openEditorAction = object : AnAction(
            "Open Full Table in Editor",
            "Open the wide Crashing Agents game table in an editor tab",
            AllIcons.Actions.MoveToWindow,
        ), DumbAware {
            override fun actionPerformed(e: AnActionEvent) {
                openCrashingTableInEditor(project)
            }

            override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT
        }

        val settingsAction = object : AnAction(
            "Settings",
            "Configure Crashing Agents server URL and local preview",
            AllIcons.General.Settings,
        ), DumbAware {
            override fun actionPerformed(e: AnActionEvent) {
                openCrashingSettings(project)
            }

            override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT
        }

        toolWindow.setTitleActions(listOf(openEditorAction, reloadAction, settingsAction))
    }

    companion object {
        const val TOOL_WINDOW_ID = "Crashing Agents"
    }
}
