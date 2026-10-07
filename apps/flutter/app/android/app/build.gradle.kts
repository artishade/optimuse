import java.io.FileInputStream
import java.util.Properties
import javax.inject.Inject
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.FileSystemOperations
import org.gradle.api.provider.ListProperty
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/** Stages ordinary assets and only the runtime ABIs selected for this build. */
abstract class StageOptimuseAndroidAssets : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sourceDirectory: DirectoryProperty

    @get:Input
    abstract val selectedAbis: ListProperty<String>

    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty

    @get:Inject
    abstract val fileSystemOperations: FileSystemOperations

    /** Synchronizes the complete asset output so previous build ABIs cannot remain. */
    @TaskAction
    fun stageAssets() {
        fileSystemOperations.sync {
            from(sourceDirectory) {
                exclude("android-runtime/**")
            }
            selectedAbis.get().forEach { abi ->
                from(sourceDirectory.dir("android-runtime/$abi")) {
                    into("android-runtime/$abi")
                }
            }
            into(outputDirectory)
        }
    }
}

/** Publishes variant-isolated JNI libraries through Android's generated sources API. */
abstract class StageOptimuseAndroidJniLibraries : Sync() {
    @get:OutputDirectory
    abstract val outputDirectory: DirectoryProperty
}

val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")
localProperties.load(FileInputStream(localPropertiesFile))

// Reads a required signing property from local.properties.
fun requiredLocalProperty(name: String): String =
    localProperties.getProperty(name)
        ?: throw GradleException("Missing Android release signing property: $name")

data class OptimuseRustTarget(
    val flutterPlatform: String,
    val abi: String,
    val rustTarget: String,
    val envTarget: String,
)

// Reads Flutter's requested Android target platforms from Gradle properties.
fun requestedFlutterTargetPlatforms(): Set<String> {
    val raw = providers.gradleProperty("target-platform").orNull
        ?: throw GradleException("Missing Flutter target-platform Gradle property")
    return raw.split(',')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .toSet()
}

// Selects only the Rust targets required by Flutter's Android build.
fun selectedOptimuseRustTargets(targets: List<OptimuseRustTarget>): List<OptimuseRustTarget> {
    val requestedPlatforms = requestedFlutterTargetPlatforms()
    val selectedTargets = targets.filter { requestedPlatforms.contains(it.flutterPlatform) }
    val selectedPlatforms = selectedTargets.map { it.flutterPlatform }.toSet()
    val unsupportedPlatforms = requestedPlatforms.subtract(selectedPlatforms)
    if (unsupportedPlatforms.isNotEmpty()) {
        throw GradleException("Unsupported Android Rust target-platform values: $unsupportedPlatforms")
    }
    if (selectedTargets.isEmpty()) {
        throw GradleException("No supported Android Rust targets selected for target-platform=$requestedPlatforms")
    }
    return selectedTargets
}

val optimuseRustTargets = listOf(
    OptimuseRustTarget("android-arm64", "arm64-v8a", "aarch64-linux-android", "AARCH64_LINUX_ANDROID"),
    OptimuseRustTarget("android-x64", "x86_64", "x86_64-linux-android", "X86_64_LINUX_ANDROID"),
    OptimuseRustTarget("android-arm", "armeabi-v7a", "armv7-linux-androideabi", "ARMV7_LINUX_ANDROIDEABI"),
)
val selectedOptimuseRustTargets = selectedOptimuseRustTargets(optimuseRustTargets)

android {
    namespace = "app.optimuse"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    signingConfigs {
        create("release") {
            storeFile = file(requiredLocalProperty("RELEASE_STORE_FILE"))
            storePassword = requiredLocalProperty("RELEASE_STORE_PASSWORD")
            keyAlias = requiredLocalProperty("RELEASE_KEY_ALIAS")
            keyPassword = requiredLocalProperty("RELEASE_KEY_PASSWORD")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "app.optimuse"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    sourceSets.getByName("main").assets.setSrcDirs(emptyList<String>())
    sourceSets.getByName("main").jniLibs.setSrcDirs(emptyList<String>())

    buildTypes {
        configureEach {
            // Flutter owns ABI splits; filter native libraries only for non-split builds.
            if (providers.gradleProperty("split-per-abi").orNull != "true") {
                ndk.abiFilters.clear()
                ndk.abiFilters.addAll(selectedOptimuseRustTargets.map { it.abi })
            }
        }

        release {
            signingConfig = signingConfigs.getByName("release")
            proguardFiles("proguard-rules.pro")
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

}

androidComponents {
    onVariants(selector().all()) { variant ->
        val stagedAssets = tasks.register<StageOptimuseAndroidAssets>(
            "stageOptimuseAndroidAssets" + variant.name.replaceFirstChar { it.uppercase() },
        ) {
            sourceDirectory.set(layout.projectDirectory.dir("src/main/assets"))
            selectedAbis.set(selectedOptimuseRustTargets.map { it.abi })
        }
        val assets = variant.sources.assets
            ?: throw GradleException("Android variant ${variant.name} has no asset sources")
        assets.addGeneratedSourceDirectory(stagedAssets) { it.outputDirectory }
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation("com.google.mlkit:text-recognition:16.0.0")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.0")
    implementation("com.google.mlkit:text-recognition-japanese:16.0.0")
    implementation("com.google.mlkit:text-recognition-korean:16.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
    implementation("com.github.topjohnwu.libsu:core:6.0.0")
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")
}

val optimuseBridgeCrate = project.layout.projectDirectory
    .dir("../../../native/optimuse-flutter-bridge")
    .asFile
val optimuseRepoRoot = project.layout.projectDirectory
    .dir("../../../../..")
    .asFile
val optimusePluginSyncScript = optimuseRepoRoot
    .resolve("plugins/tools/sync_plugin_packages.py")
val optimusePluginSyncPython = if (System.getProperty("os.name").lowercase().contains("windows")) {
    optimuseRepoRoot.resolve(".venv/Scripts/python.exe")
} else {
    optimuseRepoRoot.resolve(".venv/bin/python")
}
val optimuseBridgeJniLibs = project.layout.projectDirectory.dir("src/main/jniLibs").asFile
val optimuseIsWindows = System.getProperty("os.name").lowercase().contains("windows")
val optimuseLibclangDir = when {
    System.getenv("OPTIMUSE_LIBCLANG_DIR") != null ->
        file(System.getenv("OPTIMUSE_LIBCLANG_DIR"))
    optimuseIsWindows ->
        optimuseRepoRoot
            .resolve("target/optimuse-build-tools/libclang.runtime.win-x64.21.1.8/runtimes/win-x64/native")
    else ->
        file("/usr/lib")
}
// Converts a file path into the clang-compatible slash format.
fun File.clangPath(): String = absolutePath.replace('\\', '/')


val syncOptimusePlugins = tasks.register<Exec>("syncOptimusePlugins") {
    workingDir = optimuseRepoRoot
    commandLine(
        optimusePluginSyncPython.absolutePath,
        optimusePluginSyncScript.absolutePath,
        "--source",
        "runtime",
        "--no-hot-reload",
    )
}

androidComponents {
    onVariants(selector().all()) { variant ->
        val variantTaskSuffix = variant.name.replaceFirstChar { it.uppercase() }
        val rustProfile = when (variant.buildType) {
            "debug" -> "debug"
            "profile", "release" -> "release"
            else -> throw GradleException("Unsupported Android Rust build type: ${variant.buildType}")
        }
        val cargoBuildOptimuseFlutterBridgeTasks = selectedOptimuseRustTargets.map { target ->
            val abiTaskSuffix = target.abi.replace("-", "").replace("_", "")
            val bridgeLibrary = optimuseBridgeCrate.resolve(
                "target/${target.rustTarget}/$rustProfile/liboptimuse_flutter_bridge.so",
            )
            tasks.register<Exec>("cargoBuildOptimuseFlutterBridge$variantTaskSuffix$abiTaskSuffix") {
                dependsOn(syncOptimusePlugins)
                val clangPrefix = target.rustTarget
                val apiLevel = 23
                val ndkToolchain = android.ndkDirectory
                    .resolve("toolchains")
                    .resolve("llvm")
                    .resolve("prebuilt")
                    .resolve(if (optimuseIsWindows) "windows-x86_64" else "linux-x86_64")
                    .resolve("bin")
                val linkerPrefix = if (target.rustTarget == "armv7-linux-androideabi") {
                    "armv7a-linux-androideabi"
                } else {
                    clangPrefix
                }
                val linker = ndkToolchain.resolve("${linkerPrefix}${apiLevel}-clang${if (optimuseIsWindows) ".cmd" else ""}")
                val ar = ndkToolchain.resolve(if (optimuseIsWindows) "llvm-ar.exe" else "llvm-ar")
                val clangResourceDir = ndkToolchain
                    .parentFile
                    .resolve("lib")
                    .resolve("clang")
                    .listFiles()
                    ?.single { it.isDirectory }
                    ?: throw GradleException("Android NDK clang resource dir not found")
                val bindgenClangArgs =
                    "--target=${target.rustTarget} --sysroot=${ndkToolchain.parentFile.resolve("sysroot").clangPath()} -resource-dir=${clangResourceDir.clangPath()}"
                val ccEnvTarget = target.rustTarget.replace("-", "_")
                environment("CC_$ccEnvTarget", linker.absolutePath)
                environment("AR_$ccEnvTarget", ar.absolutePath)
                environment("CARGO_TARGET_${target.envTarget}_LINKER", linker.absolutePath)
                environment("CARGO_TARGET_${target.envTarget}_AR", ar.absolutePath)
                environment("LIBCLANG_PATH", optimuseLibclangDir.absolutePath)
                environment("BINDGEN_EXTRA_CLANG_ARGS_$ccEnvTarget", bindgenClangArgs)
                environment("RUSTFLAGS", "-Awarnings")
                val cargoArguments = mutableListOf(
                    "cargo",
                    "build",
                    "--manifest-path",
                    optimuseBridgeCrate.resolve("Cargo.toml").absolutePath,
                    "--target",
                    target.rustTarget,
                )
                if (rustProfile == "release") {
                    cargoArguments.add("--release")
                }
                commandLine(cargoArguments)
                doLast {
                    if (!bridgeLibrary.isFile) {
                        throw GradleException("Missing Android Rust $rustProfile bridge: $bridgeLibrary")
                    }
                }
            }
        }
        val stagedJniLibraries = tasks.register<StageOptimuseAndroidJniLibraries>(
            "stageOptimuseAndroidJniLibraries$variantTaskSuffix",
        ) {
            dependsOn(cargoBuildOptimuseFlutterBridgeTasks)
            selectedOptimuseRustTargets.forEach { target ->
                into(target.abi) {
                    from(optimuseBridgeJniLibs.resolve(target.abi)) {
                        exclude("liboptimuse_flutter_bridge.so")
                    }
                    from(optimuseBridgeCrate.resolve(
                        "target/${target.rustTarget}/$rustProfile/liboptimuse_flutter_bridge.so",
                    ))
                }
            }
            into(outputDirectory)
        }
        val jniLibraries = variant.sources.jniLibs
            ?: throw GradleException("Android variant ${variant.name} has no JNI library sources")
        jniLibraries.addGeneratedSourceDirectory(stagedJniLibraries) { it.outputDirectory }
    }
}

val requiredOptimuseAndroidRuntimeLibraries = listOf(
    "libbash.so",
    "liboptimuse_busybox.so",
    "liboptimuse_loader.so",
    "liboptimuse_proot.so",
)
val requiredOptimuseAndroidRuntimeAssets = listOf(
    "rootfs.tar.gz.bin",
    "rootfs.tar.gz.bin.sha256",
)
val verifyOptimuseAndroidRuntimeArtifacts = tasks.register("verifyOptimuseAndroidRuntimeArtifacts") {
    doLast {
        val missingArtifacts = selectedOptimuseRustTargets.flatMap { target ->
            val libraryDirectory = optimuseBridgeJniLibs.resolve(target.abi)
            val assetDirectory = project.layout.projectDirectory
                .dir("src/main/assets/android-runtime/${target.abi}")
                .asFile
            requiredOptimuseAndroidRuntimeLibraries
                .map { libraryName -> libraryDirectory.resolve(libraryName) }
                .plus(
                    requiredOptimuseAndroidRuntimeAssets.map { assetName ->
                        assetDirectory.resolve(assetName)
                    },
                )
                .filterNot(File::isFile)
        }
        if (missingArtifacts.isNotEmpty()) {
            throw GradleException(
                "Missing required Optimuse Android runtime artifacts:\n" +
                    missingArtifacts.joinToString(separator = "\n") { it.absolutePath },
            )
        }
    }
}

tasks.named("preBuild") {
    dependsOn(syncOptimusePlugins)
    dependsOn(verifyOptimuseAndroidRuntimeArtifacts)
}
