#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
typedef struct {
    uint8_t type,parent; uint16_t x,y,w,h; uint32_t color;
    uint8_t radius,value,font;
    const char *text,*action,*hold,*binding;
} optimuse_packed_node_t;
typedef struct { char id[24],left[24],right[24]; uint32_t color; uint8_t count; const uint8_t *nodes; } optimuse_packed_page_t;
void optimuse_store_init(void);
bool optimuse_store_poll(void);
const char *optimuse_store_entry(void);
bool optimuse_store_page(const char *id, optimuse_packed_page_t *page);
const uint8_t *optimuse_store_node(const uint8_t *data,optimuse_packed_node_t *node,char *strings);
int optimuse_store_begin(size_t length);
int optimuse_store_write(const uint8_t *data,size_t length);
int optimuse_store_finish(void);
void optimuse_store_abort(void);
unsigned optimuse_store_revision(void);
bool optimuse_store_validate(const uint8_t *data,size_t length);
