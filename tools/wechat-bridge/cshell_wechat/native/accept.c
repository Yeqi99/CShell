#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern volatile int state[];
extern unsigned int tls_index[];
extern U identity[],ticket[],empty[];
extern void get_coro(U*);
extern void get_svc(U,U*);
extern void get_verify(U,U*);
extern void build_verify(U,void*,void*,int,int,int,void*,void*,void*);
extern void destroy_result(void*);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int claim(void){int old=1,zero=0;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(state[0]):"r"(zero):"memory");return old==1;}
static int ready(void){void**slots;__asm__ __volatile__("movq %%gs:0x58,%0":"=r"(slots));if(!slots||*tls_index>=64)return 0;char*s=slots[*tls_index];if(!s)return 0;U*p=*(U**)(s+0x1f0);return p&&p[0]&&p[1]&&*(volatile int*)(p[1]+8)>0;}
static void release(U*p){char*c=(char*)p[1];if(!c)return;if(add((int*)(c+8),-1)==1){void**v=*(void***)c;((void(*)(void*))v[0])(c);if(add((int*)(c+12),-1)==1){v=*(void***)c;((void(*)(void*))v[1])(c);}}}
void enter(GumInvocationContext*ic){
 add(state+2,1);
 if(!state[0])goto exit;
 if(!ready()){add(state+5,1);goto exit;}
 if(!claim())goto exit;
 U coro[2]={0},svc[2]={0},verify[2]={0},result[14]={0};
 state[1]=1;state[3]=1;get_coro(coro);if(!coro[0])goto done;
 state[3]=2;get_svc(coro[0],svc);if(!svc[0])goto done;
 state[3]=3;get_verify(svc[0],verify);if(!verify[0])goto done;
 state[3]=4;state[4]++;
 build_verify(verify[0],result,identity,3,30,0,ticket,empty,empty);
 state[3]=5;destroy_result(result);state[3]=6;
 done:release(verify);release(svc);release(coro);state[1]=2;
 exit:add(state+2,-1);
}
