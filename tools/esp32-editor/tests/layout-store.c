#include <assert.h>
#include <stdio.h>
#include "../../../apps/esp32/lvgl_port/layout_store.c"
static void reboot(void){mapped=active=NULL;active_slot=writing_slot=-1;atomic_store(&pending,-1);atomic_store(&revision,0);optimuse_store_init();}
int main(int argc,char **argv){
 assert(argc==2);FILE *file=fopen(argv[1],"rb");assert(file);uint8_t data[LIMIT];size_t size=fread(data,1,sizeof(data),file);fclose(file);
 assert(optimuse_store_validate(data,size));
 for(size_t i=0;i<size;i++)assert(!optimuse_store_validate(data,i));
 for(size_t i=16;i<size;i++){data[i]^=1;assert(!optimuse_store_validate(data,size));data[i]^=1;}
 memset(fake_flash,255,sizeof(fake_flash));reboot();assert(!optimuse_store_entry());
 assert(optimuse_store_begin(size)==0);
 for(size_t i=0;i<size;){size_t n=size-i>113?113:size-i;assert(optimuse_store_write(data+i,n)==0);i+=n;}
 assert(optimuse_store_finish()==0);assert(!optimuse_store_entry());assert(optimuse_store_begin(size)<0);
 assert(optimuse_store_poll());assert(!strcmp(optimuse_store_entry(),"home"));assert(optimuse_store_revision()==1);
 optimuse_packed_page_t page;assert(optimuse_store_page("apps",&page));assert(page.count==14);
 const uint8_t *next=page.nodes;for(unsigned i=0;i<page.count;i++){optimuse_packed_node_t node;char strings[226];next=optimuse_store_node(next,&node,strings);assert(node.w>=8&&node.h>=8);}
 // Interrupted upload cannot replace the active page, including after reboot.
 assert(optimuse_store_begin(size)==0);assert(optimuse_store_write(data,size/2)==0);optimuse_store_abort();reboot();assert(optimuse_store_revision()==1);
 data[size-1]^=1;assert(optimuse_store_begin(size)==0);assert(optimuse_store_write(data,size)==0);assert(optimuse_store_finish()<0);reboot();assert(optimuse_store_revision()==1);data[size-1]^=1;
 assert(optimuse_store_begin(size)==0);assert(optimuse_store_write(data,size)==0);assert(optimuse_store_finish()==0);reboot();assert(optimuse_store_revision()==2);assert(!strcmp(optimuse_store_entry(),"home"));
 puts("PASS C package parser, CRC, flash commit, truncation and reboot recovery");
}
