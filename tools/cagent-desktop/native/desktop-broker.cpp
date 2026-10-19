// Optional LocalSystem broker. No network listener and no arbitrary executable,
// command, environment, target session or desktop supplied by the client.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <sddl.h>
#include <userenv.h>
#include <objbase.h>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>
#include <set>
#include <stdexcept>
#include <map>
#include <tlhelp32.h>
#include "vendor/json.hpp"
using json=nlohmann::json;
static const wchar_t* serviceName=L"CAgentDesktopBroker";
static const wchar_t* pipeName=L"\\\\.\\pipe\\CAgentDesktopBroker-v1";
static HANDLE stopped=nullptr,workersJob=nullptr;
static SERVICE_STATUS_HANDLE statusHandle=nullptr;
static std::atomic<int> clients{0};
static std::mutex threadMutex;
static std::set<HANDLE> threads;
struct WorkerIdentity{DWORD session;ULONGLONG created;HANDLE process;ULONGLONG lastSas=0;};
static std::mutex workerMutex;
static std::map<DWORD,WorkerIdentity> liveWorkers;
static std::set<DWORD> activeSessions;
struct Handle{HANDLE h=nullptr;Handle()=default;explicit Handle(HANDLE p):h(p){}~Handle(){if(h&&h!=INVALID_HANDLE_VALUE)CloseHandle(h);}Handle(const Handle&)=delete;operator HANDLE()const{return h;}HANDLE* put(){return &h;}};
static void report(const char* text){
 DWORD error=GetLastError();int size=MultiByteToWideChar(CP_UTF8,0,text,-1,nullptr,0);std::wstring message(size,L'\0');MultiByteToWideChar(CP_UTF8,0,text,-1,message.data(),size);if(size)message.resize(size-1);message+=L" win32="+std::to_wstring(error);LPCWSTR strings[]={message.c_str()};HANDLE log=RegisterEventSourceW(nullptr,L"CAgentDesktopBroker");if(log){ReportEventW(log,EVENTLOG_INFORMATION_TYPE,0,1,nullptr,1,0,strings,nullptr);DeregisterEventSource(log);}
}
static void need(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
static void status(DWORD state,DWORD error=0){SERVICE_STATUS s{};s.dwServiceType=SERVICE_WIN32_OWN_PROCESS;s.dwCurrentState=state;s.dwControlsAccepted=state==SERVICE_RUNNING?SERVICE_ACCEPT_STOP|SERVICE_ACCEPT_SHUTDOWN:0;s.dwWin32ExitCode=error;s.dwWaitHint=5000;SetServiceStatus(statusHandle,&s);}
static void WINAPI control(DWORD code){if(code==SERVICE_CONTROL_STOP||code==SERVICE_CONTROL_SHUTDOWN){status(SERVICE_STOP_PENDING);SetEvent(stopped);std::lock_guard<std::mutex> lock(threadMutex);for(auto h:threads)CancelSynchronousIo(h);}}
struct TrackThread{HANDLE h=nullptr;TrackThread(){DuplicateHandle(GetCurrentProcess(),GetCurrentThread(),GetCurrentProcess(),&h,THREAD_TERMINATE,FALSE,0);std::lock_guard<std::mutex> lock(threadMutex);threads.insert(h);}~TrackThread(){std::lock_guard<std::mutex> lock(threadMutex);threads.erase(h);if(h)CloseHandle(h);}};
static std::wstring allowedSid(){HKEY key=nullptr;need(RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"SOFTWARE\\CAgent\\DesktopBroker",0,KEY_QUERY_VALUE,&key)==ERROR_SUCCESS,"Broker not configured");wchar_t value[256]{};DWORD type=0,bytes=sizeof(value);auto result=RegQueryValueExW(key,L"OwnerSid",nullptr,&type,(BYTE*)value,&bytes);RegCloseKey(key);need(result==ERROR_SUCCESS&&type==REG_SZ&&bytes<sizeof(value),"Invalid broker owner");PSID parsed=nullptr;need(ConvertStringSidToSidW(value,&parsed)!=0,"Invalid broker owner SID");LocalFree(parsed);return value;}
// Named-pipe handles are overlapped; every operation has a deadline and stop event.
static bool pipeIo(HANDLE pipe,void* data,DWORD size,DWORD& count,bool write,DWORD timeout=30000,HANDLE cancelled=nullptr){
 if(WaitForSingleObject(stopped,0)==WAIT_OBJECT_0||(cancelled&&WaitForSingleObject(cancelled,0)==WAIT_OBJECT_0))return false;
 Handle event(CreateEventW(nullptr,TRUE,FALSE,nullptr));OVERLAPPED ov{};ov.hEvent=event;
 BOOL ok=write?WriteFile(pipe,data,size,&count,&ov):ReadFile(pipe,data,size,&count,&ov);
 if(ok)return true;if(GetLastError()!=ERROR_IO_PENDING)return false;
 HANDLE waits[]={stopped,event,cancelled};DWORD result=WaitForMultipleObjects(cancelled?3:2,waits,FALSE,timeout);
 if(result!=WAIT_OBJECT_0+1){CancelIoEx(pipe,&ov);WaitForSingleObject(event,INFINITE);return false;}
 return GetOverlappedResult(pipe,&ov,&count,FALSE)!=0;
}
static std::wstring registryString(const wchar_t* name){HKEY key=nullptr;need(RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"SOFTWARE\\CAgent\\DesktopBroker",0,KEY_QUERY_VALUE,&key)==ERROR_SUCCESS,"Broker not configured");wchar_t value[32768]{};DWORD type=0,bytes=sizeof(value);auto result=RegQueryValueExW(key,name,nullptr,&type,(BYTE*)value,&bytes);RegCloseKey(key);need(result==ERROR_SUCCESS&&type==REG_SZ&&bytes>=sizeof(wchar_t)&&bytes<sizeof(value)&&value[bytes/sizeof(wchar_t)-1]==0,"Invalid broker configuration");return value;}
static ULONGLONG creationTime(HANDLE process){FILETIME created{},exit{},kernel{},user{};need(GetProcessTimes(process,&created,&exit,&kernel,&user)!=0,"Client process time unavailable");return ((ULONGLONG)created.dwHighDateTime<<32)|created.dwLowDateTime;}
static std::wstring imagePath(HANDLE process){wchar_t path[32768];DWORD size=32768;need(QueryFullProcessImageNameW(process,0,path,&size)!=0,"Process image unavailable");return std::wstring(path,size);}
static std::wstring tokenSid(HANDLE token){DWORD bytes=0;GetTokenInformation(token,TokenUser,nullptr,0,&bytes);need(bytes>0&&bytes<65536,"Invalid token identity size");std::vector<BYTE> buffer(bytes);need(GetTokenInformation(token,TokenUser,buffer.data(),bytes,&bytes)!=0,"Client identity missing");LPWSTR sid=nullptr;need(ConvertSidToStringSidW(((TOKEN_USER*)buffer.data())->User.Sid,&sid)!=0,"Client SID missing");std::wstring actual(sid);LocalFree(sid);return actual;}
static DWORD tokenSession(HANDLE token){DWORD value=0,bytes=0;need(GetTokenInformation(token,TokenSessionId,&value,sizeof(value),&bytes)!=0&&value!=0,"Interactive session required");return value;}
static bool elevated(HANDLE token){TOKEN_ELEVATION value{};DWORD bytes=0;return GetTokenInformation(token,TokenElevation,&value,sizeof(value),&bytes)&&value.TokenIsElevated;}
static DWORD parentPid(DWORD pid){Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0));need(snapshot.h!=INVALID_HANDLE_VALUE,"Process ancestry unavailable");PROCESSENTRY32W entry{};entry.dwSize=sizeof(entry);if(Process32FirstW(snapshot,&entry))do{if(entry.th32ProcessID==pid)return entry.th32ParentProcessID;}while(Process32NextW(snapshot,&entry));throw std::runtime_error("Process ancestry missing");}
struct Identity{DWORD pid=0,session=0;bool worker=false;};
static Identity authorize(HANDLE pipe,const std::wstring& owner,const std::wstring& proxy,BYTE action){
 need(ImpersonateNamedPipeClient(pipe)!=0,"Cannot identify broker client");Handle token;bool opened=OpenThreadToken(GetCurrentThread(),TOKEN_QUERY,TRUE,token.put())!=0;BOOL reverted=RevertToSelf();need(reverted&&opened,"Cannot read client identity");
 Identity identity;ULONG pid=0;need(GetNamedPipeClientProcessId(pipe,&pid)!=0,"Client process unavailable");identity.pid=pid;identity.session=tokenSession(token);
 Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid));need(process.h&&WaitForSingleObject(process,0)==WAIT_TIMEOUT,"Client exited");
 auto sid=tokenSid(token);
 if(sid==L"S-1-5-18"){
  need(action!=1,"Workers cannot start another worker");std::lock_guard<std::mutex> lock(workerMutex);auto found=liveWorkers.find(pid);
  need(found!=liveWorkers.end()&&found->second.session==identity.session&&found->second.created==creationTime(process)&&WaitForSingleObject(found->second.process,0)==WAIT_TIMEOUT&&_wcsicmp(imagePath(process).c_str(),proxy.c_str())==0,"Not an active broker worker");identity.worker=true;return identity;
 }
 need(sid==owner,"Client is not broker owner");
 // Elevation is the trust boundary. A writable runtime path alone is not authority.
 need(elevated(token),"System desktop requires CAgent explicitly started as administrator");
 need(_wcsicmp(imagePath(process).c_str(),proxy.c_str())==0,"Use the installed protected desktop proxy");
 DWORD parent=parentPid(pid);Handle runtime(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,parent));need(runtime.h&&WaitForSingleObject(runtime,0)==WAIT_TIMEOUT&&creationTime(runtime)<=creationTime(process),"CAgent parent exited or PID was reused");
 Handle runtimeToken;need(OpenProcessToken(runtime,TOKEN_QUERY,runtimeToken.put())!=0&&tokenSid(runtimeToken)==owner&&tokenSession(runtimeToken)==identity.session&&elevated(runtimeToken),"CAgent parent must be elevated in the same owner session");
 need(_wcsicmp(imagePath(runtime).c_str(),registryString(L"RuntimeImagePath").c_str())==0,"CAgent runtime changed; reinstall system desktop support");need(action!=3,"Secure attention is available only through an authorized worker input lease");return identity;
}
static bool sasPolicyAllowsServices(){DWORD value=0,bytes=sizeof(value);return RegGetValueW(HKEY_LOCAL_MACHINE,L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",L"SoftwareSASGeneration",RRF_RT_REG_DWORD,nullptr,&value,&bytes)==ERROR_SUCCESS&&(value==1||value==3);}
static HMODULE sasLibrary(){return LoadLibraryExW(L"sas.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);}
static bool sasAvailable(){if(!sasPolicyAllowsServices())return false;HMODULE library=sasLibrary();bool result=library&&GetProcAddress(library,"SendSAS");if(library)FreeLibrary(library);return result;}
static void sendSas(const Identity& identity){
 need(identity.worker&&sasPolicyAllowsServices(),"Secure attention policy does not allow services");
 {std::lock_guard<std::mutex> lock(workerMutex);auto found=liveWorkers.find(identity.pid);need(found!=liveWorkers.end()&&GetTickCount64()-found->second.lastSas>=2000,"Secure attention request throttled");found->second.lastSas=GetTickCount64();}
 Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,identity.pid)),token,impersonation;need(process.h&&OpenProcessToken(process,TOKEN_DUPLICATE|TOKEN_QUERY,token.put())!=0&&tokenSession(token)==identity.session,"Worker session ended");need(DuplicateTokenEx(token,TOKEN_QUERY|TOKEN_IMPERSONATE,nullptr,SecurityImpersonation,TokenImpersonation,impersonation.put())!=0,"SAS token unavailable");
 HMODULE library=sasLibrary();need(library!=nullptr,"SAS library unavailable");auto send=(void(WINAPI*)(BOOL))GetProcAddress(library,"SendSAS");if(!send){FreeLibrary(library);throw std::runtime_error("SAS API unavailable");}
 if(!ImpersonateLoggedOnUser(impersonation)){FreeLibrary(library);throw std::runtime_error("Cannot bind SAS session");}send(FALSE);BOOL reverted=RevertToSelf();FreeLibrary(library);need(reverted,"SAS impersonation cleanup failed");
 // SendSAS returns void. Submission is not proof of a changed login screen.
}
static void controlReply(HANDLE pipe,const json& reply){auto text=reply.dump();DWORD length=(DWORD)text.size(),count=0;need(pipeIo(pipe,&length,sizeof(length),count,true,5000)&&count==sizeof(length),"Control reply failed");DWORD offset=0;while(offset<length){need(pipeIo(pipe,text.data()+offset,length-offset,count,true,5000)&&count,"Control reply failed");offset+=count;}BYTE ack=0;need(pipeIo(pipe,&ack,1,count,false,5000)&&count==1&&ack==0xac,"Control response not acknowledged");}
static void copy(HANDLE from,HANDLE to,bool fromPipe=false,bool toPipe=false,HANDLE cancelled=nullptr){TrackThread track;BYTE data[65536];while(WaitForSingleObject(stopped,0)!=WAIT_OBJECT_0&&(!cancelled||WaitForSingleObject(cancelled,0)!=WAIT_OBJECT_0)){DWORD n=0;if(!(fromPipe?pipeIo(from,data,sizeof(data),n,false,INFINITE,cancelled):ReadFile(from,data,sizeof(data),&n,nullptr))||!n)break;DWORD offset=0;while(offset<n){DWORD written=0;if(!(toPipe?pipeIo(to,data+offset,n-offset,written,true,30000,cancelled):WriteFile(to,data+offset,n-offset,&written,nullptr))||!written)return;offset+=written;}}}
static void serve(HANDLE raw,const std::wstring owner,const std::wstring worker){
 Handle pipe(raw);TrackThread tracked;
 try{
  BYTE action=0;DWORD received=0;need(pipeIo(pipe,&action,1,received,false,5000)&&received==1&&(action==1||action==2||action==3),"Invalid broker handshake");
  Identity identity=authorize(pipe,owner,worker,action);DWORD session=identity.session;
  if(action!=1){if(action==3)sendSas(identity);controlReply(pipe,{{"version",1},{"secureAttention",sasAvailable()},{"submitted",action==3},{"confirmed",false}});DisconnectNamedPipe(pipe);clients--;return;}
  {std::lock_guard<std::mutex> lock(workerMutex);need(activeSessions.insert(session).second,"A desktop worker already owns this Windows session");}
  struct SessionRelease{DWORD session;~SessionRelease(){std::lock_guard<std::mutex> lock(workerMutex);activeSessions.erase(session);}}sessionRelease{session};
  report("Client authorized");need(WaitForSingleObject(stopped,0)!=WAIT_OBJECT_0,"Service stopping");
  Handle own,token;need(OpenProcessToken(GetCurrentProcess(),TOKEN_DUPLICATE|TOKEN_QUERY,own.put())!=0,"Service token unavailable");need(DuplicateTokenEx(own,TOKEN_ALL_ACCESS,nullptr,SecurityImpersonation,TokenPrimary,token.put())!=0,"Service token duplication failed");need(SetTokenInformation(token,TokenSessionId,&session,sizeof(session))!=0,"Cannot select client session");
  GUID guid{};need(SUCCEEDED(CoCreateGuid(&guid)),"Worker nonce unavailable");wchar_t text[64];StringFromGUID2(guid,text,64);std::wstring nonce(text);nonce=nonce.substr(1,nonce.size()-2);
  std::wstring workerPipeName=L"\\\\.\\pipe\\CAgentDesktopWorker-"+nonce;
  PSECURITY_DESCRIPTOR workerDescriptor=nullptr;need(ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:P(A;;GA;;;SY)",SDDL_REVISION_1,&workerDescriptor,nullptr)!=0,"Worker pipe ACL unavailable");
  SECURITY_ATTRIBUTES sa{sizeof(sa),workerDescriptor,FALSE};Handle workerPipe(CreateNamedPipeW(workerPipeName.c_str(),PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED|FILE_FLAG_FIRST_PIPE_INSTANCE,PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,1,65536,65536,5000,&sa));LocalFree(workerDescriptor);need(workerPipe.h!=INVALID_HANDLE_VALUE,"Worker pipe unavailable");
  STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.lpDesktop=(LPWSTR)L"winsta0\\default";
  std::wstring command=L"\""+worker+L"\" --system-pipe "+nonce;PROCESS_INFORMATION process{};
  need(CreateProcessAsUserW(token,worker.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_SUSPENDED|CREATE_NO_WINDOW,nullptr,nullptr,&startup,&process)!=0,"Worker launch failed");
  Handle child(process.hProcess),mainThread(process.hThread);struct Kill{HANDLE child,pipe;~Kill(){DisconnectNamedPipe(pipe);if(WaitForSingleObject(child,3000)==WAIT_TIMEOUT){TerminateProcess(child,0);WaitForSingleObject(child,3000);}}}kill{child,workerPipe};
  need(AssignProcessToJobObject(workersJob,child)!=0,"Worker containment failed");
  {std::lock_guard<std::mutex> lock(workerMutex);liveWorkers.emplace(process.dwProcessId,WorkerIdentity{session,creationTime(child),child,0});}
  struct Unregister{DWORD pid;~Unregister(){std::lock_guard<std::mutex> lock(workerMutex);liveWorkers.erase(pid);}}unregister{process.dwProcessId};
  need(ResumeThread(mainThread)!=(DWORD)-1,"Worker resume failed");report("Worker launched");
  Handle connected(CreateEventW(nullptr,TRUE,FALSE,nullptr));OVERLAPPED ov{};ov.hEvent=connected;BOOL ok=ConnectNamedPipe(workerPipe,&ov);DWORD error=ok?0:GetLastError();
  if(error==ERROR_PIPE_CONNECTED)SetEvent(connected);else need(error==ERROR_IO_PENDING||ok,"Worker connection failed");
  HANDLE waits[]={stopped,connected,child};DWORD result=WaitForMultipleObjects(3,waits,FALSE,10000);DWORD count=0;
  if(result!=WAIT_OBJECT_0+1){CancelIoEx(workerPipe,&ov);if(error==ERROR_IO_PENDING)GetOverlappedResult(workerPipe,&ov,&count,TRUE);throw std::runtime_error("Worker connection timed out");}
  if(error==ERROR_IO_PENDING)need(GetOverlappedResult(workerPipe,&ov,&count,FALSE)!=0,"Worker connection cancelled");
  report("Worker connected");ULONG workerPid=0;need(GetNamedPipeClientProcessId(workerPipe,&workerPid)&&workerPid==process.dwProcessId,"Worker identity mismatch");
  Handle ended(CreateEventW(nullptr,TRUE,FALSE,nullptr));
  std::thread incoming([&]{copy(pipe,workerPipe,true,true,ended);SetEvent(ended);});
  copy(workerPipe,pipe,true,true,ended);SetEvent(ended);incoming.join();
  // EOF lets NativeInput release held keys before the bounded kill fallback.
  DisconnectNamedPipe(workerPipe);DisconnectNamedPipe(pipe);


 }catch(const std::exception&e){report(e.what());DisconnectNamedPipe(pipe);}
 clients--;
}
static void WINAPI serviceMain(DWORD,LPWSTR*){
 statusHandle=RegisterServiceCtrlHandlerW(serviceName,control);if(!statusHandle)return;status(SERVICE_START_PENDING);stopped=CreateEventW(nullptr,TRUE,FALSE,nullptr);
 try{
  const auto owner=allowedSid();
wchar_t path[32768];DWORD n=GetModuleFileNameW(nullptr,path,32768);need(n>0&&n<32768,"Service path unavailable");std::wstring worker(path);worker=worker.substr(0,worker.find_last_of(L"\\/"))+L"\\cagent-desktop.exe";
  workersJob=CreateJobObjectW(nullptr,nullptr);need(workersJob!=nullptr,"Job unavailable");JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_ACTIVE_PROCESS;limits.BasicLimitInformation.ActiveProcessLimit=4;need(SetInformationJobObject(workersJob,JobObjectExtendedLimitInformation,&limits,sizeof(limits))!=0,"Job limits unavailable");
  PSECURITY_DESCRIPTOR descriptor=nullptr;std::wstring sddl=L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;"+owner+L")";need(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&descriptor,nullptr)!=0,"Pipe ACL unavailable");SECURITY_ATTRIBUTES sa{sizeof(sa),descriptor,FALSE};status(SERVICE_RUNNING);
  while(WaitForSingleObject(stopped,0)!=WAIT_OBJECT_0){
   if(clients>=12){Sleep(50);continue;}
   Handle pipe(CreateNamedPipeW(pipeName,PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED,PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,12,65536,65536,5000,&sa));need(pipe.h!=INVALID_HANDLE_VALUE,"Pipe unavailable");Handle connected(CreateEventW(nullptr,TRUE,FALSE,nullptr));OVERLAPPED ov{};ov.hEvent=connected;BOOL ok=ConnectNamedPipe(pipe,&ov);DWORD error=ok?0:GetLastError();if(error==ERROR_PIPE_CONNECTED)SetEvent(connected);else need(error==ERROR_IO_PENDING||ok,"Pipe connection failed");HANDLE wait[]={stopped,connected};if(WaitForMultipleObjects(2,wait,FALSE,INFINITE)!=WAIT_OBJECT_0+1){CancelIoEx(pipe,&ov);DWORD count=0;if(error==ERROR_IO_PENDING)GetOverlappedResult(pipe,&ov,&count,TRUE);break;}
   // All subsequent pipe reads/writes use overlapped operations too.
   DWORD transferred=0;if(error==ERROR_IO_PENDING)need(GetOverlappedResult(pipe,&ov,&transferred,FALSE)!=0,"Pipe accept failed");
   HANDLE accepted=pipe.h;pipe.h=nullptr;clients++;try{std::thread(serve,accepted,owner,worker).detach();}catch(...){clients--;CloseHandle(accepted);throw;}
  }
  LocalFree(descriptor);{std::lock_guard<std::mutex> lock(threadMutex);for(auto h:threads)CancelSynchronousIo(h);}while(clients)Sleep(50);
  SetEvent(stopped);
  CloseHandle(workersJob);workersJob=nullptr;CloseHandle(stopped);stopped=nullptr;status(SERVICE_STOPPED);
 }catch(...){if(stopped)SetEvent(stopped);{std::lock_guard<std::mutex> lock(threadMutex);for(auto h:threads)CancelSynchronousIo(h);}while(clients)Sleep(50);if(workersJob)CloseHandle(workersJob);if(stopped)CloseHandle(stopped);status(SERVICE_STOPPED,ERROR_SERVICE_SPECIFIC_ERROR);}
}
int wmain(){SERVICE_TABLE_ENTRYW entries[]={{(LPWSTR)serviceName,serviceMain},{nullptr,nullptr}};return StartServiceCtrlDispatcherW(entries)?0:(int)GetLastError();}
