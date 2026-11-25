import java.io.File
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.4.21"
    id("org.jetbrains.intellij.platform")
}

group = "com.crashingagents"
version = "0.1.2"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        val explicitLocalPath = providers.gradleProperty("localIdePath").orNull
        val defaultMacPyCharm = "/Applications/PyCharm.app"
        val resolvedLocal = when {
            !explicitLocalPath.isNullOrBlank() -> File(explicitLocalPath)
            File(defaultMacPyCharm).exists() -> File(defaultMacPyCharm)
            else -> null
        }

        if (resolvedLocal != null) {
            local(resolvedLocal)
            if (File(resolvedLocal, "Contents/plugins/jcef-plugin").exists() ||
                File(resolvedLocal, "plugins/jcef-plugin").exists()
            ) {
                bundledPlugin("com.intellij.modules.jcef")
                bundledModule("intellij.platform.ui.jcef")
            }
        } else {
            pycharm(providers.gradleProperty("platformVersion").getOrElse("2025.3"))
        }
    }

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.crashingagents.jetbrains"
        name = "Crashing Agents"
        version = project.version.toString()

        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null }
        }
    }

    buildSearchableOptions = false
}

tasks.test {
    useJUnitPlatform()
}
