// Session routing is deliberately separate from input and never selects another user.
#include <wtsapi32.h>
static bool recoverySupportedWindows(){
 auto rtl=(LONG(WINAPI*)(OSVERSIONINFOW*))GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"RtlGetVersion");
 OSVERSIONINFOW v{};v.dwOSVersionInfoSize=sizeof(v);return rtl&&rtl(&v)==0&&v.dwMajorVersion>=10;
}
static bool sessionUnlocked(DWORD session){
 LPWSTR raw=nullptr;DWORD bytes=0;bool unlocked=false;
 if(WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE,session,WTSSessionInfoEx,&raw,&bytes)&&bytes>=sizeof(WTSINFOEXW)){
  auto info=(WTSINFOEXW*)raw;unlocked=info->Level==1&&info->Data.WTSInfoExLevel1.SessionFlags==1;
 }
 if(raw)WTSFreeMemory(raw);return unlocked;
}
static json recoveryPlan(const Identity& identity){
 need(!identity.worker,"Workers cannot route Windows sessions");
 const DWORD console=WTSGetActiveConsoleSessionId();
 WTS_CONNECTSTATE_CLASS state=WTSDown;USHORT protocol=0xffff;LPWSTR raw=nullptr;DWORD size=0;
 if(WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE,identity.session,WTSConnectState,&raw,&size)&&size>=sizeof(state))state=*(WTS_CONNECTSTATE_CLASS*)raw;
 if(raw)WTSFreeMemory(raw);raw=nullptr;
 if(WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE,identity.session,WTSClientProtocolType,&raw,&size)&&size>=sizeof(protocol))protocol=*(USHORT*)raw;
 if(raw)WTSFreeMemory(raw);raw=nullptr;
 bool occupied=true;
 if(console!=0xffffffff&&WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE,console,WTSUserName,&raw,&size))occupied=raw&&raw[0]!=0;
 if(raw)WTSFreeMemory(raw);
 const bool unlocked=recoverySupportedWindows()&&sessionUnlocked(identity.session);
 std::string reason=!recoverySupportedWindows()?"UNSUPPORTED_WINDOWS":console==identity.session?"ALREADY_CONSOLE":(console==0xffffffff||console==0)?"NO_CONSOLE":occupied?"CONSOLE_OCCUPIED":protocol!=2?"NOT_RDP":state!=WTSActive?"SESSION_NOT_ACTIVE":!unlocked?"SESSION_LOCKED_OR_UNKNOWN":"READY_TO_ATTEMPT";
 return {{"sessionId",identity.session},{"consoleSessionId",console},{"sourceState",(int)state},{"protocol",protocol},{"sourceUnlocked",unlocked},{"consoleOccupied",occupied},{"canAttempt",reason=="READY_TO_ATTEMPT"},{"reason",reason}};
}
static json recoverConsole(const Identity& identity,DWORD expectedSession,DWORD expectedConsole){
 const auto plan=recoveryPlan(identity);
 need(identity.session==expectedSession&&plan["consoleSessionId"]==expectedConsole&&plan["canAttempt"]==true,"Session state changed or recovery is unavailable; inspect a new plan");
 // Run the documented WTS API as the authenticated same-SID owner; the service's
 // SYSTEM identity must never supply passwordless authority over another user.
 Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,identity.pid)),token,impersonation;
 need(process.h&&OpenProcessToken(process,TOKEN_DUPLICATE|TOKEN_QUERY,token.put()),"Owner token unavailable");
 need(creationTime(process)==identity.created&&tokenSid(token)==allowedSid()&&tokenSession(token)==identity.session&&elevated(token),"Owner identity or session changed");
 need(DuplicateTokenEx(token,TOKEN_QUERY|TOKEN_IMPERSONATE,nullptr,SecurityImpersonation,TokenImpersonation,impersonation.put()),"Owner impersonation unavailable");
 need(ImpersonateLoggedOnUser(impersonation),"Cannot bind recovery to owner");
 wchar_t password[]=L"";BOOL accepted=WTSConnectSessionW(identity.session,expectedConsole,password,FALSE);DWORD error=accepted?0:GetLastError();
 need(RevertToSelf(),"Recovery impersonation cleanup failed");
 bool confirmed=false;
 if(accepted)for(int n=0;n<25;n++){if(WTSGetActiveConsoleSessionId()==identity.session){confirmed=true;break;}Sleep(100);}
 return {{"accepted",accepted!=0},{"confirmed",confirmed},{"errorCode",error},{"sessionId",identity.session},{"consoleSessionId",WTSGetActiveConsoleSessionId()}};
}
