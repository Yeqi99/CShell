/* Call locations only; no tickets, arguments, mutations or native invocation. */
#include <gum/guminterceptor.h>
#include <stdint.h>
extern unsigned char storage[];
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static void record(GumInvocationContext*ic,int kind){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(s[0]){
  int i=add(s+2,1);
  if(i<128){unsigned char*out=storage+64+i*16;
   *(uint32_t*)out=kind;
   *(uint64_t*)(out+8)=(uint64_t)gum_invocation_context_get_return_address(ic);
  }
 }
 add(s+1,-1);
}
void red_packet_link(GumInvocationContext*ic){record(ic,1);}
void accept_transfer(GumInvocationContext*ic){record(ic,2);}
void check_transfer(GumInvocationContext*ic){record(ic,3);}
void web_transfer(GumInvocationContext*ic){record(ic,4);}
void red_detail_cache_a(GumInvocationContext*ic){record(ic,5);}
void red_detail_cache_b(GumInvocationContext*ic){record(ic,6);}
void red_detail_cache_c(GumInvocationContext*ic){record(ic,7);}
void red_open_button(GumInvocationContext*ic){record(ic,8);}
