#[allow(non_snake_case)]
/// Builds the JavaScript prelude exposed to executable tool scripts.
pub fn buildExecutionPreludeSource() -> String {
    r#"
        function __optimuseGetActiveCallRuntime() {
            var root = typeof globalThis !== 'undefined'
                ? globalThis
                : (typeof window !== 'undefined' ? window : this);
            var runtime =
                root &&
                root.__optimuse_call_runtime_ref &&
                typeof root.__optimuse_call_runtime_ref === 'object'
                    ? root.__optimuse_call_runtime_ref
                    : __optimuse_call_runtime;
            return runtime && typeof runtime === 'object' ? runtime : __optimuse_call_runtime;
        }
        function __optimuseInvokeCallRuntime(methodName, argsLike) {
            var runtime = __optimuseGetActiveCallRuntime();
            var method = runtime ? runtime[methodName] : undefined;
            if (typeof method !== 'function') {
                return undefined;
            }
            return method.apply(runtime, Array.prototype.slice.call(argsLike || []));
        }
        function __optimuseInvokeCallRuntimeConsole(methodName, argsLike) {
            var runtime = __optimuseGetActiveCallRuntime();
            var runtimeConsole = runtime && runtime.console ? runtime.console : null;
            var method = runtimeConsole ? runtimeConsole[methodName] : undefined;
            if (typeof method !== 'function') {
                return undefined;
            }
            return method.apply(runtimeConsole, Array.prototype.slice.call(argsLike || []));
        }
        var sendIntermediateResult = function() { return __optimuseInvokeCallRuntime('sendIntermediateResult', arguments); };
        var emit = function() { return __optimuseInvokeCallRuntime('emit', arguments); };
        var delta = function() { return __optimuseInvokeCallRuntime('delta', arguments); };
        var log = function() { return __optimuseInvokeCallRuntime('log', arguments); };
        var update = function() { return __optimuseInvokeCallRuntime('update', arguments); };
        var done = function() { return __optimuseInvokeCallRuntime('done', arguments); };
        var complete = function() { return __optimuseInvokeCallRuntime('complete', arguments); };
        var getEnv = function() { return __optimuseInvokeCallRuntime('getEnv', arguments); };
        var getPluginConfigDir = function() { return __optimuseInvokeCallRuntime('getPluginConfigDir', arguments); };
        var getState = function() { return __optimuseInvokeCallRuntime('getState', arguments); };
        var getLang = function() { return __optimuseInvokeCallRuntime('getLang', arguments); };
        var getCallerName = function() { return __optimuseInvokeCallRuntime('getCallerName', arguments); };
        var getChatId = function() { return __optimuseInvokeCallRuntime('getChatId', arguments); };
        var getCallerCardId = function() { return __optimuseInvokeCallRuntime('getCallerCardId', arguments); };
        var __handleAsync = function() { return __optimuseInvokeCallRuntime('handleAsync', arguments); };
        var console = {
            log: function() { return __optimuseInvokeCallRuntimeConsole('log', arguments); },
            info: function() { return __optimuseInvokeCallRuntimeConsole('info', arguments); },
            warn: function() { return __optimuseInvokeCallRuntimeConsole('warn', arguments); },
            error: function() { return __optimuseInvokeCallRuntimeConsole('error', arguments); }
        };
        var reportDetailedError = function() { return __optimuseInvokeCallRuntime('reportDetailedError', arguments); };
        var ToolPkg = globalThis.ToolPkg;
        var Tools = globalThis.Tools;
        var Java = globalThis.Java;
        var Android = globalThis.Android;
        var PackageManager = globalThis.PackageManager;
        var ContentProvider = globalThis.ContentProvider;
        var SystemManager = globalThis.SystemManager;
        var DeviceController = globalThis.DeviceController;
        var OptimuseComposeDslRuntime = globalThis.OptimuseComposeDslRuntime;
        var CryptoJS = globalThis.CryptoJS;
        var Jimp = globalThis.Jimp;
        var UINode = globalThis.UINode;
        var PluginConfig = globalThis.PluginConfig;
        var RuntimeContext = globalThis.RuntimeContext;
        var withContext = globalThis.withContext;
        var OkHttpClientBuilder = globalThis.OkHttpClientBuilder;
        var OkHttpClient = globalThis.OkHttpClient;
        var RequestBuilder = globalThis.RequestBuilder;
        var OkHttp = globalThis.OkHttp;
        var pako = globalThis.pako;
        var _ = globalThis._;
        var dataUtils = globalThis.dataUtils;
        var toolCall = globalThis.toolCall;
        var getToolCatalog = globalThis.getToolCatalog;
    "#
    .to_string()
}

#[allow(non_snake_case)]
/// Loads the runtime bridge script used by JavaScript execution.
pub fn buildExecutionRuntimeBridgeScript() -> String {
    let script = include_str!("JsExecutionRuntimeBridge.script.js");
    script.to_string()
}
