/* Developer-only, passive observation of one filehelper app-message.
 * No message mutation, network call, or JavaScript entry on the client thread. */
#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern unsigned char storage[];
extern int rpm(void*,const void*,void*,U,U*);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int readmem(U a,void*b,U n){U got=0;return a>0xffff&&rpm((void*)(U)-1,(void*)a,b,n,&got)&&got==n;}
static int string(U a,char*out,U max){
 U v[4];if(!readmem(a,v,32)||v[2]>max||v[3]<v[2]||v[3]>1048576)return -1;
 if(v[2]&&!readmem(v[3]<16?a:v[0],out,v[2]))return -1;
 out[v[2]]=0;return (int)v[2];
}
void on_enter(GumInvocationContext *ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(!s[0]||s[2])goto done;
 U bounds[2],vec=(U)gum_invocation_context_get_nth_argument(ic,2);
 if(!readmem(vec,bounds,16)||bounds[1]<bounds[0]||bounds[1]-bounds[0]>16*64||(bounds[1]-bounds[0])%16)goto done;
 for(U p=bounds[0];p<bounds[1];p+=16){
  U m=0;unsigned int kind=0;char target[128];
  if(!readmem(p,&m,8)||!readmem(m+0x118,&kind,4)||kind!=49||string(m+0xb0,target,127)!=10)continue;
  char expected[]="filehelper";int equal=1;for(int i=0;i<10;i++)if(target[i]!=expected[i])equal=0;
  if(!equal)continue;
  int old=0,one=1;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(s[2]):"r"(one):"memory");
  if(old)break;
  /* Common message extent, verified against its constructor and allocation. */
  s[3]=readmem(m,storage+64,0x758);
  int count=0;
  for(U offset=0;offset+32<=0x758&&count<16;offset+=8){
   char value[257];int n=string(m+offset,value,256);if(n<=0)continue;
   int printable=1;for(int i=0;i<n;i++)if((unsigned char)value[i]<32)printable=0;
   if(!printable)continue;
   unsigned char*out=storage+2048+count*272;*(unsigned int*)out=(unsigned int)offset;*(unsigned int*)(out+4)=n;
   for(int i=0;i<=n;i++)out[8+i]=value[i];count++;
  }
  s[4]=count;__asm__ __volatile__("":::"memory");s[2]=2;break;
 }
done:add(s+1,-1);
}
