#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
#include <algorithm>
#include <iostream>
#include "../tools/cagent-desktop/native/vendor/json.hpp"
using json=nlohmann::json;
std::string utf8(const wchar_t*s){int n=WideCharToMultiByte(CP_UTF8,0,s,-1,nullptr,0,nullptr,nullptr);std::string r(n,'\0');WideCharToMultiByte(CP_UTF8,0,s,-1,r.data(),n,nullptr,nullptr);if(n)r.pop_back();return r;}
#include "../tools/cagent-desktop/native/clipboard.hpp"
int main(){
 // A separate window station has its own clipboard. Never open WinSta0 clipboard.
 auto station=CreateWindowStationW(nullptr,0,WINSTA_ALL_ACCESS,nullptr);if(!station||!SetProcessWindowStation(station)){std::cerr<<"isolated window station unavailable";return 1;}
 auto desktop=CreateDesktopW(L"ClipboardAcceptance",nullptr,nullptr,0,DESKTOP_CREATEWINDOW|DESKTOP_READOBJECTS|DESKTOP_WRITEOBJECTS,nullptr);if(!desktop||!SetThreadDesktop(desktop)){std::cerr<<"isolated desktop unavailable";return 1;}
 try{DesktopClipboard c;auto sequence=c.command({{"action","sequence"}}).at("sequence").get<DWORD>();for(const std::string kind:{"text","png"}){std::string data=kind=="text"?"Unicode fixture \xe4\xb8\xad\xe6\x96\x87":kind=="png"?std::string("\x89PNG\r\n\x1a\n",8)+"fixture":"[\"C:\\\\clipboard-fixture.txt\"]";if(kind=="png"){IStream*stream=nullptr;CreateStreamOnHGlobal(nullptr,TRUE,&stream);Gdiplus::Bitmap image(2,2,PixelFormat32bppARGB);const CLSID encoder={0x557cf406,0x1a04,0x11d3,{0x9a,0x73,0,0,0xf8,0x1e,0xf3,0x2e}};image.Save(stream,&encoder,nullptr);STATSTG st{};stream->Stat(&st,STATFLAG_NONAME);data.resize((size_t)st.cbSize.QuadPart);LARGE_INTEGER z{};stream->Seek(z,STREAM_SEEK_SET,nullptr);ULONG n;stream->Read(data.data(),(ULONG)data.size(),&n);stream->Release();}c.command({{"action","begin"},{"kind",kind},{"size",data.size()}});c.command({{"action","chunk"},{"offset",0},{"hex",DesktopClipboard::hex((unsigned char*)data.data(),data.size())}});c.command({{"action","commit"}});auto current=c.command({{"action","sequence"}}).at("sequence").get<DWORD>();if(current==sequence)throw std::runtime_error("clipboard sequence did not change");sequence=current;auto meta=c.command({{"action","read"}});if(meta.at("kind")!=kind)throw std::runtime_error("kind mismatch");auto chunk=c.command({{"action","chunk"},{"offset",0}});if(kind!="files"&&chunk.at("hex")!=DesktopClipboard::hex((unsigned char*)data.data(),data.size()))throw std::runtime_error("payload mismatch");std::cout<<kind<<" isolated clipboard roundtrip passed\n";}auto f=c.command({{"action","fileBegin"},{"name","fixture.txt"},{"size",5}});c.command({{"action","fileChunk"},{"fileToken",f.at("fileToken")},{"offset",0},{"hex","68656c6c6f"}});c.command({{"action","filesCommit"},{"fileTokens",json::array({f.at("fileToken")})}});auto meta=c.command({{"action","read"}});auto token=meta.at("files").at(0).at("token");auto content=c.command({{"action","fileRead"},{"fileToken",token},{"offset",0}});if(content.at("hex")!="68656c6c6f")throw std::runtime_error("file data mismatch");std::cout<<"files isolated user-token roundtrip passed\n";return 0;}catch(const std::exception&e){std::cerr<<e.what();return 1;}
}


