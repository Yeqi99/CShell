/* Passive observation only. Never invokes receipt or changes native objects.
 * Only lengths and numeric return fields leave this module; tickets stay private. */
#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern unsigned char storage[];
extern int rpm(void*,const void*,void*,U,U*);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int readmem(U a,void*b,U n){U got=0;return a>0xffff&&rpm((void*)(U)-1,(void*)a,b,n,&got)&&got==n;}
static int string_length(U a){U v[4];if(!readmem(a,v,32)||v[2]>512||v[3]<v[2]||v[3]>1048576)return -1;return (int)v[2];}
void on_enter(GumInvocationContext*ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(!s[0])goto done;
 int old=0,one=1;
 __asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(s[2]):"r"(one):"memory");
 if(old)goto done;
 U shared=(U)gum_invocation_context_get_nth_argument(ic,2),model=0;
 *(U*)(storage+64)=(U)gum_invocation_context_get_nth_argument(ic,1);
 s[3]=1; /* Hold the hook through the matching leave, including coroutine waits. */
 s[4]=-1;s[5]=-1;s[6]=0;
 if(readmem(shared,&model,8)){
  s[4]=string_length(model+0x210);s[5]=string_length(model+0x1f0);
  s[6]=readmem(model+0x158,storage+32,4);
 }
done:add(s+1,-1);
}
void on_leave(GumInvocationContext*ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(s[2]!=1||(U)gum_invocation_context_get_return_value(ic)!=*(U*)(storage+64))goto done;
 U result=0; s[9]=0;s[10]=-1;
 if(readmem(*(U*)(storage+64),&result,8)){
  s[9]=readmem(result+0x28,storage+44,4);
  U v[4];char digits[16];
  if(readmem(result+0x50,v,32)&&v[2]>0&&v[2]<16&&v[3]>=v[2]&&v[3]<=1048576&&
     readmem(v[3]<16?result+0x50:v[0],digits,v[2])){
   int valid=1;for(U i=0;i<v[2];i++)if(digits[i]<'0'||digits[i]>'9')valid=0;
   if(valid){s[10]=(int)v[2];for(U i=0;i<v[2];i++)storage[80+i]=digits[i];}
  }
 }
 *(U*)(storage+64)=0;__asm__ __volatile__("":::"memory");s[2]=2;s[3]=0;
done:add(s+1,-1);
}
