// Exercise capture/input construction when the desktop cannot own clipboard windows.
#define wmain cagent_desktop_application_main
#include "../tools/cagent-desktop/native/desktop.cpp"
#undef wmain
int main(){
 auto station=CreateWindowStationW(nullptr,0,WINSTA_ALL_ACCESS,nullptr);
 if(!station||!SetProcessWindowStation(station))return 2;
 auto full=CreateDesktopW(L"NoClipboardOwner",nullptr,nullptr,0,GENERIC_ALL,nullptr);
 auto restricted=OpenDesktopW(L"NoClipboardOwner",0,FALSE,DESKTOP_READOBJECTS|DESKTOP_WRITEOBJECTS);
 if(!full||!restricted||!SetThreadDesktop(restricted))return 3;
 try{
  Capture capture;NativeInput input(capture,INVALID_HANDLE_VALUE);
  if(input.clipboard)throw std::runtime_error("clipboard was eagerly initialized");
  input.command({{"op","input-revoke"}},false);
  for(int attempt=0;attempt<2;attempt++){
   try{input.clipboard=std::make_unique<DesktopClipboard>();throw std::runtime_error("expected inaccessible owner");}
   catch(const std::runtime_error&e){if(std::string(e.what())!="CLIPBOARD_OWNER_INIT")throw;}
   if(input.clipboard)throw std::runtime_error("failed initialization cached");
  }
  std::cout<<"capture/input survives unavailable clipboard; failed initialization remains retryable\n";
 }catch(const std::exception&e){std::cerr<<e.what();return 1;}
 return 0;
}

