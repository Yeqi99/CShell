#include <gum/guminterceptor.h>
#include <glib.h>
#include <stdint.h>
typedef uint64_t U;
extern volatile U state[];
extern char recipient[];
extern char content[];
extern unsigned short attachment_path[];
extern U attachment_size[];
extern int attachment_mode[];
extern void get_coro(U *out);
extern unsigned int tls_index[];

/* This exact module dereferences TLS slot +0x1f0 in 0x4a09e0.
 * get_coro is also called on threads without that sending context. */
int context_ready(void **slots, unsigned int index){
 if(!slots || index>=64)return 0;
 char *slot=slots[index];if(!slot)return 0;
 U *sp=*(U**)(slot+0x1f0);
 if(!sp || !sp[0] || !sp[1])return 0;
 return *(volatile int*)(sp[1]+8)>0;
}
static int sending_context_ready(void){
 void **slots;
 __asm__ __volatile__("movq %%gs:0x58, %0":"=r"(slots));
 return context_ready(slots,*tls_index);
}
extern void get_svc(U context,U *out);
extern void get_ctx(U service,U *out);
extern void make_text(U *out);
extern void do_send(U context,void *result,void *vector,int flag);
extern void *chat_alloc(U size);
static int atomic_add(volatile int *p,int v){__asm__ __volatile__("lock xaddl %0, %1" : "+r"(v), "+m"(*p) : : "memory");return v;}
static int claim(volatile int *p){int expected=1;int replacement=0;__asm__ __volatile__("lock cmpxchgl %2, %1" : "+a"(expected), "+m"(*p) : "r"(replacement) : "memory");return expected==1;}

static void clear(void *p,U n){unsigned char *b=p;while(n--)*b++=0;}
static U length(char *p){U n=0;while(p[n] && n<4096)n++;return n;}
static int assign(void *field,char *text){
 U n=length(text);U cap=n<=15?15:(n|15);char *p=field;
 if(n>15){p=chat_alloc(cap+1);if(!p)return 0;*(void**)field=p;}
 for(U i=0;i<=n;i++)p[i]=text[i];
 *(U*)((char*)field+16)=n;*(U*)((char*)field+24)=cap;return 1;
}
static int assign_path(void *field){
 U n=0;while(attachment_path[n]&&n<1024)n++;
 if(!n||n>=1024)return 0;
 U cap=n<=7?7:(n|7);unsigned short *p=field;
 if(n>7){p=chat_alloc((cap+1)*2);if(!p)return 0;*(void**)field=p;}
 for(U i=0;i<=n;i++)p[i]=attachment_path[i];
 *(U*)((char*)field+16)=n;*(U*)((char*)field+24)=cap;return 1;
}
static void release(U *sp){
 char *c=(char*)sp[1];if(!c)return;
 if(atomic_add((int*)(c+8),-1)==1){
  void **v=*(void***)c;((void(*)(void*))v[0])(c);
  if(atomic_add((int*)(c+12),-1)==1){v=*(void***)c;((void(*)(void*))v[1])(c);}
 }
 sp[0]=sp[1]=0;
}
void on_enter(GumInvocationContext *ic){
 atomic_add((int*)&state[7],1);
 if(!state[0])goto leave;
 if(!sending_context_ready()){atomic_add((int*)&state[5],1);goto leave;}
 if(!claim((int*)&state[0]))goto leave;
 U coro[2]={0},svc[2]={0},ctx[2]={0},msg[2]={0},vec[3]={0};
 U result[10];clear(result,sizeof(result));
 state[1]=1;state[2]=gum_invocation_context_get_thread_id(ic);
 state[3]=1;get_coro(coro);if(!coro[0])goto done;
 state[3]=2;get_svc(coro[0],svc);if(!svc[0])goto done;
 state[3]=3;get_ctx(svc[0],ctx);if(!ctx[0])goto done;
 state[3]=4;make_text(msg);if(!msg[0]||!msg[1])goto done;
 state[3]=5;
 if(!assign((char*)msg[0]+0xb0,recipient))goto done;
 if(*attachment_mode){
  if(!assign((char*)msg[0]+0x1a8,content)||!assign_path((char*)msg[0]+0x120))goto done;
  *(U*)((char*)msg[0]+0x118)=0x600000031ULL;
  *(U*)((char*)msg[0]+0x1c8)=*attachment_size;
 }else{
  if(!assign((char*)msg[0]+0x758,content))goto done;
  *(U*)((char*)msg[0]+0x118)=1;
 }
 *(unsigned int*)((char*)msg[0]+0x9c)=1;
 vec[0]=(U)msg;vec[1]=(U)(msg+2);vec[2]=vec[1];
 state[3]=6;do_send(ctx[0],result,vec,1);state[3]=7;
 state[4]=1; /* native call returned; NOT a delivery confirmation */
done:
 release(msg);release(ctx);release(svc);release(coro);
 state[1]=2;
leave:
 atomic_add((int*)&state[7],-1);
}
