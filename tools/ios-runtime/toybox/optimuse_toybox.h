#ifndef OPTIMUSE_TOYBOX_H
#define OPTIMUSE_TOYBOX_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct OptimuseToyboxResult {
  int exit_code;
  char *standard_output;
  char *standard_error;
} OptimuseToyboxResult;

/// Runs one enabled Toybox applet against the supplied workspace directory.
int optimuse_toybox_run(
    const char *working_directory,
    int argc,
    const char *const argv[],
    const char *standard_input,
    OptimuseToyboxResult *result);

/// Reports whether a named applet is compiled into the embedded Toybox runtime.
int optimuse_toybox_has_applet(const char *name);

/// Releases all caller-owned output strings returned by the Toybox runtime.
void optimuse_toybox_result_free(OptimuseToyboxResult *result);

#ifdef __cplusplus
}
#endif

#endif
