use crate::javascript::JsAssetLoader::{
    loadAndroidUtilsJs, loadOkHttp3Js, loadPluginConfigJs, loadRuntimeContextJs, loadUINodeJs,
};
use crate::javascript::JsEmbeddedLibraryLoader::{loadCryptoJs, loadJimpJs, loadPakoJs};
use crate::javascript::JsInitRuntimeScriptBuilder;
use crate::javascript::JsJavaBridge::buildJavaClassBridgeDefinition;
use optimuse_plugin_sdk::toolpkg::ToolPkgApiRuntimeScript::buildToolPkgApiRuntimeScript;
use optimuse_plugin_sdk::toolpkg::ToolPkgComposeDslBridge::buildComposeDslContextBridgeDefinition;
use optimuse_plugin_sdk::toolpkg::ToolPkgRegistrationBridge::buildToolPkgRegistrationBridgeScript;
use optimuse_plugin_sdk::JsExecutionScriptBuilder;
use optimuse_plugin_sdk::JsTools::getJsToolsDefinition;
use optimuse_util::RuntimeStorageLayout::{RUNTIME_CLEAN_ON_EXIT_DIR_PATH, RUNTIME_ROOT_PATH_PREFIX};

/// JavaScript bootstrap module loaded into the QuickJS runtime.
pub struct JsBootstrapModule {
    pub fileName: String,
    pub source: String,
    pub globals: Vec<String>,
}

impl JsBootstrapModule {
    /// Creates a bootstrap module descriptor with its expected global exports.
    pub fn new(fileName: &str, source: String, globals: &[&str]) -> Self {
        Self {
            fileName: fileName.to_string(),
            source,
            globals: globals.iter().map(|global| global.to_string()).collect(),
        }
    }
}

#[allow(non_snake_case)]
/// Builds the ordered bootstrap module list required by the JavaScript runtime.
pub fn buildRuntimeBootstrapModules() -> Vec<JsBootstrapModule> {
    vec![
        JsBootstrapModule::new(
            "quickjs/init/runtime.js",
            JsInitRuntimeScriptBuilder::buildRuntimeBootstrapScript(),
            &[],
        ),
        JsBootstrapModule::new(
            "quickjs/init/optimuse-paths.js",
            buildOptimusePathsBootstrapScript(),
            &["OPTIMUSE_CLEAN_ON_EXIT_DIR"],
        ),
        JsBootstrapModule::new(
            "quickjs/init/execution-runtime.js",
            JsExecutionScriptBuilder::buildExecutionRuntimeBridgeScript(),
            &[],
        ),
        JsBootstrapModule::new(
            "quickjs/init/toolpkg-api-runtime.js",
            buildToolPkgApiRuntimeScript(),
            &["__optimuseToolPkgApi"],
        ),
        JsBootstrapModule::new(
            "quickjs/init/toolpkg-bridge.js",
            buildToolPkgRegistrationBridgeScript(false),
            &["ToolPkg"],
        ),
        JsBootstrapModule::new(
            "quickjs/init/tools.js",
            getJsToolsDefinition().to_string(),
            &["Tools"],
        ),
        JsBootstrapModule::new(
            "assets/js/PluginConfig.js",
            loadPluginConfigJs(),
            &["PluginConfig"],
        ),
        JsBootstrapModule::new(
            "assets/js/RuntimeContext.js",
            loadRuntimeContextJs(),
            &["RuntimeContext", "withContext"],
        ),
        JsBootstrapModule::new(
            "quickjs/init/compose-dsl-bridge.js",
            buildComposeDslContextBridgeDefinition(),
            &["OptimuseComposeDslRuntime"],
        ),
        JsBootstrapModule::new(
            "quickjs/init/java-bridge.js",
            buildJavaClassBridgeDefinition(),
            &["Java", "Kotlin"],
        ),
        JsBootstrapModule::new(
            "quickjs/init/third-party-libs.js",
            getJsThirdPartyLibraries(),
            &["_", "dataUtils", "Icons"],
        ),
        JsBootstrapModule::new("assets/js/CryptoJS.js", loadCryptoJs(), &["CryptoJS"]),
        JsBootstrapModule::new("assets/js/Jimp.js", loadJimpJs(), &["Jimp"]),
        JsBootstrapModule::new("assets/js/UINode.js", loadUINodeJs(), &["UINode"]),
        JsBootstrapModule::new(
            "assets/js/AndroidUtils.js",
            loadAndroidUtilsJs(),
            &[
                "Android",
                "PackageManager",
                "ContentProvider",
                "SystemManager",
                "DeviceController",
            ],
        ),
        JsBootstrapModule::new(
            "assets/js/OkHttp3.js",
            loadOkHttp3Js(),
            &[
                "OkHttpClientBuilder",
                "OkHttpClient",
                "RequestBuilder",
                "OkHttp",
            ],
        ),
        JsBootstrapModule::new("assets/js/pako.js", loadPakoJs(), &["pako"]),
    ]
}

#[allow(non_snake_case)]
fn buildOptimusePathsBootstrapScript() -> String {
    let cleanOnExitDirJson = serde_json::to_string(&cleanOnExitVfsPath())
        .expect("clean-on-exit VFS path must serialize");
    format!(
        r#"
        var OPTIMUSE_CLEAN_ON_EXIT_DIR = {};
        if (typeof __optimuseExpose === 'function') {{
            __optimuseExpose('OPTIMUSE_CLEAN_ON_EXIT_DIR', OPTIMUSE_CLEAN_ON_EXIT_DIR);
        }}
        "#,
        cleanOnExitDirJson
    )
}

/// Returns the public VFS path consumed by Tools.Files, not a host physical path.
/// The file-tool mapper resolves it against the active identity's runtime root.
#[allow(non_snake_case)]
fn cleanOnExitVfsPath() -> String {
    let relativePath = RUNTIME_CLEAN_ON_EXIT_DIR_PATH
        .strip_prefix(RUNTIME_ROOT_PATH_PREFIX)
        .expect("clean-on-exit path must be rooted under runtime");
    format!("/app/data/{relativePath}")
}

#[allow(non_snake_case)]
/// Returns the inline third-party utility libraries exposed to tool scripts.
pub fn getJsThirdPartyLibraries() -> String {
    r#"
        var _ = {
            isEmpty: function(value) {
                return value == null ||
                    (Array.isArray(value) && value.length === 0) ||
                    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
            },
            isString: function(value) { return typeof value === 'string'; },
            isNumber: function(value) { return typeof value === 'number' && !isNaN(value); },
            isBoolean: function(value) { return typeof value === 'boolean'; },
            isObject: function(value) { return value != null && typeof value === 'object' && !Array.isArray(value); },
            isArray: function(value) { return Array.isArray(value); },
            forEach: function(collection, iteratee) {
                if (Array.isArray(collection)) {
                    for (var index = 0; index < collection.length; index += 1) {
                        iteratee(collection[index], index, collection);
                    }
                    return collection;
                }
                if (collection && typeof collection === 'object') {
                    var keys = Object.keys(collection);
                    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
                        var key = keys[keyIndex];
                        iteratee(collection[key], key, collection);
                    }
                }
                return collection;
            },
            map: function(collection, iteratee) {
                var output = [];
                _.forEach(collection, function(item, key, source) {
                    output.push(iteratee(item, key, source));
                });
                return output;
            }
        };

        var dataUtils = {
            parseJson: function(text) {
                try { return JSON.parse(text); } catch (_error) { return null; }
            },
            stringifyJson: function(value) {
                try { return JSON.stringify(value); } catch (_error) { return '{}'; }
            },
            formatDate: function(value) {
                var date = value ? new Date(value) : new Date();
                function pad(part) { return String(part).padStart(2, '0'); }
                return [
                    date.getFullYear(),
                    pad(date.getMonth() + 1),
                    pad(date.getDate())
                ].join('-') + ' ' + [
                    pad(date.getHours()),
                    pad(date.getMinutes()),
                    pad(date.getSeconds())
                ].join(':');
            }
        };

        var Icons =
            typeof Proxy === 'function'
                ? new Proxy({}, {
                    get: function(_target, key) {
                        if (typeof key !== 'string') {
                            return '';
                        }
                        return key;
                    }
                })
                : {};
    "#
    .to_string()
}

#[allow(non_snake_case)]
/// Builds the monolithic bootstrap script used by legacy JavaScript initialization.
pub fn buildRuntimeBootstrapScript() -> String {
    let executionPreludeJson =
        serde_json::to_string(&JsExecutionScriptBuilder::buildExecutionPreludeSource())
            .unwrap_or_else(|_| "\"\"".to_string());
    let cleanOnExitDirJson = serde_json::to_string(&cleanOnExitVfsPath())
        .expect("clean-on-exit VFS path must serialize");
    format!(
        r#"
        {}
        var globalThis = this;
        var window = globalThis;
        var OPTIMUSE_CLEAN_ON_EXIT_DIR = {};
        var __optimuseRuntimePrelude = {};
        {}
        var console = {{
            log: function() {{ NativeInterface.logInfoForCall('', Array.prototype.slice.call(arguments).join(' ')); }},
            info: function() {{ NativeInterface.logInfoForCall('', Array.prototype.slice.call(arguments).join(' ')); }},
            warn: function() {{ NativeInterface.logWarningForCall('', Array.prototype.slice.call(arguments).join(' ')); }},
            error: function() {{ NativeInterface.logErrorForCall('', Array.prototype.slice.call(arguments).join(' ')); }}
        }};
        var intervalStates = {{}};
        var NativeInterface = {{
            callTool: function(toolType, toolName, paramsJson) {{
                return new Promise(function(resolve) {{
                    var callbackId = '__optimuse_tool_' + Date.now() + '_' + Math.random().toString(36).slice(2);
                    window[callbackId] = function(result) {{
                        delete window[callbackId];
                        resolve(result);
                    }};
                    NativeInterface.callToolAsync(callbackId, toolType, toolName, paramsJson);
                }});
            }},
            callToolAsync: function(callbackId, toolType, toolName, paramsJson) {{
                __optimuseNativeCallToolAsync(
                    String(callbackId || ''),
                    String(toolType || 'default'),
                    String(toolName || ''),
                    String(paramsJson || '{{}}')
                );
            }},
            callToolAsyncStreaming: function(callbackId, intermediateCallbackId, toolType, toolName, paramsJson) {{
                this.callToolAsync(callbackId, toolType, toolName, paramsJson);
            }},
            setTimeout: function(handler, delayMs) {{
                if (typeof handler !== 'function') {{
                    throw new TypeError('setTimeout handler must be a function');
                }}
                var timerId = '__optimuse_timer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
                var timerArguments = Array.prototype.slice.call(arguments, 2);
                var timerCallId = String(globalThis.__optimuseCurrentCallId || '');
                window[timerId] = function() {{
                    try {{
                        delete window[timerId];
                    }} catch (_deleteTimerError) {{
                        window[timerId] = undefined;
                    }}
                    if (typeof __optimuseActivateCall === 'function') {{
                        __optimuseActivateCall(timerCallId);
                    }}
                    try {{
                        handler.apply(window, timerArguments);
                    }} catch (error) {{
                        var activeRuntime = globalThis.__optimuse_call_runtime_ref;
                        if (
                            activeRuntime &&
                            activeRuntime.callId === timerCallId &&
                            typeof activeRuntime.fail === 'function'
                        ) {{
                            activeRuntime.fail(error);
                        }}
                    }} finally {{
                        Promise.resolve().then(function() {{
                            if (typeof __optimuseUnregisterCallTimer === 'function') {{
                                __optimuseUnregisterCallTimer(timerCallId, timerId);
                            }}
                        }});
                    }}
                }};
                window[timerId].__optimuseTimerCallId = timerCallId;
                var normalizedDelay = Number(delayMs);
                if (!isFinite(normalizedDelay) || normalizedDelay < 0) {{
                    throw new RangeError('setTimeout delay must be a finite non-negative number');
                }}
                if (typeof __optimuseRegisterCallTimer === 'function') {{
                    __optimuseRegisterCallTimer(timerCallId, timerId);
                }}
                try {{
                    __optimuseNativeScheduleJavaScriptTimer(timerId, String(Math.floor(normalizedDelay)));
                }} catch (error) {{
                    delete window[timerId];
                    if (typeof __optimuseUnregisterCallTimer === 'function') {{
                        __optimuseUnregisterCallTimer(timerCallId, timerId);
                    }}
                    throw error;
                }}
                return timerId;
            }},
            clearTimeout: function(timerId) {{
                var normalizedTimerId = String(timerId || '');
                if (normalizedTimerId) {{
                    var timerCallback = window[normalizedTimerId];
                    var timerCallId;
                    if (timerCallback && typeof timerCallback.__optimuseTimerCallId === 'string') {{
                        timerCallId = timerCallback.__optimuseTimerCallId;
                    }}
                    try {{
                        delete window[normalizedTimerId];
                    }} catch (_deleteTimerError) {{
                        window[normalizedTimerId] = undefined;
                    }}
                    if (timerCallId && typeof __optimuseUnregisterCallTimer === 'function') {{
                        __optimuseUnregisterCallTimer(timerCallId, normalizedTimerId);
                    }}
                }}
            }},
            setInterval: function(handler, delayMs) {{
                if (typeof handler !== 'function') {{
                    throw new TypeError('setInterval handler must be a function');
                }}
                var intervalId = '__optimuse_interval_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
                var timerArguments = Array.prototype.slice.call(arguments, 2);
                var state = {{ active: true, timerId: null }};
                intervalStates[intervalId] = state;
                var scheduleNext = function() {{
                    if (!state.active) return;
                    state.timerId = NativeInterface.setTimeout(function() {{
                        if (!state.active) return;
                        try {{
                            handler.apply(window, timerArguments);
                        }} finally {{
                            scheduleNext();
                        }}
                    }}, delayMs);
                }};
                scheduleNext();
                return intervalId;
            }},
            clearInterval: function(intervalId) {{
                var normalizedIntervalId = String(intervalId || '');
                var state = intervalStates[normalizedIntervalId];
                if (!state) return;
                state.active = false;
                if (state.timerId) NativeInterface.clearTimeout(state.timerId);
                delete intervalStates[normalizedIntervalId];
            }},
            /// Forwards plugin informational output to the shared application logger.
            logInfoForCall: function(callId, message) {{
                __optimuseNativeLog('info', String(callId || ''), String(message));
            }},
            /// Preserves warning severity for plugin console output.
            logWarningForCall: function(callId, message) {{
                __optimuseNativeLog('warn', String(callId || ''), String(message));
            }},
            /// Forwards plugin failures without suppressing their messages.
            logErrorForCall: function(callId, message) {{
                __optimuseNativeLog('error', String(callId || ''), String(message));
            }},
            reportErrorForCall: function() {{}},
            sendCallIntermediateResult: function(callId, result) {{
                __optimuseSendIntermediateResult(
                    String(callId || ''),
                    String(result == null ? '' : result)
                );
            }},
            readToolPkgTextResource: function(packageNameOrSubpackageId, resourcePath) {{
                return __optimuseNativeReadToolPkgTextResource(
                    String(packageNameOrSubpackageId || ''),
                    String(resourcePath || '')
                );
            }},
            readToolPkgResource: function(packageNameOrSubpackageId, resourceKey, outputFileName, internal) {{
                return __optimuseNativeReadToolPkgResource(
                    String(packageNameOrSubpackageId || ''),
                    String(resourceKey || ''),
                    outputFileName == null ? '' : String(outputFileName),
                    String(internal || '')
                );
            }},
            callToolPkgWasm: function(packageTarget, moduleId, exportName, argsJson) {{
                return __optimuseNativeCallToolPkgWasm(
                    String(packageTarget || ''),
                    String(moduleId || ''),
                    String(exportName || ''),
                    String(argsJson || '[]')
                );
            }},
            composeWebViewControllerCommand: function(payloadJson) {{
                return __optimuseNativeComposeWebViewControllerCommand(String(payloadJson || '{{}}'));
            }},
            composeFilePickerCommand: function(payloadJson) {{
                return __optimuseNativeComposeFilePickerCommand(String(payloadJson || '{{}}'));
            }},
            composeWebViewControllerCommandSuspend: function(payloadJson, callbackId) {{
                var normalizedCallbackId = String(callbackId || '').trim();
                if (!normalizedCallbackId) {{
                    return;
                }}
                try {{
                    var result = __optimuseNativeComposeWebViewControllerCommand(
                        String(payloadJson || '{{}}')
                    );
                    var parsed;
                    try {{
                        parsed = JSON.parse(result);
                    }} catch (_parseError) {{
                        parsed = result;
                    }}
                    if (typeof window[normalizedCallbackId] === 'function') {{
                        window[normalizedCallbackId](parsed, false);
                    }}
                }} catch (error) {{
                    if (typeof window[normalizedCallbackId] === 'function') {{
                        window[normalizedCallbackId]({{
                            success: false,
                            message: String(error && error.message ? error.message : error)
                        }}, true);
                    }}
                }}
            }},
            getEnvForCall: function(callId, key) {{
                return __optimuseNativeGetEnvForCall(String(callId || ''), String(key || ''));
            }},
            setEnv: function(key, value) {{
                return __optimuseNativeSetEnv(String(globalThis.__optimuseCurrentCallId || ''), String(key || ''), value == null ? '' : String(value));
            }},
            setEnvs: function(valuesJson) {{
                return __optimuseNativeSetEnvs(String(globalThis.__optimuseCurrentCallId || ''), String(valuesJson || '{{}}'));
            }},
            getPluginConfigDir: function(pluginId) {{
                return __optimuseNativeGetPluginConfigDir(String(pluginId || ''));
            }},
            // Decodes the host result and never exposes an error payload as a directory.
            getScopedPluginConfigDir: function(ownerId, pluginId) {{
                var result = JSON.parse(__optimuseNativeGetScopedPluginConfigDir(String(ownerId), String(pluginId)));
                if (result.success !== true) {{
                    throw new Error(result.message);
                }}
                if (typeof result.path !== 'string' || !result.path.startsWith('/')) {{
                    throw new Error('Plugin configuration directory must be an absolute VFS path');
                }}
                return result.path;
            }},
            isPackageImported: function(packageName) {{
                return __optimuseNativeIsPackageImported(String(packageName || '')) === 'true';
            }},
            importPackage: function(packageName) {{
                return __optimuseNativeImportPackage(String(packageName || ''));
            }},
            removePackage: function(packageName) {{
                return __optimuseNativeRemovePackage(String(packageName || ''));
            }},
            usePackage: function(packageName) {{
                return __optimuseNativeUsePackage(String(packageName || ''));
            }},
            listImportedPackagesJson: function() {{
                return __optimuseNativeListImportedPackagesJson();
            }},
            /** Returns host-owned executable tool schemas as JSON. */
            getToolCatalogJson: function() {{
                return __optimuseNativeGetToolCatalogJson();
            }},
            resolveToolName: function(packageName, subpackageId, toolName, preferImported) {{
                return __optimuseNativeResolveToolName(
                    String(packageName || ''),
                    String(subpackageId || ''),
                    String(toolName || ''),
                    String(preferImported || '')
                );
            }},
            invokeToolPkgIpcAsync: function(callbackId, packageTarget, callerContextKey, targetContextKey, targetRuntime, channel, payloadJson) {{
                var normalizedCallbackId = String(callbackId || '').trim();
                if (!normalizedCallbackId) {{
                    return;
                }}
                __optimuseNativeInvokeToolPkgIpcAsync(
                    normalizedCallbackId,
                    String(packageTarget || ''),
                    String(callerContextKey || ''),
                    String(targetContextKey || ''),
                    String(targetRuntime || ''),
                    String(channel || ''),
                    String(payloadJson || '')
                );
            }},
            logJsExecutionTrace: function(callId, message) {{
                __optimuseNativeLogJsExecutionTrace(String(callId || ''), String(message || ''));
            }},
            decompress: function(data, algorithm) {{
                return __optimuseNativeDecompress(String(data), String(algorithm));
            }},
            crypto: function(algorithm, operation, argsJson) {{
                return __optimuseNativeCrypto(
                    String(algorithm),
                    String(operation),
                    String(argsJson)
                );
            }},
            image_processing: function(callbackId, operation, argsJson) {{
                var raw = __optimuseNativeImageProcessing(
                    String(callbackId),
                    String(operation),
                    String(argsJson)
                );
                var parsed = JSON.parse(raw);
                var callback = window[String(callbackId)];
                if (typeof callback === 'function') {{
                    if (parsed.success) {{
                        callback(parsed.result, false);
                    }} else {{
                        callback(parsed.error, true);
                    }}
                }} else {{
                    console.error("Callback not found: " + String(callbackId));
                }}
            }},
            javaClassExists: function(className) {{
                return __optimuseNativeJavaClassExists(String(className || ''));
            }},
            javaGetApplicationContext: function() {{
                return __optimuseNativeJavaGetApplicationContext();
            }},
            javaGetCurrentActivity: function() {{
                throw new Error('current activity is null');
            }},
            javaNewInstance: function(className, argsJson) {{
                return __optimuseNativeJavaNewInstance(
                    String(className || ''),
                    String(argsJson || '[]')
                );
            }},
            javaCallStatic: function(className, methodName, argsJson) {{
                return __optimuseNativeJavaCallStatic(
                    String(className || ''),
                    String(methodName || ''),
                    String(argsJson || '[]')
                );
            }},
            javaCallInstance: function(instanceHandle, methodName, argsJson) {{
                return __optimuseNativeJavaCallInstance(
                    String(instanceHandle || ''),
                    String(methodName || ''),
                    String(argsJson || '[]')
                );
            }},
            setCallResult: function(callId, result) {{
                __optimuseNativeSetCallResult(String(callId || ''), String(result == null ? '' : result));
            }},
            setCallError: function(callId, error) {{
                __optimuseNativeSetCallError(String(callId || ''), String(error == null ? '' : error));
            }}
        }};

        var setTimeout = NativeInterface.setTimeout;
        var clearTimeout = NativeInterface.clearTimeout;
        var setInterval = NativeInterface.setInterval;
        var clearInterval = NativeInterface.clearInterval;

        {}

        function __optimuseParseToolResult(result, isError) {{
            if (isError) {{
                if (typeof result === 'string' && result.length > 1) {{
                    var errorFirst = result.charAt(0);
                    if (errorFirst === '{{' || errorFirst === '[') {{
                        try {{
                            result = JSON.parse(result);
                        }} catch (_error) {{}}
                    }}
                }}
                if (result && typeof result === 'object' && result.success === false) {{
                    var err = new Error(String(result.message || 'Tool call failed'));
                    err.data = result.data;
                    throw err;
                }}
                throw new Error(typeof result === 'string' ? result : JSON.stringify(result));
            }}
            if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'success')) {{
                if (result.success) {{
                    return result.data;
                }}
                var error = new Error(String(result.message || 'Tool call failed'));
                error.data = result.data;
                throw error;
            }}
            if (typeof result === 'string' && result.length > 1) {{
                var first = result.charAt(0);
                if (first === '{{' || first === '[') {{
                    var parsedResult;
                    try {{
                        parsedResult = JSON.parse(result);
                    }} catch (_error) {{
                        return result;
                    }}
                    return __optimuseParseToolResult(parsedResult, false);
                }}
            }}
            return result;
        }}

        /** Executes a tool through the asynchronous Host callback boundary. */
        async function toolCall() {{
            var type = 'default';
            var name = '';
            var params = {{}};
            if (arguments.length === 1 && typeof arguments[0] === 'object') {{
                type = String(arguments[0].type || 'default');
                name = String(arguments[0].name || '');
                params = arguments[0].params || {{}};
            }} else if (arguments.length === 1) {{
                name = String(arguments[0] || '');
            }} else if (arguments.length === 2) {{
                name = String(arguments[0] || '');
                params = arguments[1] || {{}};
            }} else {{
                type = String(arguments[0] || 'default');
                name = String(arguments[1] || '');
                params = arguments[2] || {{}};
            }}
            var raw = await NativeInterface.callTool(type, name, JSON.stringify(params));
            var parsed;
            try {{
                parsed = JSON.parse(raw);
            }} catch (_parseError) {{
                parsed = raw;
            }}
            return __optimuseParseToolResult(parsed, false);
        }}

        /** Returns the host-owned executable tool catalog for workflow editors. */
        function getToolCatalog() {{
            var raw = NativeInterface.getToolCatalogJson();
            var catalog = JSON.parse(raw);
            if (!catalog) {{
                throw new Error('Tool catalog request returned no response');
            }}
            if (catalog.success === false) {{
                throw new Error(String(catalog.message || 'Tool catalog request failed'));
            }}
            if (!Array.isArray(catalog.tools)) {{
                throw new Error('Tool catalog response must contain a tools array');
            }}
            return catalog;
        }}

        globalThis.__optimuseCompleteCalled = false;
        globalThis.__optimuseCompleteValue = undefined;
        function complete(value) {{
            globalThis.__optimuseCompleteCalled = true;
            globalThis.__optimuseCompleteValue = value;
        }}

        function sendIntermediateResult(value) {{
            __optimuseSendIntermediateResult(__optimuseFinishExecutionResult(value));
        }}
        var emit = sendIntermediateResult;
        var delta = sendIntermediateResult;
        var log = sendIntermediateResult;
        var update = sendIntermediateResult;

        function __optimuseFinishExecutionResult(result) {{
            if (result && result.__optimuse_error) {{
                return JSON.stringify({{
                    success: false,
                    message: String(result.message || ''),
                    data: result.data
                }});
            }}
            if (result !== null && typeof result === 'object') {{
                return JSON.stringify(result);
            }}
            return result === undefined ? "undefined" : String(result);
        }}

        function __optimuseHasUsableJavaInstanceMarker(value) {{
            if (!value || typeof value !== 'object') {{
                return false;
            }}
            try {{
                return (
                    Object.prototype.hasOwnProperty.call(value, '__javaHandle') &&
                    Object.prototype.hasOwnProperty.call(value, '__javaClass') &&
                    typeof value.__javaHandle === 'string' &&
                    typeof value.__javaClass === 'string' &&
                    __optimuseText(value.__javaHandle).trim().length > 0 &&
                    __optimuseText(value.__javaClass).trim().length > 0
                );
            }} catch (_javaMarkerError) {{
                return false;
            }}
        }}

        function __optimuseNormalizeSerializableValue(value, seen) {{
            if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {{
                return value;
            }}
            if (typeof value === 'bigint' || typeof value === 'function') {{
                return String(value);
            }}
            if (typeof value !== 'object') {{
                return String(value);
            }}
            seen = seen || [];
            if (seen.indexOf(value) >= 0) {{
                return '[Circular]';
            }}
            seen.push(value);
            try {{
                if (typeof value.toJSON === 'function') {{
                    return __optimuseNormalizeSerializableValue(value.toJSON(), seen);
                }}
                if (Array.isArray(value)) {{
                    return value.map(function(item) {{
                        return __optimuseNormalizeSerializableValue(item, seen);
                    }});
                }}
                if (__optimuseHasUsableJavaInstanceMarker(value)) {{
                    return {{
                        __javaHandle: __optimuseText(value.__javaHandle),
                        __javaClass: __optimuseText(value.__javaClass)
                    }};
                }}
                var out = {{}};
                Object.keys(value).forEach(function(key) {{
                    out[key] = __optimuseNormalizeSerializableValue(value[key], seen);
                }});
                return out;
            }} finally {{
                seen.pop();
            }}
        }}

        function __optimuseSerializeOrThrow(value) {{
            return JSON.stringify(__optimuseNormalizeSerializableValue(value, []));
        }}

        function __optimuseSafeSerialize(value) {{
            try {{
                return __optimuseSerializeOrThrow(value);
            }} catch (error) {{
                return JSON.stringify({{
                    error: 'Failed to serialize value',
                    message: __optimuseText(error && error.message ? error.message : error),
                    value: __optimuseText(value).slice(0, 1000)
                }});
            }}
        }}

        function __optimuseNormalizeComposeResult(value) {{
            if (!value || typeof value !== 'object' || !value.composeDsl || typeof value.composeDsl !== 'object') {{
                return value;
            }}
            if (!Object.prototype.hasOwnProperty.call(value.composeDsl, 'screen')) {{
                return value;
            }}
            var screenRef = value.composeDsl.screen;
            var resolved = '';
            if (typeof screenRef === 'function') {{
                resolved = __optimuseText(screenRef.__optimuse_toolpkg_module_path).trim();
            }} else if (
                screenRef &&
                typeof screenRef === 'object' &&
                typeof screenRef.default === 'function'
            ) {{
                resolved = __optimuseText(screenRef.default.__optimuse_toolpkg_module_path).trim();
            }} else if (typeof screenRef === 'string') {{
                throw new Error('composeDsl.screen must be a compose_dsl screen function, not a string path');
            }}
            if (!resolved) {{
                throw new Error('composeDsl.screen is missing a toolpkg module path marker');
            }}
            value.composeDsl.screen = resolved.replace(/\\/g, '/');
            return value;
        }}

        function __optimuseGetFactoryCache() {{
            if (!globalThis.__optimuseFactoryCache || typeof globalThis.__optimuseFactoryCache !== 'object') {{
                globalThis.__optimuseFactoryCache = {{}};
            }}
            return globalThis.__optimuseFactoryCache;
        }}

        function __optimuseGetModuleInstanceCache() {{
            if (!globalThis.__optimuseModuleInstanceCache || typeof globalThis.__optimuseModuleInstanceCache !== 'object') {{
                globalThis.__optimuseModuleInstanceCache = {{}};
            }}
            return globalThis.__optimuseModuleInstanceCache;
        }}

        function __optimuseNormalizePath(pathValue) {{
            var parts = String(pathValue == null ? '' : pathValue).replace(/\\/g, '/').split('/');
            var stack = [];
            for (var i = 0; i < parts.length; i += 1) {{
                var part = parts[i];
                if (!part || part === '.') {{
                    continue;
                }}
                if (part === '..') {{
                    if (stack.length > 0) {{
                        stack.pop();
                    }}
                    continue;
                }}
                stack.push(part);
            }}
            return stack.join('/');
        }}

        function __optimuseDirname(pathValue) {{
            var normalized = __optimuseNormalizePath(pathValue);
            var index = normalized.lastIndexOf('/');
            return index < 0 ? '' : normalized.slice(0, index);
        }}

        function __optimuseResolveModulePath(request, fromPath) {{
            var normalized = String(request == null ? '' : request).replace(/\\/g, '/').trim();
            if (!normalized) {{
                return '';
            }}
            if (!(normalized.startsWith('.') || normalized.startsWith('/'))) {{
                return normalized;
            }}
            if (normalized.startsWith('/')) {{
                return __optimuseNormalizePath(normalized);
            }}
            var base = __optimuseDirname(fromPath);
            return __optimuseNormalizePath(base ? base + '/' + normalized : normalized);
        }}

        function __optimuseBuildCandidatePaths(modulePath) {{
            var normalized = __optimuseNormalizePath(modulePath);
            if (!normalized) {{
                return [];
            }}
            if (/\.[a-z0-9]+$/i.test(normalized)) {{
                return [normalized];
            }}
            return [
                normalized,
                normalized + '.js',
                normalized + '.json',
                normalized + '/index.js',
                normalized + '/index.json'
            ];
        }}

        function __optimuseHashText(value) {{
            var textValue = String(value == null ? '' : value);
            var hash = 0;
            for (var i = 0; i < textValue.length; i += 1) {{
                hash = (((hash << 5) - hash) + textValue.charCodeAt(i)) | 0;
            }}
            return (hash >>> 0).toString(16);
        }}

        function __optimuseBuildFactoryKey(kind, identity, source) {{
            return [String(kind || ''), String(identity || ''), String(source || '').length, __optimuseHashText(source)].join(':');
        }}

        function __optimuseGetFactory(kind, identity, source) {{
            var key = __optimuseBuildFactoryKey(kind, identity, source);
            var cache = __optimuseGetFactoryCache();
            if (typeof cache[key] === 'function') {{
                return cache[key];
            }}
            var factory = new Function(
                'module',
                'exports',
                'require',
                '__optimuse_call_runtime',
                __optimuseRuntimePrelude + '\n' + source
            );
            cache[key] = factory;
            return factory;
        }}

        function __optimuseTagModuleExports(modulePath, exportsRef) {{
            if (typeof exportsRef === 'function') {{
                exportsRef.__optimuse_toolpkg_module_path = modulePath;
                return;
            }}
            if (!exportsRef || typeof exportsRef !== 'object') {{
                return;
            }}
            exportsRef.__optimuse_toolpkg_module_path = modulePath;
            Object.keys(exportsRef).forEach(function(key) {{
                if (typeof exportsRef[key] === 'function') {{
                    exportsRef[key].__optimuse_toolpkg_module_path = modulePath;
                    exportsRef[key].__optimuse_toolpkg_export_name = key;
                }}
            }});
        }}

        function __optimuseText(value) {{
            return value == null ? '' : String(value);
        }}

        function __optimuseToBoolean(value) {{
            if (typeof value === 'boolean') {{
                return value;
            }}
            var normalized = __optimuseText(value).trim().toLowerCase();
            return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
        }}

        function __optimuseCreateRegistrationScreenPlaceholder(modulePath) {{
            function ScreenPlaceholder() {{
                return null;
            }}
            ScreenPlaceholder.__optimuse_toolpkg_module_path = modulePath;
            return ScreenPlaceholder;
        }}

        function __optimuseIsLocalUiModulePath(modulePath) {{
            var normalized = __optimuseNormalizePath(modulePath);
            return /\.ui\.js$/i.test(normalized);
        }}

        function __optimuseFindTargetFunction(exportsRef, moduleRef, functionName) {{
            if (exportsRef && typeof exportsRef[functionName] === 'function') {{
                return exportsRef[functionName];
            }}
            if (moduleRef && moduleRef.exports && typeof moduleRef.exports[functionName] === 'function') {{
                return moduleRef.exports[functionName];
            }}
            if (typeof globalThis[functionName] === 'function') {{
                return globalThis[functionName];
            }}
            return null;
        }}

        function __optimuseBuildAvailableFunctions(exportsRef, moduleRef) {{
            var names = [];
            function collect(target) {{
                if (!target || typeof target !== 'object') {{
                    return;
                }}
                Object.keys(target).forEach(function(key) {{
                    if (typeof target[key] === 'function' && names.indexOf(key) < 0) {{
                        names.push(key);
                    }}
                }});
            }}
            collect(exportsRef);
            collect(moduleRef && moduleRef.exports ? moduleRef.exports : null);
            return names;
        }}

        function __optimuseExecuteScriptFunction(callId, params, scriptText, targetFunctionName, timeoutSec, preTimeoutMs) {{
            var previousCallRuntime = globalThis.__optimuse_call_runtime_ref;
            var previousCallId = globalThis.__optimuseCurrentCallId;
            var registerCallSession = globalThis.__optimuseRegisterCallSession;
            if (typeof registerCallSession !== 'function') {{
                NativeInterface.setCallError(callId, JSON.stringify({{
                    success: false,
                    message: 'JS execution runtime bridge is unavailable'
                }}));
                return;
            }}
            var callState = registerCallSession(callId, params);
            callState.previousCallId = previousCallId;
            callState.previousCallRuntime = previousCallRuntime;
            globalThis.__optimuseCurrentCallId = callId;
            function getCallState() {{
                return typeof globalThis.__optimuseGetCallState === 'function'
                    ? globalThis.__optimuseGetCallState(callId)
                    : null;
            }}
            function finalizeCall() {{
                if (globalThis.__optimuseCurrentCallId === callId) {{
                    globalThis.__optimuseCurrentCallId =
                        typeof previousCallId === 'string' ? previousCallId : '';
                }}
                if (globalThis.__optimuse_call_runtime_ref === callRuntime) {{
                    if (previousCallRuntime && typeof previousCallRuntime === 'object') {{
                        globalThis.__optimuse_call_runtime_ref = previousCallRuntime;
                    }} else {{
                        delete globalThis.__optimuse_call_runtime_ref;
                    }}
                }}
                if (callState.pendingReferences > 0) {{
                    callState.detached = true;
                    if (typeof globalThis.__optimuseNotifyDetachedCall === 'function') {{
                        globalThis.__optimuseNotifyDetachedCall(callId);
                    }}
                }} else if (typeof globalThis.__optimuseCleanupCallSession === 'function') {{
                    globalThis.__optimuseCleanupCallSession(callId);
                }}
            }}
            function isActive() {{
                var state = getCallState();
                return !!(state && (!state.completed || state.detached));
            }}
            function readCallValue(key, defaultValue) {{
                var state = getCallState();
                var currentParams = state && state.params && typeof state.params === 'object'
                    ? state.params
                    : null;
                var value = currentParams ? currentParams[key] : undefined;
                return value == null || value === '' ? defaultValue : __optimuseText(value);
            }}
            function markStage(stage) {{
                callState.lastExecStage = __optimuseText(stage);
                NativeInterface.logJsExecutionTrace(
                    callId,
                    'stage=' + callState.lastExecStage +
                        ' function=' + __optimuseText(callState.lastExecFunction) +
                        ' module=' + __optimuseText(callState.lastModulePath) +
                        ' require=' + __optimuseText(callState.lastRequireRequest) +
                        ' from=' + __optimuseText(callState.lastRequireFrom) +
                        ' resolved=' + __optimuseText(callState.lastRequireResolved)
                );
            }}
            function markFunction(name) {{
                callState.lastExecFunction = __optimuseText(name);
                NativeInterface.logJsExecutionTrace(
                    callId,
                    'function=' + callState.lastExecFunction +
                        ' package=' + __optimuseText(params && (params.__optimuse_ui_package_name || params.toolPkgId || params.__optimuse_package_name)) +
                        ' screen=' + __optimuseText(params && params.__optimuse_script_screen) +
                        ' context=' + __optimuseText(params && params.__optimuse_execution_context_key)
                );
            }}
            function markRequire(request, fromPath, resolvedPath) {{
                callState.lastRequireRequest = __optimuseText(request);
                callState.lastRequireFrom = __optimuseText(fromPath);
                callState.lastRequireResolved = __optimuseText(resolvedPath);
                NativeInterface.logJsExecutionTrace(
                    callId,
                    'require=' + callState.lastRequireRequest +
                        ' from=' + callState.lastRequireFrom +
                        ' resolved=' + callState.lastRequireResolved
                );
            }}
            function markModule(modulePath) {{
                callState.lastModulePath = __optimuseText(modulePath);
                NativeInterface.logJsExecutionTrace(callId, 'module=' + callState.lastModulePath);
            }}
            function completeCall(resultText) {{
                var state = getCallState();
                if (!state || state.resultCompleted) {{
                    return;
                }}
                state.resultCompleted = true;
                state.completed = Number(state.pendingReferences || 0) <= 0;
                try {{
                    NativeInterface.logJsExecutionTrace(callId, 'complete ' + __optimuseText(resultText).slice(0, 240));
                    NativeInterface.setCallResult(callId, resultText);
                }} finally {{
                    finalizeCall();
                }}
            }}
            function emitError(message) {{
                var state = getCallState();
                if (!state || state.resultCompleted) {{
                    return;
                }}
                state.resultCompleted = true;
                state.completed = Number(state.pendingReferences || 0) <= 0;
                try {{
                    NativeInterface.logJsExecutionTrace(callId, 'error ' + __optimuseText(message).slice(0, 240));
                    NativeInterface.setCallError(callId, JSON.stringify({{
                        success: false,
                        message: __optimuseText(message)
                    }}));
                }} finally {{
                    finalizeCall();
                }}
            }}
            function callRuntimeReport(error, context) {{
                if (typeof globalThis.__optimuseReportDetailedErrorForCall === 'function') {{
                    return globalThis.__optimuseReportDetailedErrorForCall(callId, error, context);
                }}
                return {{
                    formatted: __optimuseText(context) + ': ' + __optimuseText(error),
                    details: {{
                        message: __optimuseText(error && error.message ? error.message : error),
                        stack: __optimuseText(error && error.stack ? error.stack : error),
                        lineNumber: 0
                    }}
                }};
            }}
            function emitIntermediate(value) {{
                if (isActive()) {{
                    NativeInterface.sendCallIntermediateResult(callId, __optimuseSafeSerialize(value));
                }}
            }}
            function complete(value) {{
                try {{
                    completeCall(__optimuseSerializeOrThrow(__optimuseNormalizeComposeResult(value)));
                }} catch (error) {{
                    var report = callRuntimeReport(error, 'Result Serialization Failure');
                    var serializationMessage =
                        report &&
                        report.details &&
                        typeof report.details.message === 'string' &&
                        report.details.message
                            ? report.details.message
                            : __optimuseText(error && error.message ? error.message : error);
                    emitError('Result serialization failed: ' + serializationMessage);
                }}
            }}
            var callRuntime = {{
                callId: callId,
                emit: emitIntermediate,
                delta: emitIntermediate,
                log: emitIntermediate,
                update: emitIntermediate,
                sendIntermediateResult: emitIntermediate,
                done: complete,
                complete: complete,
                getState: function() {{ return readCallValue('__optimuse_package_state', undefined); }},
                getLang: function() {{ return readCallValue('__optimuse_package_lang', 'en'); }},
                getCallerName: function() {{ return readCallValue('__optimuse_package_caller_name', undefined); }},
                getChatId: function() {{ return readCallValue('__optimuse_package_chat_id', undefined); }},
                getCallerCardId: function() {{ return readCallValue('__optimuse_package_caller_card_id', undefined); }},
                getEnv: function(key) {{
                    var value = NativeInterface.getEnvForCall(callId, __optimuseText(key).trim());
                    return value == null || value === '' ? undefined : __optimuseText(value);
                }},
                getPluginConfigDir: function(pluginId) {{
                    var explicitId = pluginId == null ? '' : __optimuseText(pluginId).trim();
                    var ownerId =
                        readCallValue('__optimuse_ui_package_name', '') ||
                        readCallValue('toolPkgId', '') ||
                        readCallValue('containerPackageName', '') ||
                        readCallValue('__optimuse_package_name', '');
                    var resolvedId = explicitId || ownerId;
                    if (
                        !ownerId ||
                        typeof NativeInterface === 'undefined' ||
                        !NativeInterface ||
                        typeof NativeInterface.getScopedPluginConfigDir !== 'function'
                    ) {{
                        return '';
                    }}
                    var path = NativeInterface.getScopedPluginConfigDir(ownerId, resolvedId);
                    return typeof path === 'string' ? path : '';
                }},
                reportDetailedError: callRuntimeReport,
                fail: function(error) {{
                    var report = callRuntimeReport(error, 'Asynchronous Callback');
                    var message = report && report.details && report.details.message
                        ? report.details.message
                        : __optimuseText(error && error.message ? error.message : error);
                    emitError(message || 'Asynchronous callback failed');
                }},
                handleAsync: function(value) {{
                    if (!value || typeof value.then !== 'function') {{
                        return false;
                    }}
                    Promise.resolve(value).then(
                        function(result) {{
                            if (isActive()) {{
                                complete(result);
                            }}
                        }},
                        function(error) {{
                            if (isActive()) {{
                                var report = callRuntimeReport(error, 'Async Promise Rejection');
                                var rejectionMessage =
                                    report &&
                                    report.details &&
                                    typeof report.details.message === 'string' &&
                                    report.details.message
                                        ? report.details.message
                                        : __optimuseText(error && error.message ? error.message : error);
                                emitError(rejectionMessage || 'Promise rejection');
                            }}
                        }}
                    );
                    return true;
                }},
                console: console
            }};
            callState.callRuntime = callRuntime;
            globalThis.__optimuse_call_runtime_ref = callRuntime;
            try {{
                var registrationMode = __optimuseToBoolean(readCallValue('__optimuse_registration_mode', false));
                var packageTarget =
                    readCallValue('__optimuse_ui_package_name', '') ||
                    readCallValue('toolPkgId', '');
                var screenPath = __optimuseNormalizePath(readCallValue(
                    '__optimuse_script_screen',
                    params && params.moduleSpec && params.moduleSpec.screen
                        ? __optimuseText(params.moduleSpec.screen)
                        : ''
                ));
                function getCurrentToolPkgRuntimeKind() {{
                    var explicitRuntime = __optimuseText(
                        readCallValue('__optimuse_toolpkg_runtime_kind', '')
                    ).trim().toLowerCase();
                    if (
                        explicitRuntime === 'main' ||
                        explicitRuntime === 'ui' ||
                        explicitRuntime === 'sandbox' ||
                        explicitRuntime === 'provider'
                    ) {{
                        return explicitRuntime;
                    }}
                    var contextKey = __optimuseText(
                        readCallValue(
                            '__optimuse_execution_context_key',
                            readCallValue('executionContextKey', '')
                        )
                    ).trim();
                    if (/^toolpkg_provider:/i.test(contextKey)) {{
                        return 'provider';
                    }}
                    if (
                        /^toolpkg_compose:/i.test(contextKey) ||
                        /^toolpkg_compose_dsl:/i.test(contextKey) ||
                        /^toolpkg_xml_render:/i.test(contextKey)
                    ) {{
                        return 'ui';
                    }}
                    var subpackageId = __optimuseText(
                        readCallValue('__optimuse_toolpkg_subpackage_id', '')
                    ).trim();
                    return subpackageId.length > 0 ? 'sandbox' : 'main';
                }}

                function getCurrentToolPkgExecutionContextKey() {{
                    var composeContextKey = __optimuseText(
                        readCallValue(
                            '__optimuse_compose_execution_context_key',
                            readCallValue('executionContextKey', '')
                        )
                    ).trim();
                    var scopedContextKey = __optimuseText(
                        readCallValue('__optimuse_execution_context_key', '')
                    ).trim();
                    if (composeContextKey.length > 0) {{
                        return composeContextKey;
                    }}
                    if (scopedContextKey.length > 0) {{
                        return scopedContextKey;
                    }}
                    return packageTarget ? 'toolpkg_main:' + packageTarget : '';
                }}

                function ensureToolPkgIpcRegistry() {{
                    var registry = globalThis.__optimuseToolPkgIpcRegistry;
                    if (!registry || typeof registry !== 'object') {{
                        registry = Object.create(null);
                        globalThis.__optimuseToolPkgIpcRegistry = registry;
                    }}
                    return registry;
                }}

                function normalizeToolPkgIpcChannel(channel) {{
                    return __optimuseText(channel).trim();
                }}

                function registerToolPkgIpcHandler(channel, handler) {{
                    var normalizedChannel = normalizeToolPkgIpcChannel(channel);
                    if (normalizedChannel.length === 0) {{
                        throw new Error('ToolPkg.ipc channel is required');
                    }}
                    if (typeof handler !== 'function') {{
                        throw new Error('ToolPkg.ipc handler must be a function');
                    }}
                    ensureToolPkgIpcRegistry()[normalizedChannel] = handler;
                    return function() {{
                        var registry = ensureToolPkgIpcRegistry();
                        if (registry[normalizedChannel] === handler) {{
                            delete registry[normalizedChannel];
                        }}
                    }};
                }}

                function unregisterToolPkgIpcHandler(channel, handler) {{
                    var normalizedChannel = normalizeToolPkgIpcChannel(channel);
                    if (normalizedChannel.length === 0) {{
                        return false;
                    }}
                    var registry = ensureToolPkgIpcRegistry();
                    if (arguments.length > 1 && registry[normalizedChannel] !== handler) {{
                        return false;
                    }}
                    if (typeof registry[normalizedChannel] === 'function') {{
                        delete registry[normalizedChannel];
                        return true;
                    }}
                    return false;
                }}

                function invokeToolPkgIpcLocal(channel, payload, meta) {{
                    var normalizedChannel = normalizeToolPkgIpcChannel(channel);
                    if (normalizedChannel.length === 0) {{
                        throw new Error('ToolPkg.ipc channel is required');
                    }}
                    var registry = ensureToolPkgIpcRegistry();
                    var handler = registry[normalizedChannel];
                    if (typeof handler !== 'function') {{
                        throw new Error('ToolPkg.ipc channel is not registered: ' + normalizedChannel);
                    }}
                    return handler(payload, meta && typeof meta === 'object' ? meta : {{}});
                }}

                function normalizeToolPkgWasmValueType(valueType) {{
                    var normalizedType = __optimuseText(valueType).trim().toLowerCase();
                    if (
                        normalizedType !== 'i32' &&
                        normalizedType !== 'i64' &&
                        normalizedType !== 'f32' &&
                        normalizedType !== 'f64'
                    ) {{
                        throw new Error('ToolPkg.wasm arg type is invalid: ' + normalizedType);
                    }}
                    return normalizedType;
                }}

                function normalizeToolPkgWasmArgs(args) {{
                    if (args == null) {{
                        return [];
                    }}
                    if (!Array.isArray(args)) {{
                        throw new Error('ToolPkg.wasm args must be an array');
                    }}
                    var normalizedArgs = [];
                    for (var i = 0; i < args.length; i += 1) {{
                        var arg = args[i];
                        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {{
                            throw new Error('ToolPkg.wasm arg ' + i + ' must be an object');
                        }}
                        var valueType = normalizeToolPkgWasmValueType(arg.type);
                        if (!Object.prototype.hasOwnProperty.call(arg, 'value')) {{
                            throw new Error('ToolPkg.wasm arg ' + i + ' value is required');
                        }}
                        var value = arg.value;
                        if (valueType === 'i32' && typeof value !== 'number') {{
                            throw new Error('ToolPkg.wasm arg ' + i + ' i32 value must be a number');
                        }}
                        if (valueType === 'i64' && typeof value !== 'number' && typeof value !== 'string') {{
                            throw new Error('ToolPkg.wasm arg ' + i + ' i64 value must be a number or string');
                        }}
                        if (
                            (valueType === 'f32' || valueType === 'f64') &&
                            typeof value !== 'number' &&
                            typeof value !== 'string'
                        ) {{
                            throw new Error('ToolPkg.wasm arg ' + i + ' float value must be a number or string');
                        }}
                        normalizedArgs.push({{ type: valueType, value: value }});
                    }}
                    return normalizedArgs;
                }}

                function ensureToolPkgIpcApi() {{
                    var toolPkgApi = globalThis.ToolPkg && typeof globalThis.ToolPkg === 'object'
                        ? globalThis.ToolPkg
                        : {{}};
                    if (globalThis.ToolPkg !== toolPkgApi) {{
                        globalThis.ToolPkg = toolPkgApi;
                    }}
                    var ipcApi = toolPkgApi.ipc && typeof toolPkgApi.ipc === 'object'
                        ? toolPkgApi.ipc
                        : {{}};

                    ipcApi.on = function(channel, handler) {{
                        return registerToolPkgIpcHandler(channel, handler);
                    }};
                    ipcApi.off = function(channel, handler) {{
                        return unregisterToolPkgIpcHandler(channel, handler);
                    }};
                    ipcApi.call = function(channel, payload, options) {{
                        var normalizedChannel = normalizeToolPkgIpcChannel(channel);
                        if (normalizedChannel.length === 0) {{
                            return Promise.reject(new Error('ToolPkg.ipc channel is required'));
                        }}
                        var callOptions = options && typeof options === 'object' ? options : {{}};
                        var targetRuntime = __optimuseText(callOptions.targetRuntime || '').trim().toLowerCase();
                        if (
                            targetRuntime &&
                            targetRuntime !== 'main' &&
                            targetRuntime !== 'ui' &&
                            targetRuntime !== 'sandbox' &&
                            targetRuntime !== 'provider'
                        ) {{
                            return Promise.reject(new Error('ToolPkg.ipc targetRuntime is invalid: ' + targetRuntime));
                        }}
                        var targetContextKey = __optimuseText(callOptions.targetContextKey || '').trim();
                        var hasTargetOptions = targetRuntime.length > 0 || targetContextKey.length > 0;
                        var currentContextKey = getCurrentToolPkgExecutionContextKey();
                        var currentRuntime = getCurrentToolPkgRuntimeKind();
                        if (
                            currentRuntime === 'main' &&
                            (
                                !hasTargetOptions ||
                                (
                                    (targetRuntime.length === 0 || targetRuntime === 'main') &&
                                    (targetContextKey.length === 0 || targetContextKey === currentContextKey)
                                )
                            )
                        ) {{
                            try {{
                                return Promise.resolve(
                                    invokeToolPkgIpcLocal(normalizedChannel, payload, {{
                                        channel: normalizedChannel,
                                        callerContextKey: currentContextKey,
                                        currentContextKey: currentContextKey,
                                        currentRuntime: currentRuntime,
                                        packageTarget: packageTarget
                                    }})
                                );
                            }} catch (error) {{
                                return Promise.reject(error);
                            }}
                        }}
                        if (
                            targetContextKey.length > 0 &&
                            targetContextKey === currentContextKey &&
                            targetRuntime.length > 0 &&
                            targetRuntime !== currentRuntime
                        ) {{
                            return Promise.reject(
                                new Error(
                                    'ToolPkg.ipc targetRuntime does not match current runtime: ' +
                                        targetRuntime +
                                        ' != ' +
                                        currentRuntime
                                )
                            );
                        }}
                        if (targetContextKey.length > 0 && targetContextKey === currentContextKey) {{
                            try {{
                                return Promise.resolve(
                                    invokeToolPkgIpcLocal(normalizedChannel, payload, {{
                                        channel: normalizedChannel,
                                        callerContextKey: currentContextKey,
                                        currentContextKey: currentContextKey,
                                        currentRuntime: currentRuntime,
                                        packageTarget: packageTarget
                                    }})
                                );
                            }} catch (error) {{
                                return Promise.reject(error);
                            }}
                        }}
                        if (
                            !packageTarget ||
                            typeof NativeInterface === 'undefined' ||
                            !NativeInterface ||
                            typeof NativeInterface.invokeToolPkgIpcAsync !== 'function'
                        ) {{
                            return Promise.reject(new Error('ToolPkg.ipc runtime bridge is unavailable'));
                        }}
                        var payloadJson;
                        try {{
                            payloadJson = __optimuseSerializeOrThrow(payload);
                        }} catch (error) {{
                            try {{
                                if (
                                    typeof NativeInterface !== 'undefined' &&
                                    NativeInterface &&
                                    typeof NativeInterface.logErrorForCall === 'function'
                                ) {{
                                    NativeInterface.logErrorForCall(
                                        callId,
                                        'ToolPkg.ipc payload serialization failed: ' +
                                            __optimuseText(error && error.message ? error.message : error)
                                    );
                                }}
                            }} catch (_logIpcPayloadError) {{}}
                            return Promise.reject(error);
                        }}
                        return new Promise(function(resolve, reject) {{
                            var callbackId =
                                '__optimuse_toolpkg_ipc_' +
                                Date.now() +
                                '_' +
                                Math.random().toString(36).slice(2, 10);
                            var ownerCallId = String(globalThis.__optimuseCurrentCallId || '');
                            if (typeof globalThis.__optimuseRetainCallReference === 'function') {{
                                globalThis.__optimuseRetainCallReference(ownerCallId);
                            }}
                            globalThis[callbackId] = function(resultJson, isError) {{
                                if (typeof globalThis.__optimuseActivateCall === 'function') {{
                                    globalThis.__optimuseActivateCall(ownerCallId);
                                }}
                                try {{
                                    delete globalThis[callbackId];
                                }} catch (_deleteCallbackError) {{
                                    globalThis[callbackId] = undefined;
                                }}
                                if (isError) {{
                                    reject(new Error(__optimuseText(resultJson).trim() || 'ToolPkg.ipc call failed'));
                                    Promise.resolve().then(function() {{
                                        if (typeof globalThis.__optimuseReleaseCallReference === 'function') {{
                                            globalThis.__optimuseReleaseCallReference(ownerCallId);
                                        }}
                                    }});
                                    return;
                                }}
                                var parsed;
                                try {{
                                    parsed = JSON.parse(__optimuseText(resultJson) || 'null');
                                }} catch (error) {{
                                    try {{
                                        if (
                                            typeof NativeInterface !== 'undefined' &&
                                            NativeInterface &&
                                            typeof NativeInterface.logErrorForCall === 'function'
                                        ) {{
                                            var resultType = resultJson === null ? 'null' : typeof resultJson;
                                            var preview = __optimuseText(resultJson).slice(0, 500);
                                            NativeInterface.logErrorForCall(
                                                callId,
                                                'ToolPkg.ipc returned invalid JSON: ' +
                                                    __optimuseText(error && error.message ? error.message : error) +
                                                    ', resultType=' + resultType +
                                                    ', preview=' + preview
                                            );
                                        }}
                                    }} catch (_logIpcParseError) {{}}
                                    reject(
                                        new Error(
                                            'ToolPkg.ipc returned invalid JSON: ' +
                                            __optimuseText(error && error.message ? error.message : error)
                                        )
                                    );
                                    Promise.resolve().then(function() {{
                                        if (typeof globalThis.__optimuseReleaseCallReference === 'function') {{
                                            globalThis.__optimuseReleaseCallReference(ownerCallId);
                                        }}
                                    }});
                                    return;
                                }}
                                if (parsed && parsed.success === true) {{
                                    resolve(parsed.value);
                                }} else {{
                                    reject(
                                        new Error(
                                            parsed && typeof parsed.message === 'string' && parsed.message.trim().length > 0
                                                ? parsed.message.trim()
                                                : 'ToolPkg.ipc call failed'
                                        )
                                    );
                                }}
                                Promise.resolve().then(function() {{
                                    if (typeof globalThis.__optimuseReleaseCallReference === 'function') {{
                                        globalThis.__optimuseReleaseCallReference(ownerCallId);
                                    }}
                                }});
                            }};
                            try {{
                                NativeInterface.invokeToolPkgIpcAsync(
                                    callbackId,
                                    packageTarget,
                                    currentContextKey,
                                    targetContextKey,
                                    targetRuntime,
                                    normalizedChannel,
                                    payloadJson
                                );
                            }} catch (error) {{
                                try {{
                                    delete globalThis[callbackId];
                                }} catch (_deleteCallbackInvokeError) {{
                                    globalThis[callbackId] = undefined;
                                }}
                                reject(error);
                                Promise.resolve().then(function() {{
                                    if (typeof globalThis.__optimuseReleaseCallReference === 'function') {{
                                        globalThis.__optimuseReleaseCallReference(ownerCallId);
                                    }}
                                }});
                            }}
                        }});
                    }};

                    toolPkgApi.ipc = ipcApi;
                    globalThis.__optimuseInvokeToolPkgIpcLocal = invokeToolPkgIpcLocal;
                }}

                function ensureToolPkgWasmApi() {{
                    var toolPkgApi = globalThis.ToolPkg && typeof globalThis.ToolPkg === 'object'
                        ? globalThis.ToolPkg
                        : {{}};
                    if (globalThis.ToolPkg !== toolPkgApi) {{
                        globalThis.ToolPkg = toolPkgApi;
                    }}
                    var wasmApi = toolPkgApi.wasm && typeof toolPkgApi.wasm === 'object'
                        ? toolPkgApi.wasm
                        : {{}};
                    wasmApi.call = function(moduleId, exportName, args) {{
                        var normalizedModuleId = __optimuseText(moduleId).trim();
                        if (normalizedModuleId.length === 0) {{
                            return Promise.reject(new Error('ToolPkg.wasm module id is required'));
                        }}
                        var normalizedExportName = __optimuseText(exportName).trim();
                        if (normalizedExportName.length === 0) {{
                            return Promise.reject(new Error('ToolPkg.wasm export name is required'));
                        }}
                        var normalizedArgs;
                        try {{
                            normalizedArgs = normalizeToolPkgWasmArgs(args);
                        }} catch (error) {{
                            return Promise.reject(error);
                        }}
                        if (
                            !packageTarget ||
                            typeof NativeInterface === 'undefined' ||
                            !NativeInterface ||
                            typeof NativeInterface.callToolPkgWasm !== 'function'
                        ) {{
                            return Promise.reject(new Error('ToolPkg.wasm runtime bridge is unavailable'));
                        }}
                        var resultJson;
                        try {{
                            resultJson = NativeInterface.callToolPkgWasm(
                                packageTarget,
                                normalizedModuleId,
                                normalizedExportName,
                                JSON.stringify(normalizedArgs)
                            );
                        }} catch (error) {{
                            return Promise.reject(error);
                        }}
                        var parsed;
                        try {{
                            parsed = JSON.parse(__optimuseText(resultJson) || 'null');
                        }} catch (error) {{
                            return Promise.reject(
                                new Error(
                                    'ToolPkg.wasm returned invalid JSON: ' +
                                        __optimuseText(error && error.message ? error.message : error)
                                )
                            );
                        }}
                        if (parsed && parsed.success === true) {{
                            return Promise.resolve(
                                Object.prototype.hasOwnProperty.call(parsed, 'value') ? parsed.value : null
                            );
                        }}
                        return Promise.reject(
                            new Error(
                                parsed && typeof parsed.message === 'string' && parsed.message.trim().length > 0
                                    ? parsed.message.trim()
                                    : 'ToolPkg.wasm call failed'
                            )
                        );
                    }};
                    toolPkgApi.wasm = wasmApi;
                }}

                ensureToolPkgIpcApi();
                if (!registrationMode) {{
                    ensureToolPkgWasmApi();
                }}
                if (
                    globalThis.RuntimeContext &&
                    typeof globalThis.RuntimeContext.__optimuseEnsureContextRunnerRegistered === 'function'
                ) {{
                    globalThis.RuntimeContext.__optimuseEnsureContextRunnerRegistered();
                }}
                var moduleCache = registrationMode ? {{}} : __optimuseGetModuleInstanceCache();
                var mainModuleKey = ['instance', 'main', packageTarget + ':' + screenPath, String(scriptText || '').length, __optimuseHashText(scriptText)].join(':');
                var module = moduleCache[mainModuleKey];
                var exports = module && module.exports ? module.exports : null;
                function readToolPkgModule(modulePath) {{
                    if (!packageTarget || !NativeInterface || typeof NativeInterface.readToolPkgTextResource !== 'function') {{
                        return null;
                    }}
                    var candidates = __optimuseBuildCandidatePaths(modulePath);
                    for (var i = 0; i < candidates.length; i += 1) {{
                        var candidate = candidates[i];
                        var textResult = NativeInterface.readToolPkgTextResource(packageTarget, candidate);
                        if (typeof textResult === 'string' && textResult.length > 0) {{
                            return {{ path: candidate, text: textResult }};
                        }}
                    }}
                    return null;
                }}
                function executeModule(modulePath, moduleText, requireInternal) {{
                    var moduleKey = ['instance', 'module', packageTarget + ':' + modulePath, String(moduleText || '').length, __optimuseHashText(moduleText)].join(':');
                    if (moduleCache[moduleKey]) {{
                        return moduleCache[moduleKey].exports;
                    }}
                    var requiredModule = {{ exports: {{}} }};
                    moduleCache[moduleKey] = requiredModule;
                    if (/\.json$/i.test(modulePath)) {{
                        try {{
                            requiredModule.exports = JSON.parse(moduleText);
                            return requiredModule.exports;
                        }} catch (error) {{
                            delete moduleCache[moduleKey];
                            throw error;
                        }}
                    }}
                    var localRequire = function(nextName) {{
                        return requireInternal(nextName, modulePath);
                    }};
                    var factory = __optimuseGetFactory('module', packageTarget + ':' + modulePath, moduleText);
                    var previousActiveModule = globalThis.__optimuseActiveModule;
                    var previousActiveExports = globalThis.__optimuseActiveModuleExports;
                    var previousModule = callState.currentModule;
                    var previousExports = callState.currentModuleExports;
                    globalThis.__optimuseActiveModule = requiredModule;
                    globalThis.__optimuseActiveModuleExports = requiredModule.exports;
                    callState.currentModule = requiredModule;
                    callState.currentModuleExports = requiredModule.exports;
                    try {{
                        factory(requiredModule, requiredModule.exports, localRequire, callRuntime);
                    }} catch (error) {{
                        delete moduleCache[moduleKey];
                        throw error;
                    }} finally {{
                        callState.currentModule = previousModule;
                        callState.currentModuleExports = previousExports;
                        globalThis.__optimuseActiveModule = previousActiveModule;
                        globalThis.__optimuseActiveModuleExports = previousActiveExports;
                    }}
                    __optimuseTagModuleExports(modulePath, requiredModule.exports);
                    return requiredModule.exports;
                }}
                function requireInternal(moduleName, fromPath) {{
                    var request = String(moduleName == null ? '' : moduleName).trim();
                    if (request === 'lodash') {{
                        return globalThis._;
                    }}
                    if (request === 'uuid') {{
                        return {{
                            v4: function() {{
                                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(char) {{
                                    var random = Math.random() * 16 | 0;
                                    var value = char === 'x' ? random : ((random & 0x3) | 0x8);
                                    return value.toString(16);
                                }});
                            }}
                        }};
                    }}
                    if (request === 'axios') {{
                        return {{
                            get: function(url, config) {{
                                return toolCall('http_request', config ? Object.assign({{ url: url }}, config) : {{ url: url }});
                            }},
                            post: function(url, data, config) {{
                                return toolCall('http_request', config ? Object.assign({{ url: url, data: data }}, config) : {{ url: url, data: data }});
                            }}
                        }};
                    }}
                    if (!(request.startsWith('.') || request.startsWith('/'))) {{
                        return {{}};
                    }}
                    var resolvedPath = __optimuseResolveModulePath(request, fromPath || screenPath);
                    markStage('require_module');
                    markRequire(request, fromPath || screenPath || '<root>', resolvedPath);
                    markModule(resolvedPath);
                    if (registrationMode && __optimuseIsLocalUiModulePath(resolvedPath)) {{
                        return __optimuseCreateRegistrationScreenPlaceholder(resolvedPath);
                    }}
                    var loaded = readToolPkgModule(resolvedPath);
                    if (!loaded) {{
                        throw new Error('Cannot resolve module "' + request + '" from "' + (fromPath || screenPath || '<root>') + '"');
                    }}
                    return executeModule(loaded.path, loaded.text, requireInternal);
                }}
                var require = function(moduleName) {{
                    markStage('require_request');
                    markRequire(moduleName, screenPath || '<root>', '');
                    return requireInternal(moduleName, screenPath);
                }};
                markFunction(targetFunctionName);
                if (!module) {{
                    module = {{ exports: {{}} }};
                    moduleCache[mainModuleKey] = module;
                    exports = module.exports;
                    markStage('compile_main_script');
                    var mainFactory = __optimuseGetFactory('main', packageTarget + ':' + screenPath, scriptText);
                    markStage('execute_main_script');
                    var previousActiveModule = globalThis.__optimuseActiveModule;
                    var previousActiveExports = globalThis.__optimuseActiveModuleExports;
                    var previousModule = callState.currentModule;
                    var previousExports = callState.currentModuleExports;
                    globalThis.__optimuseActiveModule = module;
                    globalThis.__optimuseActiveModuleExports = exports;
                    callState.currentModule = module;
                    callState.currentModuleExports = exports;
                    try {{
                        mainFactory(module, exports, require, callRuntime);
                    }} catch (error) {{
                        delete moduleCache[mainModuleKey];
                        throw error;
                    }} finally {{
                        callState.currentModule = previousModule;
                        callState.currentModuleExports = previousExports;
                        globalThis.__optimuseActiveModule = previousActiveModule;
                        globalThis.__optimuseActiveModuleExports = previousActiveExports;
                    }}
                }} else {{
                    if (exports == null) {{
                        exports = {{}};
                        module.exports = exports;
                    }}
                    markStage('reuse_main_script');
                }}
                var rootExports = module.exports || exports || {{}};
                __optimuseTagModuleExports(screenPath || '<root>', rootExports);

                var inlineFunctionName = readCallValue('__optimuse_inline_function_name', '');
                var inlineFunctionSource = readCallValue('__optimuse_inline_function_source', '');
                if (inlineFunctionName && inlineFunctionSource) {{
                    markStage('evaluate_inline_hook_function');
                    var inlineFunction = eval('(' + inlineFunctionSource + ')');
                    if (typeof inlineFunction !== 'function') {{
                        throw new Error('inline hook source did not evaluate to function');
                    }}
                    rootExports[inlineFunctionName] = inlineFunction;
                    module.exports[inlineFunctionName] = inlineFunction;
                }}

                var targetFunction = __optimuseFindTargetFunction(rootExports, module, targetFunctionName);
                if (typeof targetFunction !== 'function') {{
                    emitError(
                        "Function '" +
                            targetFunctionName +
                            "' not found in script. Available functions: " +
                            __optimuseBuildAvailableFunctions(rootExports, module).join(', ')
                    );
                    return;
                }}
                markStage('invoke_target_function');
                var invokePreviousActiveModule = globalThis.__optimuseActiveModule;
                var invokePreviousActiveExports = globalThis.__optimuseActiveModuleExports;
                var previousModule = callState.currentModule;
                var previousExports = callState.currentModuleExports;
                globalThis.__optimuseActiveModule = module;
                globalThis.__optimuseActiveModuleExports = rootExports;
                callState.currentModule = module;
                callState.currentModuleExports = rootExports;
                var functionResult;
                try {{
                    functionResult = targetFunction(params);
                }} finally {{
                    callState.currentModule = previousModule;
                    callState.currentModuleExports = previousExports;
                    globalThis.__optimuseActiveModule = invokePreviousActiveModule;
                    globalThis.__optimuseActiveModuleExports = invokePreviousActiveExports;
                }}
                markStage('handle_function_result');
                if (!callRuntime.handleAsync(functionResult)) {{
                    complete(functionResult);
                }}
            }} catch (error) {{
                var runtimeContext = typeof globalThis.__optimuseBuildRuntimeContext === 'function'
                    ? __optimuseText(globalThis.__optimuseBuildRuntimeContext(callId))
                    : '';
                emitError(
                    'Script error: ' +
                        __optimuseText(error && error.message ? error.message : error) +
                        (runtimeContext ? '\nRuntime Context: ' + runtimeContext : '') +
                        (error && error.stack ? '\nStack: ' + __optimuseText(error.stack) : '')
                );
            }}
        }}

        {}
        {}
        {}
        {}
        {}
        {}
        {}
        {}
        {}
        {}
        {}
        {}
        {}
        "#,
        JsInitRuntimeScriptBuilder::buildRuntimeBootstrapScript(),
        cleanOnExitDirJson,
        executionPreludeJson,
        buildJavaClassBridgeDefinition(),
        buildComposeDslContextBridgeDefinition(),
        buildToolPkgApiRuntimeScript(),
        buildToolPkgRegistrationBridgeScript(false),
        getJsToolsDefinition(),
        getJsThirdPartyLibraries(),
        loadPluginConfigJs(),
        loadRuntimeContextJs(),
        loadCryptoJs(),
        loadJimpJs(),
        loadUINodeJs(),
        loadAndroidUtilsJs(),
        loadOkHttp3Js(),
        loadPakoJs(),
        JsExecutionScriptBuilder::buildExecutionRuntimeBridgeScript()
    )
}
