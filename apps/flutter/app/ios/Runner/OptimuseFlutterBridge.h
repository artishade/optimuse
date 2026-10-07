#ifndef OptimuseFlutterBridge_h
#define OptimuseFlutterBridge_h

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

void *optimuse_flutter_bridge_create(void);
char *optimuse_ios_ish_terminal_call(const char *command, const char *request_json);
void optimuse_ios_ish_terminal_free(char *value);
void *optimuse_flutter_bridge_create_with_storage_roots(
    const char *runtime_root,
    const char *workspace_root);
char *optimuse_flutter_bridge_create_error(void);
/// Reads the client bootstrap record before the native Runtime is created.
char *optimuse_flutter_bridge_runtime_bootstrap_read(const char *default_runtime_root);
/// Writes the client bootstrap record before the native Runtime is created.
char *optimuse_flutter_bridge_runtime_bootstrap_write(
    const char *default_runtime_root,
    const char *content);
/// Creates a retained direct Dart FFI connection.
char *optimuse_flutter_bridge_ffi_connect(void *handle);
void optimuse_flutter_bridge_destroy(void *handle);
char *optimuse_flutter_bridge_emit_runtime_event(void *handle, const char *event_json);
void optimuse_flutter_bridge_free_string(char *value);

#ifdef __cplusplus
}
#endif

#endif
