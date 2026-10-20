/* Passive reply ABI observation: exact authorized test Moment, one reply only.
 * The service reads reply+0 as ID and reply+0x10 as username std::string.
 * Do not copy the remainder of the object or any request authentication data. */
#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern unsigned char storage[];
extern int rpm(void*,const void*,void*,U,U*);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int readmem(U a,void*b,U n){U got=0;return a>0xffff&&rpm((void*)(U)-1,(void*)a,b,n,&got)&&got==n;}
void on_enter(GumInvocationContext*ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(!s[0]||s[2])goto done;
 U pair[2],post=0,text[4],reply[2]={0},header[6];
 U p=(U)gum_invocation_context_get_nth_argument(ic,1),c=(U)gum_invocation_context_get_nth_argument(ic,2),r=(U)gum_invocation_context_get_nth_argument(ic,3);
 if(!readmem(p,pair,16)||!readmem(pair[0],&post,8)||post!=0xd0a4ce7c4e6d1264ULL)goto done;
 if(!readmem(c,text,32)||text[2]<1||text[2]>256||text[3]<text[2])goto done;
 if(!readmem(r,reply,16)||!reply[0]||!readmem(reply[0],header,48))goto done;
 int old=0,one=1;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(s[2]):"r"(one):"memory");if(old)goto done;
 U*out=(U*)(storage+64);out[0]=post;out[1]=text[2];out[2]=header[0];out[3]=header[1];
 unsigned char*str=storage+2048;*(unsigned int*)str=0;
 if(readmem(text[3]<16?c:text[0],str+8,text[2])){*(unsigned int*)(str+4)=(unsigned int)text[2];s[4]=1;s[3]=1;}
 if(header[4]<=256&&header[5]>=header[4]){
  str=storage+2048+272;*(unsigned int*)str=16;
  if(readmem(header[5]<16?reply[0]+16:header[2],str+8,header[4])){*(unsigned int*)(str+4)=(unsigned int)header[4];s[4]=2;}
 }
 __asm__ __volatile__("":::"memory");s[2]=2;
done:add(s+1,-1);
}
