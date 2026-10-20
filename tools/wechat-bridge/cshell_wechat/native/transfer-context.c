/* MSVC callable held in the exact-build transfer completion context.
 * No JS callbacks run on the WeChat thread. This file has no submit entry.
 * state: active, liveCopies, calls, valid, transportCode, returnCodeLength.
 */
#include <stdint.h>
typedef uint64_t U;
extern volatile int state[];
extern char return_code[];
extern int rpm(void*,const void*,void*,U,U*);
static int add(volatile int*p,int v){
 __asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;
}
static int read_bytes(const void*p,void*out,U n){
 U got=0;return p&&rpm((void*)(U)-1,p,out,n,&got)&&got==n;
}
typedef struct {void**vtable;U tag;} Callback;
/* CModule globals are read-only; writable storage is supplied by the host. */
extern void *methods[6];
static Callback *copy_callback(Callback*self,Callback*out){
 out->vtable=methods;out->tag=self->tag;add(state+1,1);return out;
}
static Callback *move_callback(Callback*self,Callback*out){return copy_callback(self,out);}
static void invoke_callback(Callback*self,U*shared){
 add(state,1);add(state+2,1);
 U data=0;
 int code=0;
 U text[4]={0};
 if(read_bytes(shared,&data,8)&&data&&
    read_bytes((void*)(data+0x28),&code,4)&&
    read_bytes((void*)(data+0x50),text,32)&&text[2]>0&&text[2]<=15){
  char value[16]={0};
  const void*p=text[3]<16?(void*)(data+0x50):(void*)text[0];
  if(read_bytes(p,value,text[2])){
   int valid=1;
   for(U i=0;i<text[2];i++){
    if(!((value[i]>='0'&&value[i]<='9')||(i==0&&value[i]=='-'&&text[2]>1)))valid=0;
   }
   if(valid){
    for(U i=0;i<text[2];i++)return_code[i]=value[i];
    return_code[text[2]]=0;state[4]=code;state[5]=(int)text[2];state[3]=1;
   }
  }
 }
 add(state,-1);
}
static void *target_type(Callback*self){return 0;}
static void destroy_callback(Callback*self,int deallocate){
 /* All copies fit in the native std::function inline storage; never heap owned. */
 self->vtable=0;add(state+1,-1);
}
static void *target_address(Callback*self,void*type){return 0;}
void init_context(U*context,void*cancelled){
 for(int i=0;i<29;i++)context[i]=0;
 methods[0]=copy_callback;methods[1]=move_callback;methods[2]=invoke_callback;
 methods[3]=target_type;methods[4]=destroy_callback;methods[5]=target_address;
 context[0]=(U)cancelled;
 Callback*c=(Callback*)((char*)context+0x10);
 c->vtable=methods;c->tag=0x5452414e53464552;
 context[0x48/8]=(U)c;add(state+1,1);
}
void test_invoke(U*context,U*result){
 Callback*c=(Callback*)context[0x48/8];invoke_callback(c,result);
}
