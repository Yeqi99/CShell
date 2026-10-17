#include <gum/guminterceptor.h>
#include <stdint.h>
extern unsigned char output[];
extern volatile int control[];
extern void *handles[];
extern int handle_count[];
extern char query[];
extern char selected_path[];
extern void *db_handle(void*);
#ifdef MATCH_PATH
extern const char *db_filename(void*,const char*);
extern char expected_path[];
#endif
extern int prepare_v2(void*,const char*,int,void**,void*);
extern int stmt_readonly(void*);
extern int step(void*);
extern int sql_finalize(void*);
extern int column_count(void*);
extern const char *column_text(void*,int);
extern int column_bytes(void*,int);
extern int stmt_busy(void*);
extern uint64_t tick(void);
/* control: armed, state, active, rc, rows, bytes, queries, observed */
static int add(volatile int*p,int v){__asm__ __volatile__("lock xaddl %0,%1":"+r"(v),"+m"(*p)::"memory");return v;}
static int claim(void){int old=1,zero=0;__asm__ __volatile__("lock cmpxchgl %2,%1":"+a"(old),"+m"(control[0]):"r"(zero):"memory");return old==1;}
void enter(GumInvocationContext*ic){
 if(!control[0])return;
 add(control+7,1);
 void*current=gum_invocation_context_get_nth_argument(ic,0);if(!current)return;
 void*db=db_handle(current);int found=0;const char*chosen=0;int path_len=0;
 for(int i=0;i<*handle_count;i++)if(db==handles[i]){found=1;break;}
#ifdef MATCH_PATH
 if(!found && expected_path[0]){
  const char*path=db_filename(db,"main");
  if(path){int n=0;while(n<1023&&path[n])n++;const char*name="message_0.db";int len=12;
   if(n>=len&&n<1023&&(n==len||path[n-len-1]=='/'||path[n-len-1]=='\\')){found=1;for(int i=0;i<len;i++)if(path[n-len+i]!=name[i])found=0;}
   if(found){chosen=path;path_len=n;}
  }
 }
#endif
 if(!found||!claim())return;
 if(chosen){for(int i=0;i<=path_len;i++)selected_path[i]=chosen[i];}
 add(control+2,1);control[1]=1;control[6]++;
 void*stmt=0;int rc=prepare_v2(db,query,-1,&stmt,0),rows=0,used=0;
 if(rc==0&&stmt){
  int cols=column_count(stmt);
  if(stmt_readonly(stmt)!=1||cols<1||cols>8)rc=-10;
  else{
   uint64_t end=tick()+100;
   while(rows<128&&tick()<end){
    rc=step(stmt);if(rc!=100)break;
    if(used+4>65536){rc=-11;break;}*(int*)(output+used)=cols;used+=4;
    for(int c=0;c<cols;c++){
     const char*p=column_text(stmt,c);int n=column_bytes(stmt,c);
     if(n<0||n>8192||used+4+n>65536){rc=-11;break;}
     *(int*)(output+used)=p?n:-1;used+=4;
     if(p){for(int j=0;j<n;j++)output[used+j]=p[j];used+=n;}
    }
    if(rc!=100)break;rows++;
   }
  }
 }
 if(stmt)sql_finalize(stmt);
 control[3]=rc;control[4]=rows;control[5]=used;control[1]=2;add(control+2,-1);
}
