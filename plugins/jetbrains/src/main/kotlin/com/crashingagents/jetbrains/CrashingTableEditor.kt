package com.crashingagents.jetbrains

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile
import java.beans.PropertyChangeListener
import javax.swing.Icon
import javax.swing.JComponent

object CrashingTableFileType : FileType {
    override fun getName(): String = "CrashingAgentsTable"
    override fun getDescription(): String = "Crashing Agents Game Table"
    override fun getDefaultExtension(): String = "crashing-table"
    override fun getIcon(): Icon = CrashingIcons.ToolWindow
    override fun isBinary(): Boolean = true
    override fun isReadOnly(): Boolean = true
}

class CrashingTableVirtualFile : LightVirtualFile("Crashing Agents", CrashingTableFileType, "") {
    init {
        isWritable = false
    }

    override fun equals(other: Any?): Boolean = other is CrashingTableVirtualFile

    override fun hashCode(): Int = CrashingTableVirtualFile::class.java.hashCode()
}

class CrashingTableFileEditor(
    project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor {
    private val panel = CrashingTablePanel(project, WebviewSurface.EDITOR)

    init {
        Disposer.register(this, panel)
    }

    override fun getComponent(): JComponent = panel

    override fun getPreferredFocusedComponent(): JComponent = panel

    override fun getName(): String = "Crashing Agents"

    override fun getFile(): VirtualFile = file

    override fun setState(state: FileEditorState) = Unit

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = true

    override fun addPropertyChangeListener(listener: PropertyChangeListener) = Unit

    override fun removePropertyChangeListener(listener: PropertyChangeListener) = Unit

    override fun dispose() = Unit
}

class CrashingTableFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is CrashingTableVirtualFile

    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        CrashingTableFileEditor(project, file)

    override fun getEditorTypeId(): String = "crashing-agents-table-editor"

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}

fun openCrashingTableInEditor(project: Project) {
    val manager = FileEditorManager.getInstance(project)
    val existing = manager.openFiles.firstOrNull { it is CrashingTableVirtualFile }
    val target = existing ?: CrashingTableVirtualFile()
    manager.openFile(target)
}
