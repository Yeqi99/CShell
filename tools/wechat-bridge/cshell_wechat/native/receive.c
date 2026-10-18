/* Native hot-path capture: no JS engine entry on the client's coroutine stack. */
#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern unsigned char storage[];
extern char targets[];
extern int target_count[];
extern char account[];
extern int rpm(void *process, const void *address, void *output, U size, U *read);
#define SLOT 4608
#define CAP 32
/* Header: lock, enabled, active, hits, errors, dropped, write, read. */
static volatile int *state(void){return (volatile int*)storage;}
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int lock(void){int old=0,one=1;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(*state()):"r"(one):"memory");return old==0;}
static void unlock(void){int zero=0;__asm__ __volatile__("xchgl %0,%1":"+r"(zero),"+m"(*state())::"memory");}
static int readmem(U a,void*b,U n){U got=0;return a>0xffff && rpm((void*)(U)-1,(void*)a,b,n,&got) && got==n;}
static int string(U field,char*out,U max){
 U parts[4];if(!readmem(field,parts,32))return -1;
 U n=parts[2],cap=parts[3];if(n>max||cap<n||cap>1048576)return -1;
 if(n && !readmem(cap<16?field:parts[0],out,n))return -1;
 out[n]=0;return (int)n;
}
static int equal(char*a,char*b){int i=0;while(i<128){if(a[i]!=b[i])return 0;if(!a[i])return 1;i++;}return 0;}
static int allowed(char*a){for(int i=0;i<*target_count;i++)if(equal("*",targets+i*128)||equal(a,targets+i*128))return 1;return 0;}
static int room(char*a){int n=0;while(n<127&&a[n])n++;return n>=9&&equal(a+n-9,"@chatroom");}
void on_enter(GumInvocationContext *ic){
 volatile int*s=state();add(s+2,1);
 if(!s[1]){add(s+2,-1);return;}
 add(s+3,1);
 U vector=(U)gum_invocation_context_get_nth_argument(ic,1),bounds[2];
 if(!readmem(vector,bounds,16)||bounds[1]<bounds[0]||bounds[1]-bounds[0]>0x2e8*64||(bounds[1]-bounds[0])%0x2e8){add(s+4,1);add(s+2,-1);return;}
 for(U m=bounds[0];m<bounds[1];m+=0x2e8){
  char from[128],to[128];
  if(string(m+0x18,from,127)<0||string(m+0x38,to,127)<0){add(s+4,1);continue;}
  if(account[0]&&!equal(from,account)&&!equal(to,account))continue;
  if(room(from)?!allowed(from):room(to)?!allowed(to):!allowed(from)&&!allowed(to))continue;
  if(!lock()){add(s+5,1);continue;}
  if(s[6]-s[7]>=CAP){add(s+5,1);unlock();continue;}
  unsigned char*out=storage+32+(s[6]%CAP)*SLOT;
  int ok=readmem(m+0x148,out,8)&&readmem(m+0x150,out+8,8)&&readmem(m+12,out+16,4);
  int a=string(m+0x18,(char*)out+32,127),b=string(m+0x38,(char*)out+160,127),c=string(m+0x58,(char*)out+288,127),d=string(m+0x180,(char*)out+416,4095);
  if(ok&&a>=0&&b>=0&&c>=0&&d>=0){*(int*)(out+20)=d;s[6]++;}else add(s+4,1);
  unlock();
 }
 add(s+2,-1);
}
int take(unsigned char*out){
 volatile int*s=state();if(!lock())return 0;
 if(s[7]==s[6]){unlock();return 0;}
 unsigned char*in=storage+32+(s[7]%CAP)*SLOT;
 for(int i=0;i<SLOT;i++)out[i]=in[i];s[7]++;unlock();return 1;
}
