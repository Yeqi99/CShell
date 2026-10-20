/* Passive bounded observation; payload stays in transient memory for shape-only output. */
#include <gum/guminterceptor.h>
#include <stdint.h>
typedef uint64_t U;
extern unsigned char storage[];
extern int rpm(void*,const void*,void*,U,U*);
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int readmem(U a,void*b,U n){U got=0;return a>0xffff&&rpm((void*)(U)-1,(void*)a,b,n,&got)&&got==n;}
void on_enter(GumInvocationContext*ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(!s[0])goto done;
 char name[64]={0};U p=(U)gum_invocation_context_get_nth_argument(ic,1);
 int n=0;for(;n<63;n++){if(!readmem(p+n,name+n,1))goto done;if(!name[n])break;}
 char prefix[]="xweb_call_jsapi";for(int i=0;i<15;i++)if(name[i]!=prefix[i])goto done;
 if(n==63)goto done;
 int index=add(s+2,1);if(index>=64)goto done;
 unsigned char*out=storage+64+index*16480;
 *(unsigned int*)out=(unsigned int)(U)gum_invocation_context_get_nth_argument(ic,0);
 *(unsigned int*)(out+4)=(unsigned int)(U)gum_invocation_context_get_nth_argument(ic,3);
 for(int i=0;i<=n;i++)out[8+i]=name[i];
 unsigned int bytes=*(unsigned int*)(out+4);
 if(bytes>0&&bytes<=16384&&readmem((U)gum_invocation_context_get_nth_argument(ic,2),out+96,bytes))
   *(unsigned int*)(out+80)=bytes;
done:add(s+1,-1);
}

void on_callback(GumInvocationContext*ic){
 volatile int*s=(volatile int*)storage;add(s+1,1);
 if(!s[0])goto done;
 U p=(U)gum_invocation_context_get_nth_argument(ic,1);
 char prefix[]="WeixinJSBridge._handleMessageFromWeixin(";char head[sizeof(prefix)-1];
 if(!readmem(p,head,sizeof(head)))goto done;
 for(unsigned int i=0;i<sizeof(head);i++)if(head[i]!=prefix[i])goto done;
 int index=add(s+2,1);if(index>=64)goto done;
 unsigned char*out=storage+64+index*16480;
 char label[]="native_js_callback";for(int i=0;i<19;i++)out[8+i]=label[i];
 unsigned int n=0;
 for(;n<16384;n+=256){
   if(!readmem(p+n,out+96+n,256))goto done;
   for(int j=0;j<256;j++)if(!out[96+n+j]){
     *(unsigned int*)(out+4)=n+j;*(unsigned int*)(out+80)=n+j;goto done;
   }
 }
done:add(s+1,-1);
}
