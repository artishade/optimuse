#include "optimuse_lvgl.h"
#include "lvgl.h"
#include <emscripten.h>
#include <stdint.h>
static uint16_t framebuffer[320 * 240];
static unsigned generation;
EM_JS(void, report_action, (const char *value), {
    if (Module.onAction) Module.onAction(UTF8ToString(value));
});
static void flush(const optimuse_lvgl_area_t *a, const uint8_t *pixels, size_t length, void *user) {
    (void)user;
    size_t offset = 0;
    for(int y=a->y1;y<=a->y2;y++) for(int x=a->x1;x<=a->x2;x++) {
        if(offset + 1 >= length) return;
        if(x>=0 && x<320 && y>=0 && y<240) framebuffer[y*320+x]=pixels[offset]|((uint16_t)pixels[offset+1]<<8);
        offset+=2;
    }
    generation++;
}
static void action(const char *value, void *user) {
    (void)user; report_action(value);
}
EMSCRIPTEN_KEEPALIVE int simulator_init(void) {return optimuse_lvgl_init(320,240,flush,0,action,0);}
EMSCRIPTEN_KEEPALIVE const uint16_t *simulator_frame(void) {return framebuffer;}
EMSCRIPTEN_KEEPALIVE unsigned simulator_generation(void) {return generation;}
EMSCRIPTEN_KEEPALIVE unsigned simulator_heap_used(void) {lv_mem_monitor_t m; lv_mem_monitor(&m);return m.total_size-m.free_size;}
EMSCRIPTEN_KEEPALIVE void simulator_touch(int x,int y,int down) {optimuse_lvgl_set_touch(x,y,down!=0);}
