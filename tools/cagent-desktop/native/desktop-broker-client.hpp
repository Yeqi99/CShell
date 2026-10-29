#pragma once
#include <windows.h>
#include <thread>
#include <atomic>
#include <stdexcept>
#include <string>
#include <algorithm>
#include <io.h>
#include <fcntl.h>
#include "vendor/json.hpp"
inline void connectSystemWorker(const std::wstring& nonce){
 if(nonce.size()!=36||!std::all_of(nonce.begin(),nonce.end(),[](wchar_t c){return(c>=L'0'&&c<=L'9')||(c>=L'a'&&c<=L'f')||(c>=L'A'&&c<=L'F')||c==L'-';}))throw std::runtime_error("Invalid worker pipe nonce");
 std::wstring name=L"\\\\.\\pipe\\CAgentDesktopWorker-"+nonce;
 HANDLE pipe=CreateFileW(name.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);
 if(pipe==INVALID_HANDLE_VALUE)throw std::runtime_error("Worker pipe unavailable");
 SC_HANDLE manager=OpenSCManagerW(nullptr,nullptr,SC_MANAGER_CONNECT);SC_HANDLE service=manager?OpenServiceW(manager,L"CAgentDesktopBroker",SERVICE_QUERY_STATUS):nullptr;if(manager)CloseServiceHandle(manager);
 SERVICE_STATUS_PROCESS status{};DWORD bytes=0;BOOL ok=service&&QueryServiceStatusEx(service,SC_STATUS_PROCESS_INFO,(BYTE*)&status,sizeof(status),&bytes);if(service)CloseServiceHandle(service);
 ULONG pid=0;if(!ok||status.dwCurrentState!=SERVICE_RUNNING||!GetNamedPipeServerProcessId(pipe,&pid)||pid!=status.dwProcessId){CloseHandle(pipe);throw std::runtime_error("Worker broker identity mismatch");}
 HANDLE output=nullptr;if(!DuplicateHandle(GetCurrentProcess(),pipe,GetCurrentProcess(),&output,0,FALSE,DUPLICATE_SAME_ACCESS)){CloseHandle(pipe);throw std::runtime_error("Worker stdout unavailable");}
 int fd=_open_osfhandle((intptr_t)output,_O_BINARY);if(fd<0){CloseHandle(output);CloseHandle(pipe);throw std::runtime_error("Worker stdout binding failed");}if(_dup2(fd,_fileno(stdout))!=0){_close(fd);CloseHandle(pipe);throw std::runtime_error("Worker stdout binding failed");}_close(fd);
 SetStdHandle(STD_INPUT_HANDLE,pipe);SetStdHandle(STD_OUTPUT_HANDLE,(HANDLE)_get_osfhandle(_fileno(stdout)));
}
// Connect only to the SCM-registered process, rejecting a same-name pipe squatter.
// No credentials, commands or session choice cross this protocol.
inline bool brokerIo(HANDLE pipe,HANDLE stop,void* data,DWORD size,DWORD& count,bool write){
 if(WaitForSingleObject(stop,0)==WAIT_OBJECT_0)return false;
 HANDLE event=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!event)return false;
 OVERLAPPED ov{};ov.hEvent=event;
 BOOL ok=write?WriteFile(pipe,data,size,&count,&ov):ReadFile(pipe,data,size,&count,&ov);
 if(!ok&&GetLastError()==ERROR_IO_PENDING){
  HANDLE waits[]={stop,event};DWORD result=WaitForMultipleObjects(2,waits,FALSE,write?30000:INFINITE);
  if(result!=WAIT_OBJECT_0+1){CancelIoEx(pipe,&ov);GetOverlappedResult(pipe,&ov,&count,TRUE);ok=FALSE;}
  else ok=GetOverlappedResult(pipe,&ov,&count,FALSE);
 }
 CloseHandle(event);return ok!=0;
}
// This control path is only accepted for a live SYSTEM worker created by the
// broker. NativeInput must authorize its input lease before requesting SAS.
inline std::string brokerControl(BYTE action,DWORD expectedSession=0,DWORD expectedConsole=0){
 SC_HANDLE manager=OpenSCManagerW(nullptr,nullptr,SC_MANAGER_CONNECT);if(!manager)throw std::runtime_error("Desktop service unavailable");SC_HANDLE service=OpenServiceW(manager,L"CAgentDesktopBroker",SERVICE_QUERY_STATUS);CloseServiceHandle(manager);if(!service)throw std::runtime_error("Desktop service unavailable");
 SERVICE_STATUS_PROCESS status{};DWORD bytes=0;BOOL queried=QueryServiceStatusEx(service,SC_STATUS_PROCESS_INFO,(BYTE*)&status,sizeof(status),&bytes);CloseServiceHandle(service);if(!queried||status.dwCurrentState!=SERVICE_RUNNING)throw std::runtime_error("Desktop service not running");
 HANDLE pipe=CreateFileW(L"\\\\.\\pipe\\CAgentDesktopBroker-v1",GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);if(pipe==INVALID_HANDLE_VALUE)throw std::runtime_error("Desktop service busy");
 HANDLE stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);struct Cleanup{HANDLE pipe,stop;~Cleanup(){CloseHandle(pipe);if(stop)CloseHandle(stop);}}cleanup{pipe,stop};if(!stop)throw std::runtime_error("Broker control event unavailable");ULONG pid=0;if(!GetNamedPipeServerProcessId(pipe,&pid)||pid!=status.dwProcessId)throw std::runtime_error("Desktop broker identity mismatch");
 // A local service control exchange must never indefinitely stall capture/input.
 auto transfer=[&](void* data,DWORD size,bool write){DWORD offset=0;while(offset<size){HANDLE event=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!event)throw std::runtime_error("Control event unavailable");OVERLAPPED ov{};ov.hEvent=event;DWORD count=0;BOOL ok=write?WriteFile(pipe,(BYTE*)data+offset,size-offset,&count,&ov):ReadFile(pipe,(BYTE*)data+offset,size-offset,&count,&ov);if(!ok&&GetLastError()==ERROR_IO_PENDING){if(WaitForSingleObject(event,5000)!=WAIT_OBJECT_0){CancelIoEx(pipe,&ov);GetOverlappedResult(pipe,&ov,&count,TRUE);CloseHandle(event);throw std::runtime_error("Desktop control request timed out");}ok=GetOverlappedResult(pipe,&ov,&count,FALSE);}CloseHandle(event);if(!ok||!count)throw std::runtime_error("Desktop control request rejected");offset+=count;}};
 transfer(&action,1,true);if(action==5){DWORD expected[]={expectedSession,expectedConsole};transfer(expected,sizeof(expected),true);}DWORD length=0;transfer(&length,sizeof(length),false);if(!length||length>4096)throw std::runtime_error("Invalid desktop control response");std::string response(length,'\0');transfer(response.data(),length,false);BYTE ack=0xac;transfer(&ack,1,true);return response;
}
inline bool brokerSecureAttentionAvailable(){try{return nlohmann::json::parse(brokerControl(2)).value("secureAttention",false);}catch(...){return false;}}
inline void brokerSecureAttention(){auto response=nlohmann::json::parse(brokerControl(3));if(!response.value("submitted",false))throw std::runtime_error("Secure attention request was not submitted");}
inline bool brokerStream(){
 SC_HANDLE manager=OpenSCManagerW(nullptr,nullptr,SC_MANAGER_CONNECT);if(!manager)return false;
 SC_HANDLE service=OpenServiceW(manager,L"CAgentDesktopBroker",SERVICE_QUERY_STATUS);CloseServiceHandle(manager);if(!service)return false;
 SERVICE_STATUS_PROCESS status{};DWORD bytes=0;BOOL queried=QueryServiceStatusEx(service,SC_STATUS_PROCESS_INFO,(BYTE*)&status,sizeof(status),&bytes);CloseServiceHandle(service);
 if(!queried||status.dwCurrentState!=SERVICE_RUNNING)return false;
 if(GetFileType(GetStdHandle(STD_INPUT_HANDLE))!=FILE_TYPE_PIPE)throw std::runtime_error("broker stream requires a private inherited pipe");
 HANDLE pipe=CreateFileW(L"\\\\.\\pipe\\CAgentDesktopBroker-v1",GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);
 if(pipe==INVALID_HANDLE_VALUE)throw std::runtime_error("CAPTURE_DESKTOP_UNAVAILABLE: system broker busy");
 ULONG pid=0;if(!GetNamedPipeServerProcessId(pipe,&pid)||pid!=status.dwProcessId){CloseHandle(pipe);throw std::runtime_error("Desktop broker identity mismatch");}
 HANDLE stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!stop){CloseHandle(pipe);throw std::runtime_error("Desktop broker stop event unavailable");}
 BYTE hello=1;DWORD n=0;if(!brokerIo(pipe,stop,&hello,1,n,true)||n!=1){CloseHandle(stop);CloseHandle(pipe);throw std::runtime_error("Desktop broker handshake failed");}
 auto copy=[&](HANDLE from,HANDLE to){
  BYTE data[65536];DWORD count=0;
  while(WaitForSingleObject(stop,0)!=WAIT_OBJECT_0){
   if(!(from==pipe?brokerIo(from,stop,data,sizeof(data),count,false):ReadFile(from,data,sizeof(data),&count,nullptr))||!count)break;
   DWORD offset=0;while(offset<count&&WaitForSingleObject(stop,0)!=WAIT_OBJECT_0){DWORD written=0;
    if(!(to==pipe?brokerIo(to,stop,data+offset,count-offset,written,true):WriteFile(to,data+offset,count-offset,&written,nullptr))||!written)return;
    offset+=written;
   }
  }
 };
 std::atomic<bool> inputDone{false},outputDone{false};
 std::thread incoming([&]{copy(GetStdHandle(STD_INPUT_HANDLE),pipe);SetEvent(stop);inputDone=true;});
 std::thread outgoing;
 try{outgoing=std::thread([&]{copy(pipe,GetStdHandle(STD_OUTPUT_HANDLE));SetEvent(stop);outputDone=true;});}
 catch(...){SetEvent(stop);while(!inputDone){CancelSynchronousIo(incoming.native_handle());Sleep(10);}incoming.join();CloseHandle(pipe);CloseHandle(stop);throw;}
 WaitForSingleObject(stop,INFINITE);
 // Repeat cancellation until both threads finish: EOF can race with a new
 // synchronous stdio operation. Overlapped pipe IO also observes stop itself.
 while(!inputDone||!outputDone){CancelIoEx(pipe,nullptr);if(!inputDone)CancelSynchronousIo(incoming.native_handle());if(!outputDone)CancelSynchronousIo(outgoing.native_handle());Sleep(10);}
 incoming.join();outgoing.join();CloseHandle(pipe);CloseHandle(stop);
 // On lock/unlock the old worker ends; the host starts a fresh generation in
 // the newly active desktop, retaining the authenticated connection.
 throw std::runtime_error("CAPTURE_DESKTOP_UNAVAILABLE: system desktop changed or worker ended");
}
