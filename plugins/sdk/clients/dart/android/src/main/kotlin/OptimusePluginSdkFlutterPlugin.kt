package optimuse.plugin.sdk.flutter

import io.flutter.embedding.engine.plugins.FlutterPlugin
import optimuse.plugin.sdk.OptimusePluginSdkHost
import optimuse.plugin.sdk.OptimusePluginSdkAndroidHost

/** Registers the Android Context for the same native SDK library used by Dart FFI. */
class OptimusePluginSdkFlutterPlugin : FlutterPlugin {
    private var client: OptimusePluginSdkAndroidHost? = null

    /** Supplies Android activation to the Rust host before Dart opens a session. */
    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        val created = OptimusePluginSdkAndroidHost(binding.applicationContext)
        OptimusePluginSdkHost.installAndroidClient(created)
        client = created
    }

    /** Releases the process binding when this Flutter engine detaches. */
    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        client?.close()
        client = null
    }
}
