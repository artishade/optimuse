#pragma once
#include <stdbool.h>

typedef enum {
    OPTIMUSE_EMOJI_MONO = 0,
    OPTIMUSE_EMOJI_GOOGLE = 1,
    OPTIMUSE_EMOJI_STYLE_COUNT
} optimuse_emoji_style_t;

void optimuse_emoji_init(void);
unsigned optimuse_emoji_style(void);
bool optimuse_emoji_color_available(void);
/* Persist before applying; a failure leaves the current style intact. */
bool optimuse_emoji_set_style(unsigned style);
