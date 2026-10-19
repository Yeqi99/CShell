// User-mode named-pipe regression only: no service, desktop capture or input.
#include "../tools/cagent-desktop/native/desktop-broker-client.hpp"
#include <cassert>
#include <iostream>
int main(){
 std::wstring name=L"\\\\.\\pipe\\CAgentBrokerIoTest-"+std::to_wstring(GetCurrentProcessId());
 HANDLE server=CreateNamedPipeW(name.c_str(),PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED|FILE_FLAG_FIRST_PIPE_INSTANCE,PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,1,4096,4096,1000,nullptr);assert(server!=INVALID_HANDLE_VALUE);
 HANDLE client=CreateFileW(name.c_str(),GENERIC_READ|GENERIC_WRITE,0,nullptr,OPEN_EXISTING,0,nullptr);assert(client!=INVALID_HANDLE_VALUE);
 HANDLE connected=CreateEventW(nullptr,TRUE,FALSE,nullptr);OVERLAPPED connection{};connection.hEvent=connected;BOOL ok=ConnectNamedPipe(server,&connection);assert(ok||GetLastError()==ERROR_PIPE_CONNECTED);CloseHandle(connected);
 HANDLE stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);BYTE data[8]{};DWORD count=0;
 SetEvent(stop);assert(!brokerIo(server,stop,data,sizeof(data),count,false));ResetEvent(stop);
 bool result=true;ULONGLONG start=GetTickCount64();std::thread pending([&]{result=brokerIo(server,stop,data,sizeof(data),count,false);});Sleep(50);SetEvent(stop);pending.join();assert(!result&&GetTickCount64()-start<2000);
 ResetEvent(stop);std::thread reader([&]{result=brokerIo(server,stop,data,sizeof(data),count,false);});BYTE sent=42;DWORD written=0;assert(WriteFile(client,&sent,1,&written,nullptr)&&written==1);reader.join();assert(result&&count==1&&data[0]==42);
 CloseHandle(client);assert(!brokerIo(server,stop,data,sizeof(data),count,false));CloseHandle(server);CloseHandle(stop);
 std::cout<<"PASS: pre-cancel, pending overlapped cancellation, normal read, peer EOF\n";
}
