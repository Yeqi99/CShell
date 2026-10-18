#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern volatile int state[];
extern unsigned int tls_index[];
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int claim(void){int old=1,zero=0;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(state[0]):"r"(zero):"memory");return old==1;}
static int ready(void){void**slots;__asm__ __volatile__("movq %%gs:0x58,%0":"=r"(slots));if(!slots||*tls_index>=64)return 0;char*s=slots[*tls_index];if(!s)return 0;U*p=*(U**)(s+0x1f0);return p&&p[0]&&p[1]&&*(volatile int*)(p[1]+8)>0;}
static void release(U*p){char*c=(char*)p[1];if(!c)return;if(add((int*)(c+8),-1)==1){void**v=*(void***)c;((void(*)(void*))v[0])(c);if(add((int*)(c+12),-1)==1){v=*(void***)c;((void(*)(void*))v[1])(c);}}}

extern void* alloc(U);
extern void ctor(U,int);
extern U model_vtable[],input_len[];
extern unsigned char input_text[];
extern U observed[];
extern unsigned char xml_out[];
extern void serialize(U,U*);
extern void native_free(U,U);
extern void get_coro(U*);
extern void get_svc(U,U*);
extern void get_sns(U,U*);
extern unsigned char publish(U,U*);
void enter(GumInvocationContext*ic){
 add(state+2,1);if(!state[0]||!ready()||!claim())goto exit;
 state[1]=1;U model[2]={0};char*ctrl=alloc(0x2b8);
 *(U*)ctrl=(U)model_vtable;*(U*)(ctrl+8)=0x100000001ULL;
 char*data=ctrl+16;ctor((U)data,9);model[0]=(U)data;model[1]=(U)ctrl;
 state[3]=1;
 U n=*input_len;U cap=n<16?16:n;char*buf=alloc(cap+1);for(U i=0;i<n;i++)buf[i]=input_text[i];buf[n]=0;
 *(U*)(data+0x60)=(U)buf;*(U*)(data+0x70)=n;*(U*)(data+0x78)=cap;
 *(int*)(data+0x30)=2;*(int*)(data+0x84)=2;*(int*)(data+0x248)=0;
 observed[0]=*(U*)(data+0x70);observed[1]=*(int*)(data+0x30);
 observed[2]=*(int*)(data+0x84);observed[3]=*(int*)(data+0x248);
 observed[4]=*(U*)(data+0x50);observed[5]=0;
 for(U i=0;i<n;i++)if((unsigned char)buf[i]!=input_text[i])observed[5]++;
 U xml[4]={0,0,0,15};serialize((U)data,xml);observed[6]=xml[2];
char*x=(char*)(xml[3]<16?(U)xml:xml[0]);
if(xml[2]<4096){for(U i=0;i<xml[2];i++)xml_out[i]=x[i];xml_out[xml[2]]=0;}
if(xml[3]>=16){
 U allocation=xml[0],bytes=xml[3]+1;
 if(bytes>=4096){allocation=*(U*)(allocation-8);bytes=xml[3]+40;}
 native_free(allocation,bytes);
}
state[3]=2;
U coro[2]={0},svc[2]={0},sns[2]={0};
get_coro(coro);if(coro[0])get_svc(coro[0],svc);if(svc[0])get_sns(svc[0],sns);
if(sns[0] && observed[5]==0 && observed[6]>0 && observed[6]<4096){
 U copy[2]={model[0],model[1]};add((int*)(ctrl+8),1);state[4]=1;
 observed[7]=publish(sns[0],copy);state[4]=2;
}
release(sns);release(svc);release(coro);release(model);state[3]=3;state[1]=2;
 exit:add(state+2,-1);
}
