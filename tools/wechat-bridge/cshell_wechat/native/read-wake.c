/* Schedule a read through the client's own database service. Never use a
 * NOMUTEX SQLite handle from an unrelated thread. Appended to history.c. */
typedef uint64_t U;
extern unsigned int tls_index[];
extern volatile int wake_state[];
extern U identity[];
extern int wake_kind[];
extern void query_message(U,U*,U*,U,int);
extern void get_coro(U*);
extern void get_svc(U,U*);
extern void get_contact(U,U*);
extern void query_contact(U,U*,U*);
extern void get_sessions(U,U*);
extern void query_sessions(U,U*);
extern void get_sns(U,U*);
extern void query_sns(U,U*,int,int,int,int,int);
static int ready(void){void**slots;__asm__ __volatile__("movq %%gs:0x58,%0":"=r"(slots));if(!slots||*tls_index>=64)return 0;char*s=slots[*tls_index];if(!s)return 0;U*p=*(U**)(s+0x1f0);return p&&p[0]&&p[1]&&*(volatile int*)(p[1]+8)>0;}
static void release(U*p){char*c=(char*)p[1];if(!c)return;if(add((int*)(c+8),-1)==1){void**v=*(void***)c;((void(*)(void*))v[0])(c);if(add((int*)(c+12),-1)==1){v=*(void***)c;((void(*)(void*))v[1])(c);}}}
void wake(GumInvocationContext*ic){
 add(wake_state+2,1);
 if(wake_state[0]&&ready()){
  int old=1,zero=0;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(wake_state[0]):"r"(zero):"memory");
  if(old==1){
   U future[2]={0},coro[2]={0},svc[2]={0},contact[2]={0};wake_state[1]=1;
   if(*wake_kind==3){
    /* SNS service getter from 0x405f1c0; async bounded notification query
     * from 0x303daf0 -> 0x57088f0 -> 0x570fb90 -> 0x2802ca0.
     * Limit 1, no read-state mutation; actual SQL runs on the SNS queue. */
    get_coro(coro);if(!coro[0])goto done;
    get_svc(coro[0],svc);if(!svc[0])goto done;
    get_sns(svc[0],contact);if(!contact[0])goto done;
    U wrapper=*(U*)(contact[0]+0x428);if(!wrapper)goto done;
    U db=*(U*)wrapper;if(!db)goto done;
    query_sns(db,future,0,0,0,1,1);
   }else if(*wake_kind==2){
    /* Exact-build SessionManager -> asynchronous session database queue.
     * Same shared_ptr/future ownership as the client's 0x2aa9a80 caller.
     * The queued read wakes history.c on the database owner thread. */
    get_coro(coro);if(!coro[0])goto done;
    get_svc(coro[0],svc);if(!svc[0])goto done;
    get_sessions(svc[0],contact);if(!contact[0])goto done;
    U db=*(U*)(contact[0]+0x428);if(!db)goto done;
    query_sessions(db,future);
   }else if(*wake_kind==1){
    get_coro(coro);if(!coro[0])goto done;
    get_svc(coro[0],svc);if(!svc[0])goto done;
    get_contact(svc[0],contact);if(!contact[0])goto done;
    U db=*(U*)(contact[0]+0x1a8);if(!db)goto done;
    query_contact(db,future,identity);
   }else query_message(0,future,identity,1,1);
   done:release(future);release(contact);release(svc);release(coro);wake_state[1]=2;
  }
 }
 add(wake_state+2,-1);
}
