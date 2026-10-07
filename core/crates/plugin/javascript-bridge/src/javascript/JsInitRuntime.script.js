(function() {
    var root = typeof globalThis !== 'undefined'
        ? globalThis
        : (typeof window !== 'undefined' ? window : this);
    var windowRef = typeof window !== 'undefined' ? window : root;

    function expose(name, value) {
        var key = name == null ? '' : String(name).trim();
        if (!key || value === undefined) {
            return;
        }
        root[key] = value;
        windowRef[key] = value;
    }

    expose('__optimuseExpose', expose);
    root.window = windowRef;

    function ensureCallRegistry() {
        var registry = root.__optimuseExecutionCallRegistry;
        if (!registry || typeof registry !== 'object') {
            registry = {};
            root.__optimuseExecutionCallRegistry = registry;
        }
        return registry;
    }

    function normalizeCallId(callId) {
        return callId == null ? '' : String(callId).trim();
    }

    function getCallState(callId) {
        var resolvedCallId = normalizeCallId(callId);
        if (!resolvedCallId) {
            return null;
        }
        return ensureCallRegistry()[resolvedCallId] || null;
    }

    function registerCallSession(callId, params) {
        var resolvedCallId = normalizeCallId(callId);
        if (!resolvedCallId) {
            throw new Error('callId is required');
        }
        var registry = ensureCallRegistry();
        var state = registry[resolvedCallId];
        var callState = state && typeof state === 'object' ? state : {};
        callState.callId = resolvedCallId;
        callState.params = params && typeof params === 'object' ? params : {};
        callState.completed = false;
        callState.resultCompleted = false;
        callState.detached = false;
        callState.detachedCleanup = null;
        callState.pendingReferences = 0;
        callState.safetyTimeout = null;
        callState.safetyTimeoutFinal = null;
        callState.lastExecStage = '';
        callState.lastExecFunction = '';
        callState.lastModulePath = '';
        callState.lastRequireRequest = '';
        callState.lastRequireFrom = '';
        callState.lastRequireResolved = '';
        callState.currentModule = null;
        callState.currentModuleExports = null;
        callState.timerIds = {};
        callState.previousCallId = '';
        callState.previousCallRuntime = null;
        registry[resolvedCallId] = callState;
        return callState;
    }

    function registerCallTimer(callId, timerId) {
        var callState = getCallState(callId);
        if (!callState) {
            return;
        }
        if (!callState.timerIds || typeof callState.timerIds !== 'object') {
            callState.timerIds = {};
        }
        callState.timerIds[String(timerId)] = true;
        callState.pendingReferences += 1;
    }

    function unregisterCallTimer(callId, timerId) {
        var callState = getCallState(callId);
        if (!callState || !callState.timerIds || typeof callState.timerIds !== 'object') {
            return;
        }
        var key = String(timerId);
        if (!callState.timerIds[key]) return;
        delete callState.timerIds[key];
        releaseCallReference(callId);
    }

    function retainCallReference(callId) {
        var callState = getCallState(callId);
        if (callState) callState.pendingReferences = Number(callState.pendingReferences || 0) + 1;
    }

    function releaseCallReference(callId) {
        var callState = getCallState(callId);
        if (!callState) return;
        callState.pendingReferences = Math.max(0, Number(callState.pendingReferences || 0) - 1);
    }

    /** Finalizes one detached call after its queued JavaScript jobs are delivered. */
    function finalizeDetachedCall(callId) {
        var callState = getCallState(callId);
        if (!callState || !callState.detached || Number(callState.pendingReferences || 0) > 0) {
            return false;
        }
        if (typeof callState.detachedCleanup === 'function') {
            try {
                callState.detachedCleanup();
            } catch (_cleanupError) {
            }
            callState.detachedCleanup = null;
        }
        cleanupCallSession(callId);
        return true;
    }

    function detachedCallIds() {
        var registry = ensureCallRegistry();
        var result = [];
        Object.keys(registry).forEach(function(callId) {
            var state = registry[callId];
            if (state && state.detached && Number(state.pendingReferences || 0) > 0) result.push(callId);
        });
        return result;
    }

    function activateCall(callId) {
        var state = getCallState(callId);
        if (!state || state.completed) return false;
        root.__optimuseCurrentCallId = callId;
        root.__optimuse_call_runtime_ref = state.callRuntime;
        return true;
    }

    /** Activates one detached call before its queued JavaScript jobs are resumed. */
    function prepareDetachedCall(callId) {
        var state = getCallState(callId);
        if (!state || state.completed || !state.detached || Number(state.pendingReferences || 0) <= 0) {
            return false;
        }
        return activateCall(callId);
    }

    function clearCallTimers(callState) {
        if (!callState || !callState.timerIds || typeof callState.timerIds !== 'object') {
            return;
        }
        var timerIds = Object.keys(callState.timerIds);
        for (var index = 0; index < timerIds.length; index += 1) {
            var timerId = timerIds[index];
            try {
                delete windowRef[timerId];
            } catch (_deleteTimerError) {
                windowRef[timerId] = undefined;
            }
        }
        callState.timerIds = {};
    }

    function cleanupCallSession(callId) {
        var resolvedCallId = normalizeCallId(callId);
        if (!resolvedCallId) {
            return;
        }
        var registry = ensureCallRegistry();
        clearCallTimers(registry[resolvedCallId]);
        delete registry[resolvedCallId];
    }

    function cancelCallSession(callId) {
        var resolvedCallId = normalizeCallId(callId);
        if (!resolvedCallId) {
            return;
        }
        var callState = getCallState(resolvedCallId);
        if (!callState) {
            return;
        }
        callState.completed = true;
        if (root.__optimuseCurrentCallId === resolvedCallId) {
            root.__optimuseCurrentCallId = normalizeCallId(callState.previousCallId);
        }
        if (root.__optimuse_call_runtime_ref === callState.callRuntime) {
            if (callState.previousCallRuntime && typeof callState.previousCallRuntime === 'object') {
                root.__optimuse_call_runtime_ref = callState.previousCallRuntime;
            } else {
                delete root.__optimuse_call_runtime_ref;
            }
        }
        cleanupCallSession(resolvedCallId);
    }

    function buildRuntimeContext(callId) {
        var callState = getCallState(callId);
        var mapping = [
            ['lastExecStage', 'stage'],
            ['lastExecFunction', 'function'],
            ['lastModulePath', 'module'],
            ['lastRequireRequest', 'require'],
            ['lastRequireFrom', 'from'],
            ['lastRequireResolved', 'resolved']
        ];
        var parts = [];
        for (var i = 0; i < mapping.length; i += 1) {
            var key = mapping[i][0];
            var label = mapping[i][1];
            var value = callState ? callState[key] : undefined;
            if (value != null && String(value).trim().length > 0) {
                parts.push(label + '=' + String(value));
            }
        }
        return parts.join(', ');
    }

    expose('__optimuseGetCallState', getCallState);
    expose('__optimuseRegisterCallSession', registerCallSession);
    expose('__optimuseRegisterCallTimer', registerCallTimer);
    expose('__optimuseUnregisterCallTimer', unregisterCallTimer);
    expose('__optimuseRetainCallReference', retainCallReference);
    expose('__optimuseReleaseCallReference', releaseCallReference);
    expose('__optimuseGetDetachedCallIds', detachedCallIds);
    expose('__optimuseActivateCall', activateCall);
    expose('__optimusePrepareDetachedCall', prepareDetachedCall);
    expose('__optimuseFinalizeDetachedCall', finalizeDetachedCall);
    expose('__optimuseNotifyDetachedCall', function(callId) {
        if (typeof root.__optimuseNativeNotifyDetachedCall === 'function') {
            root.__optimuseNativeNotifyDetachedCall(normalizeCallId(callId));
        }
    });
    expose('__optimuseCleanupCallSession', cleanupCallSession);
    expose('__optimuseCancelCallSession', cancelCallSession);
    expose('__optimuseBuildRuntimeContext', buildRuntimeContext);

    expose('__optimuseGetActiveModuleExports', function() {
        if (
            root.__optimuseActiveModule &&
            typeof root.__optimuseActiveModule === 'object' &&
            root.__optimuseActiveModule.exports
        ) {
            return root.__optimuseActiveModule.exports;
        }
        var exportsRef = root.__optimuseActiveModuleExports;
        return exportsRef && typeof exportsRef === 'object' ? exportsRef : exportsRef || null;
    });
})();
