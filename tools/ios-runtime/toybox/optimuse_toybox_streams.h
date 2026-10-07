#ifndef OPTIMUSE_TOYBOX_STREAMS_H
#define OPTIMUSE_TOYBOX_STREAMS_H

extern FILE *optimuse_toybox_stdin;
extern FILE *optimuse_toybox_stdout;
extern FILE *optimuse_toybox_stderr;

#undef stdin
#undef stdout
#undef stderr
#define stdin optimuse_toybox_stdin
#define stdout optimuse_toybox_stdout
#define stderr optimuse_toybox_stderr

#endif
