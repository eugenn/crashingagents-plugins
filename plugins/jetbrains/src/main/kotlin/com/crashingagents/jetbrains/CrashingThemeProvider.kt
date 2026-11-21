package com.crashingagents.jetbrains

import com.google.gson.JsonObject
import com.intellij.ui.JBColor
import com.intellij.util.ui.UIUtil
import java.awt.Color
import javax.swing.UIManager

object CrashingThemeProvider {
    fun currentThemeJson(): JsonObject {
        val dark = !JBColor.isBright()
        val bg = UIUtil.getPanelBackground()
        val fg = JBColor.foreground()
        val muted = UIUtil.getContextHelpForeground()
        val border = JBColor.border()
        val raised = UIManager.getColor("EditorPane.background")
            ?: if (dark) shift(bg, 10) else Color.WHITE
        val recessed = UIUtil.getTextFieldBackground()
            ?: if (dark) shift(bg, -8) else shift(bg, -8)
        val seam = if (dark) shift(bg, 18) else shift(bg, -18)
        val hover = if (dark) "rgba(255, 255, 255, 0.08)" else "rgba(0, 0, 0, 0.05)"
        val primary = UIManager.getColor("Button.default.startBackground")
            ?: if (dark) Color(0x35, 0x74, 0xF0) else Color(0x35, 0x74, 0xF0)
        val primaryFg = UIManager.getColor("Button.default.foreground") ?: Color.WHITE
        val danger = UIManager.getColor("Label.errorForeground")
            ?: if (dark) Color(0xF7, 0x54, 0x64) else Color(0xDB, 0x3B, 0x4B)
        val ok = if (dark) Color(0x57, 0x96, 0x5C) else Color(0x20, 0x8A, 0x3C)
        val signal = if (dark) Color(0xF2, 0xC5, 0x5C) else Color(0xC2, 0x7D, 0x04)
        val font = UIUtil.getLabelFont()?.family?.takeIf { it.isNotBlank() }

        val tokens = JsonObject().apply {
            addProperty("--jb-bg", toHex(bg))
            addProperty("--jb-fg", toHex(fg))
            addProperty("--jb-muted", toHex(muted))
            addProperty("--jb-subtle", toHex(muted))
            addProperty("--jb-border", toHex(border))
            addProperty("--jb-seam", toHex(seam))
            addProperty("--jb-raised", toHex(raised))
            addProperty("--jb-recessed", toHex(recessed))
            addProperty("--jb-hover", hover)
            addProperty("--jb-primary", toHex(primary))
            addProperty("--jb-primary-fg", toHex(primaryFg))
            addProperty("--jb-danger", toHex(danger))
            addProperty("--jb-ok", toHex(ok))
            addProperty("--jb-signal", toHex(signal))
            if (font != null) {
                addProperty("--jb-font", "\"$font\", Inter, -apple-system, BlinkMacSystemFont, sans-serif")
            }
        }

        return JsonObject().apply {
            addProperty("mode", if (dark) "dark" else "light")
            add("tokens", tokens)
        }
    }

    private fun toHex(color: Color): String =
        String.format("#%02x%02x%02x", color.red, color.green, color.blue)

    private fun shift(color: Color, delta: Int): Color = Color(
        (color.red + delta).coerceIn(0, 255),
        (color.green + delta).coerceIn(0, 255),
        (color.blue + delta).coerceIn(0, 255),
    )
}
