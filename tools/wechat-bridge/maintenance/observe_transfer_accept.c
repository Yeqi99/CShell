/* Passive call-site observation only. Does not read payment tickets or invoke receipt. */
#include <gum/guminterceptor.h>
#include <stdint.h>
extern unsigned char storage[];
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
void on_enter(GumInvocationContext*ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(!s[0])goto done;
 int old=0,one=1;
 __asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(s[2]):"r"(one):"memory");
 if(old)goto done;
 *(uint64_t*)(storage+64)=(uint64_t)gum_invocation_context_get_return_address(ic);
 __asm__ __volatile__("":::"memory");s[2]=2;
done:add(s+1,-1);
}
