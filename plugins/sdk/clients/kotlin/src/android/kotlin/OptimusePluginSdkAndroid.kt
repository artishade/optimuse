package optimuse.plugin.sdk

import android.content.Context

/** Owns the process-level Android binding used by the packaged native SDK. */
private object AndroidSdkBinding {
    private var client: OptimusePluginSdkAndroidHost? = null

    /** Registers the Android application context exactly once for the SDK process. */
    @Synchronized
    fun install(context: Context) {
        if (client != null) return
        val created = OptimusePluginSdkAndroidHost(context.applicationContext)
        OptimusePluginSdkHost.installAndroidClient(created)
        client = created
    }
}

/** Connects from an Android application through the empty Activity and Binder service. */
suspend fun OptimusePluginSdkClient.Companion.connect(context: Context): OptimusePluginSdkClient {
    AndroidSdkBinding.install(context)
    return connect()
}
