/* Passive outgoing SNS action observation. BaseRequest/auth fields are omitted. */
#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern unsigned char storage[];
extern int rpm(void*,const void*,void*,U,U*);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int readmem(U a,void*b,U n){U got=0;return a>0xffff&&rpm((void*)(U)-1,(void*)a,b,n,&got)&&got==n;}
static void copy_string(U field,unsigned char*out){
 U ptr=0,v[4];if(!readmem(field,&ptr,8)||!readmem(ptr,v,32)||v[2]>511||v[3]<v[2]||v[3]>1048576)return;
 if(v[2]&&!readmem(v[3]<16?ptr:v[0],out+4,v[2]))return;
 *(unsigned int*)out=(unsigned int)v[2];out[4+v[2]]=0;
}
void on_enter(GumInvocationContext *ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(!s[0]||s[2])goto done;
 U req=(U)gum_invocation_context_get_nth_argument(ic,1),group=0;
 if(!readmem(req+0x10,&group,8))goto done;
 int old=0,one=1;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(s[2]):"r"(one):"memory");
 if(old)goto done;
 s[3]=readmem(group,storage+64,0x40);
 if(s[3])for(int j=0;j<2;j++){
  U action=0;if(!readmem(group+0x18+j*8,&action,8))continue;
  if(!readmem(action,storage+128+j*192,0xb8))continue;
  U offsets[]={8,16,24,32,48};
  for(int i=0;i<5;i++)copy_string(action+offsets[i],storage+512+(j*5+i)*520);
 }
 __asm__ __volatile__("":::"memory");s[2]=2;
done:add(s+1,-1);
}
