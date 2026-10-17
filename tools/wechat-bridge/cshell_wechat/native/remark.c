#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern volatile int state[];
extern unsigned int tls_index[];
extern U identity[],remark[],expected[];
extern char before_text[];
extern int write_mode[];
extern void get_coro(U*);
extern void get_svc(U,U*);
extern void get_contact(U,U*);
extern void lookup(U,U*,void*);
extern void set_remark(U,void*,void*);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int claim(void){int old=1,zero=0;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(state[0]):"r"(zero):"memory");return old==1;}
static int ready(void){void**slots;__asm__ __volatile__("movq %%gs:0x58,%0":"=r"(slots));if(!slots||*tls_index>=64)return 0;char*s=slots[*tls_index];if(!s)return 0;U*p=*(U**)(s+0x1f0);return p&&p[0]&&p[1]&&*(volatile int*)(p[1]+8)>0;}
static void release(U*p){char*c=(char*)p[1];if(!c)return;if(add((int*)(c+8),-1)==1){void**v=*(void***)c;((void(*)(void*))v[0])(c);if(add((int*)(c+12),-1)==1){v=*(void***)c;((void(*)(void*))v[1])(c);}}}
static const char* chars(U*s){return s[3]<16?(const char*)s:(const char*)s[0];}
static int equal(U*a,U*b){if(a[2]!=b[2]||a[2]>128)return 0;const char*x=chars(a),*y=chars(b);for(U i=0;i<a[2];i++)if(x[i]!=y[i])return 0;return 1;}
void enter(GumInvocationContext*ic){
 add(state+2,1);
 if(!state[0])goto exit;
 if(!ready()){add(state+5,1);goto exit;}
 if(!claim())goto exit;
 U coro[2]={0},svc[2]={0},contact[2]={0},model[2]={0};
 state[1]=1;state[3]=1;get_coro(coro);if(!coro[0])goto done;
 state[3]=2;get_svc(coro[0],svc);if(!svc[0])goto done;
 state[3]=3;get_contact(svc[0],contact);if(!contact[0])goto done;
 state[3]=4;lookup(contact[0],model,identity);if(!model[0])goto done;
 U*name=(U*)(model[0]+8),*old=(U*)(model[0]+0x78);
 if(!equal(name,identity)||old[2]>128||old[3]<old[2]){state[3]=-1;goto done;}
 const char*t=chars(old);for(U i=0;i<old[2];i++)before_text[i]=t[i];before_text[old[2]]=0;
 state[3]=5;
 if(!*write_mode)goto done;
 if(!equal(old,expected)){state[3]=-2;goto done;}
 state[4]++;set_remark(contact[0],identity,remark);state[3]=6;
 done:release(model);release(contact);release(svc);release(coro);state[1]=2;
 exit:add(state+2,-1);
}
