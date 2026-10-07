use crate::BridgeExports::*;
use crate::BridgeExports::{last_create_error, panic_payload_message, set_last_create_error};
use crate::OptimuseFlutterBridge;
use jni::objects::{JClass, JObject, JString};
use jni::sys::{jlong, jstring};
use jni::JNIEnv;
use std::ffi::CStr;
use std::path::PathBuf;
use std::sync::Arc;

/// Accepts the borrowed pipe descriptors delivered by the Android Binder endpoint.
#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_acceptPluginSdkPipes(
    mut env: JNIEnv,
    _class: JClass,
    reader: jni::sys::jint,
    writer: jni::sys::jint,
) {
    if let Err(error) = optimuse_host_android_native::acceptAndroidPluginSdkPipes(reader, writer) {
        let _ = env.throw_new("java/lang/IllegalStateException", error.to_string());
    }
}

/// Decodes an exact JNI boolean literal and rejects invalid owner input.
fn jni_bool_arg(env: &mut JNIEnv, value: &JString, name: &str) -> Result<bool, String> {
    let value = env
        .get_string(value)
        .map_err(|error| format!("invalid JNI {name}: {error}"))?;
    let value = value
        .to_str()
        .map_err(|error| format!("invalid JNI {name}: {error}"))?;
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        other => Err(format!(
            "invalid JNI {name}: expected true or false, got {other}"
        )),
    }
}

/// Creates the reference-counted runtime and installs Android's Java host services.
#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_create(
    mut env: JNIEnv,
    _class: JClass,
    runtime_root: JString,
    workspace_root: JString,
    device_model: JString,
    host: JObject,
) -> jlong {
    let runtime_root = match env.get_string(&runtime_root) {
        Ok(value) => PathBuf::from(String::from(value)),
        Err(error) => {
            set_last_create_error(format!("runtime storage root is invalid: {error}"));
            return 0;
        }
    };
    let workspace_root = match env.get_string(&workspace_root) {
        Ok(value) => PathBuf::from(String::from(value)),
        Err(error) => {
            set_last_create_error(format!("workspace storage root is invalid: {error}"));
            return 0;
        }
    };
    let device_model: String = match env.get_string(&device_model) {
        Ok(value) => value.into(),
        Err(error) => {
            set_last_create_error(format!("Android startup device model is invalid: {error}"));
            return 0;
        }
    };
    if device_model.trim().is_empty() {
        set_last_create_error("Android startup device model must not be empty".to_string());
        return 0;
    }
    let java_vm = match env.get_java_vm() {
        Ok(value) => value,
        Err(error) => {
            set_last_create_error(format!("Android Java VM is unavailable: {error}"));
            return 0;
        }
    };
    let host = match env.new_global_ref(host) {
        Ok(value) => value,
        Err(error) => {
            set_last_create_error(format!("Android host secret bridge is invalid: {error}"));
            return 0;
        }
    };
    if let Err(error) = optimuse_host_android_native::setAndroidHostSecretStoreBridge(java_vm, host) {
        set_last_create_error(error.to_string());
        return 0;
    }
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        OptimuseFlutterBridge::new_with_storage_roots(runtime_root, workspace_root, device_model)
    })) {
        Ok(Ok(bridge)) => Arc::into_raw(Arc::new(bridge)) as jlong,
        Ok(Err(error)) => {
            optimuse_host_android_native::clearAndroidHostSecretStoreBridge();
            set_last_create_error(error);
            0
        }
        Err(payload) => {
            optimuse_host_android_native::clearAndroidHostSecretStoreBridge();
            set_last_create_error(format!(
                "FATAL_CORE_PANIC: {}",
                panic_payload_message(payload.as_ref())
            ));
            0
        }
    }
}

#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_createError(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    new_java_string(
        env,
        &last_create_error()
            .lock()
            .expect("create error lock")
            .clone(),
    )
}

/// Reads the client bootstrap record before the Android Runtime is created.
#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_runtimeBootstrapRead(
    mut env: JNIEnv,
    _class: JClass,
    default_runtime_root: JString,
) -> jstring {
    let default_runtime_root = match env.get_string(&default_runtime_root) {
        Ok(value) => PathBuf::from(String::from(value)),
        Err(error) => {
            return new_java_string(
                env,
                &serde_json::json!({
                    "ok": false,
                    "value": null,
                    "error": format!("default Runtime root is invalid: {error}"),
                })
                .to_string(),
            );
        }
    };
    new_java_string(
        env,
        &crate::PlatformRuntimeAbi::RuntimeBootstrapStore::readNativeRuntimeBootstrapConfig(
            default_runtime_root,
        ),
    )
}

/// Writes the client bootstrap record before the Android Runtime is created.
#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_runtimeBootstrapWrite(
    mut env: JNIEnv,
    _class: JClass,
    default_runtime_root: JString,
    content: JString,
) -> jstring {
    let default_runtime_root = match env.get_string(&default_runtime_root) {
        Ok(value) => PathBuf::from(String::from(value)),
        Err(error) => {
            return new_java_string(
                env,
                &serde_json::json!({
                    "ok": false,
                    "error": format!("default Runtime root is invalid: {error}"),
                })
                .to_string(),
            );
        }
    };
    let content = match env.get_string(&content) {
        Ok(value) => String::from(value),
        Err(error) => {
            return new_java_string(
                env,
                &serde_json::json!({
                    "ok": false,
                    "error": format!("runtime bootstrap config is invalid: {error}"),
                })
                .to_string(),
            );
        }
    };
    new_java_string(
        env,
        &crate::PlatformRuntimeAbi::RuntimeBootstrapStore::writeNativeRuntimeBootstrapConfig(
            default_runtime_root,
            &content,
        ),
    )
}

/// Releases the Android owner's reference while active Dart connections retain the runtime.
#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_destroy(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    optimuse_flutter_bridge_destroy(handle as *mut OptimuseFlutterBridge);
}

/// Creates one direct Dart connection while preserving Android's runtime ownership.
#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_connectCoreFfi(
    env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    let descriptor = crate::PlatformRuntimeAbi::FfiTransport::optimuse_flutter_bridge_ffi_connect(
        handle as *const OptimuseFlutterBridge,
    );
    let result = new_java_string(env, CStr::from_ptr(descriptor).to_str().expect("FFI JSON"));
    optimuse_flutter_bridge_free_string(descriptor);
    result
}

#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_emitRuntimeEvent(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    eventJson: JString,
) -> jstring {
    let Some(bridge) = (handle as *mut OptimuseFlutterBridge).as_ref() else {
        return new_java_string(env, &serde_json::json!({"ok": false}).to_string());
    };
    let eventJson = match env.get_string(&eventJson) {
        Ok(value) => String::from(value),
        Err(_) => return new_java_string(env, &serde_json::json!({"ok": false}).to_string()),
    };
    new_java_string(env, &bridge.emitRuntimeEvent(&eventJson))
}

#[no_mangle]
pub unsafe extern "system" fn Java_app_optimuse_OptimuseRuntimeNative_emitHostRuntimeEventSchedule(
    env: JNIEnv,
    _class: JClass,
    _handle: jlong,
    scheduleId: JString,
    scheduledAtMillis: jlong,
    firedAtMillis: jlong,
) -> jstring {
    let mut env = env;
    let scheduleId = match env.get_string(&scheduleId) {
        Ok(value) => String::from(value),
        Err(error) => {
            return new_java_string(
                env,
                &serde_json::json!({
                    "ok": false,
                    "error": format!("invalid JNI scheduleId: {error}"),
                })
                .to_string(),
            );
        }
    };
    let fire = optimuse_host_api::HostRuntimeEventScheduleFire {
        scheduleId,
        scheduledAtMillis: scheduledAtMillis as u64,
        firedAtMillis: firedAtMillis as u64,
    };
    match optimuse_host_android_native::emitAndroidHostRuntimeEventSchedule(fire) {
        Ok(()) => new_java_string(env, &serde_json::json!({"ok": true}).to_string()),
        Err(error) => new_java_string(
            env,
            &serde_json::json!({"ok": false, "error": error.to_string()}).to_string(),
        ),
    }
}

fn new_java_string(mut env: JNIEnv, value: &str) -> jstring {
    env.new_string(value)
        .expect("JNI string allocation must succeed")
        .into_raw()
}
