/* Experimental exact-build comment submission, not registered as a tool yet.
 * The ordinary Moments service is 0x1087ac0, NOT 0x2ed24b0.
 * This call can wait for network work. Keep the module alive until callbacks drain.
 * Default initialization follows 4.1.15.50 at RVA 0x4cc24a8.
 * All allocated native members are released using its shared_ptr destructor. */
#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern volatile int state[];
extern unsigned int tls_index[];
extern U input_len[],input_id[],model_vtable[],observed[];
extern unsigned char input_text[];
extern void* alloc(U);
extern unsigned char parse(U,U*);
extern unsigned char valid(U);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int claim(void){int old=1,zero=0;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(state[0]):"r"(zero):"memory");return old==1;}
static int ready(void){void**slots;__asm__ __volatile__("movq %%gs:0x58,%0":"=r"(slots));if(!slots||*tls_index>=64)return 0;char*s=slots[*tls_index];if(!s)return 0;U*p=*(U**)(s+0x1f0);return p&&p[0]&&p[1]&&*(volatile int*)(p[1]+8)>0;}
static void release(char*c){if(add((int*)(c+8),-1)==1){void**v=*(void***)c;((void(*)(void*))v[0])(c);if(add((int*)(c+12),-1)==1){v=*(void***)c;((void(*)(void*))v[1])(c);}}}

extern unsigned char comment_text[];
extern U comment_len[];
extern void get_coro(U*);
extern void get_svc(U,U*);
extern void get_comments(U,U*);
extern unsigned char comment(U,U*,U*,U*,U*);
extern void native_free(U,U);
static void release_pair(U*p){if(p[1])release((char*)p[1]);}
void enter(GumInvocationContext*ic){
 add(state+2,1);if(!state[0]||!ready()||!claim())goto exit;
 state[1]=1;
 char*c=alloc(0x3b0);for(int i=0;i<0x3b0;i++)c[i]=0;
 *(U*)c=(U)model_vtable;*(U*)(c+8)=0x100000001ULL;
 char*d=c+16;
 const int caps[]={0x20,0x40,0x140,0x160,0x180,0x1a8,0x1d0,0x1f8,0x220,0x240,0x260,0x280,0x2a8,0x2c8,0x2e8};
 for(int i=0;i<15;i++)*(U*)(d+caps[i])=15;
 *(U*)d=*input_id;
 U text[4]={(U)input_text,0,*input_len,*input_len<16?16:*input_len};
 observed[0]=parse((U)d,text);observed[1]=valid((U)d);
 observed[2]=*(U*)d;observed[3]=*(U*)(d+0x1a0);observed[4]=*(U*)(d+0x300)!=0;

 if(observed[0] && observed[1] && observed[2]==*input_id){
 U coro[2]={0},svc[2]={0},sns[2]={0};
 get_coro(coro);if(coro[0])get_svc(coro[0],svc);if(svc[0])get_comments(svc[0],sns);
 if(sns[0]){
 U copy[2]={(U)d,(U)c},reply[2]={0},out[4]={0,0,0,15};
 U content[10]={(U)comment_text,0,*comment_len,*comment_len<16?16:*comment_len,0,0,0,0,0,0};
 add((int*)(c+8),1);observed[6]=1;
 observed[5]=comment(sns[0],copy,content,reply,out);observed[6]=2;
 observed[7]=out[2];
 if(out[3]>=16){U ptr=out[0],size=out[3]+1;if(size>=4096){ptr=*(U*)(ptr-8);size=out[3]+40;}native_free(ptr,size);}
 }
 release_pair(sns);release_pair(svc);release_pair(coro);
 }
 release(c);state[1]=2;
 exit:add(state+2,-1);
}
