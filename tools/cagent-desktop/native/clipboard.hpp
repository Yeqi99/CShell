#pragma once
#include <shellapi.h>
#include <shlobj.h>
#include <gdiplus.h>
#include "clipboard-files.hpp"
// Clipboard transactions stay in the authenticated interactive desktop worker.
// Every command is <= 8 KiB; payloads use ordered bounded chunks, never a giant control line.
struct DesktopClipboard {
 std::vector<unsigned char> bytes;std::string kind;size_t offset=0;uint64_t until=0;bool writing=false;
 ULONG_PTR gdip=0;DesktopClipboard(){Gdiplus::GdiplusStartupInput input;if(Gdiplus::GdiplusStartup(&gdip,&input,nullptr)!=Gdiplus::Ok)throw std::runtime_error("CLIPBOARD_IMAGE_INIT");}
 ClipboardFiles files;HWND window=nullptr;
 ~DesktopClipboard(){if(window)DestroyWindow(window);if(gdip)Gdiplus::GdiplusShutdown(gdip);}
 static std::wstring wide(const std::string&s){int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0);if(n<0||(!s.empty()&&!n))throw std::runtime_error("CLIPBOARD_INVALID_UTF8");std::wstring r(n,L'\0');if(n)MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),(int)s.size(),r.data(),n);return r;}
 static std::string hex(const unsigned char*p,size_t n){const char*d="0123456789abcdef";std::string s;s.reserve(n*2);for(size_t i=0;i<n;i++){s.push_back(d[p[i]>>4]);s.push_back(d[p[i]&15]);}return s;}
 void clear(){bytes.clear();kind.clear();offset=0;writing=false;until=0;}
 void open(){if(!window)window=CreateWindowExW(0,L"STATIC",L"",0,0,0,0,0,HWND_MESSAGE,nullptr,GetModuleHandleW(nullptr),nullptr);if(!window||!OpenClipboard(window))throw std::runtime_error("CLIPBOARD_BUSY");}
 json command(const json&c){
  const auto action=c.at("action").get<std::string>();if(until&&GetTickCount64()>until)clear();
  if(action=="fileBegin")return files.begin(c.at("name").get<std::string>(),c.at("size").get<uint64_t>());
  if(action=="fileChunk"||action=="fileRead")return files.chunk(c);
  if(action=="filesCommit"){auto data=files.paths(c.at("fileTokens")).dump();command({{"action","begin"},{"kind","files"},{"size",data.size()}});for(size_t at=0;at<data.size();at+=2048)command({{"action","chunk"},{"offset",at},{"hex",hex((const unsigned char*)data.data()+at,std::min<size_t>(2048,data.size()-at))}});return command({{"action","commit"}});}
  if(action=="read"){
   clear();open();try{
    const UINT png=RegisterClipboardFormatW(L"PNG");
    if(IsClipboardFormatAvailable(CF_HDROP)){
     kind="files";HDROP h=(HDROP)GetClipboardData(CF_HDROP);UINT n=DragQueryFileW(h,0xffffffff,nullptr,0);if(n>128)throw std::runtime_error("CLIPBOARD_TOO_MANY_FILES");json paths=json::array();for(UINT i=0;i<n;i++){UINT len=DragQueryFileW(h,i,nullptr,0);if(len>32767)throw std::runtime_error("CLIPBOARD_PATH_TOO_LONG");std::wstring p(len+1,L'\0');DragQueryFileW(h,i,p.data(),len+1);paths.push_back(files.add(p.c_str()));}CloseClipboard();return {{"kind","files"},{"files",paths}};
    }else if(IsClipboardFormatAvailable(png)){
     kind="png";HANDLE h=GetClipboardData(png);SIZE_T n=GlobalSize(h);if(n>16*1024*1024)throw std::runtime_error("CLIPBOARD_TOO_LARGE");auto p=(unsigned char*)GlobalLock(h);if(!p)throw std::runtime_error("CLIPBOARD_READ_FAILED");bytes.assign(p,p+n);GlobalUnlock(h);
    }else if(IsClipboardFormatAvailable(CF_BITMAP)){
     kind="png";Gdiplus::Bitmap image((HBITMAP)GetClipboardData(CF_BITMAP),nullptr);if(image.GetLastStatus()!=Gdiplus::Ok||image.GetWidth()>16384||image.GetHeight()>16384||(uint64_t)image.GetWidth()*image.GetHeight()>33554432)throw std::runtime_error("CLIPBOARD_IMAGE_SIZE");IStream*stream=nullptr;if(FAILED(CreateStreamOnHGlobal(nullptr,TRUE,&stream)))throw std::runtime_error("CLIPBOARD_IMAGE_STREAM");const CLSID encoder={0x557cf406,0x1a04,0x11d3,{0x9a,0x73,0x00,0x00,0xf8,0x1e,0xf3,0x2e}};auto status=image.Save(stream,&encoder,nullptr);STATSTG info{};stream->Stat(&info,STATFLAG_NONAME);if(status!=Gdiplus::Ok||info.cbSize.QuadPart>16*1024*1024){stream->Release();throw std::runtime_error("CLIPBOARD_IMAGE_ENCODE");}bytes.resize((size_t)info.cbSize.QuadPart);LARGE_INTEGER zero{};stream->Seek(zero,STREAM_SEEK_SET,nullptr);ULONG count=0;stream->Read(bytes.data(),(ULONG)bytes.size(),&count);stream->Release();if(count!=bytes.size())throw std::runtime_error("CLIPBOARD_IMAGE_READ");
    }else if(IsClipboardFormatAvailable(CF_UNICODETEXT)){
     kind="text";HANDLE h=GetClipboardData(CF_UNICODETEXT);SIZE_T n=GlobalSize(h);if(n>4*1024*1024)throw std::runtime_error("CLIPBOARD_TOO_LARGE");auto p=(wchar_t*)GlobalLock(h);if(!p)throw std::runtime_error("CLIPBOARD_READ_FAILED");size_t len=0;while(len<n/2&&p[len])len++;std::wstring text(p,len);GlobalUnlock(h);auto s=utf8(text.c_str());bytes.assign(s.begin(),s.end());
    }else kind="empty";
   }catch(...){CloseClipboard();clear();throw;}CloseClipboard();until=GetTickCount64()+60000;return {{"kind",kind},{"size",bytes.size()}};
  }
  if(action=="begin"){
   clear();kind=c.at("kind").get<std::string>();auto size=c.at("size").get<size_t>();if((kind!="text"&&kind!="png"&&kind!="files")||size>16*1024*1024)throw std::runtime_error("CLIPBOARD_INVALID_TRANSFER");bytes.resize(size);writing=true;until=GetTickCount64()+60000;return {{"size",size}};
  }
  if(!until)throw std::runtime_error("CLIPBOARD_TRANSFER_EXPIRED");
  if(action=="chunk"){
   auto at=c.at("offset").get<size_t>();if(at!=offset)throw std::runtime_error("CLIPBOARD_OFFSET");
   if(writing){auto data=c.at("hex").get<std::string>();if(data.size()>4096||data.size()%2||offset+data.size()/2>bytes.size())throw std::runtime_error("CLIPBOARD_CHUNK_SIZE");auto digit=[](char x)->int{if(x>='0'&&x<='9')return x-'0';if(x>='a'&&x<='f')return x-'a'+10;throw std::runtime_error("CLIPBOARD_HEX");};for(size_t i=0;i<data.size();i+=2)bytes[offset++]=(unsigned char)((digit(data[i])<<4)|digit(data[i+1]));return {{"offset",offset}};}
   auto n=std::min<size_t>(2048,bytes.size()-offset);auto result=hex(bytes.data()+offset,n);offset+=n;return {{"hex",result},{"offset",offset},{"done",offset==bytes.size()}};
  }
  if(action!="commit"||!writing||offset!=bytes.size())throw std::runtime_error("CLIPBOARD_TRANSFER_INCOMPLETE");
  UINT format=0;HBITMAP bitmap=nullptr;std::vector<unsigned char> output;
  if(kind=="text"){auto w=wide(std::string(bytes.begin(),bytes.end()));w.push_back(0);output.resize(w.size()*2);memcpy(output.data(),w.data(),output.size());format=CF_UNICODETEXT;}
  else if(kind=="png"){if(bytes.size()<8||memcmp(bytes.data(),"\x89PNG\r\n\x1a\n",8))throw std::runtime_error("CLIPBOARD_INVALID_PNG");IStream*stream=nullptr;if(FAILED(CreateStreamOnHGlobal(nullptr,TRUE,&stream)))throw std::runtime_error("CLIPBOARD_IMAGE_STREAM");ULONG written=0;stream->Write(bytes.data(),(ULONG)bytes.size(),&written);LARGE_INTEGER zero{};stream->Seek(zero,STREAM_SEEK_SET,nullptr);{Gdiplus::Bitmap image(stream);if(image.GetLastStatus()!=Gdiplus::Ok||image.GetWidth()>16384||image.GetHeight()>16384||(uint64_t)image.GetWidth()*image.GetHeight()>33554432||image.GetHBITMAP(Gdiplus::Color(255,255,255),&bitmap)!=Gdiplus::Ok){stream->Release();throw std::runtime_error("CLIPBOARD_INVALID_IMAGE");}}stream->Release();format=RegisterClipboardFormatW(L"PNG");output=bytes;}
  else{auto paths=json::parse(bytes.begin(),bytes.end());if(!paths.is_array()||paths.size()>128)throw std::runtime_error("CLIPBOARD_FILES_INVALID");std::wstring all;for(const auto&v:paths){auto p=wide(v.get<std::string>());if(p.empty()||p.find(L'\0')!=std::wstring::npos)throw std::runtime_error("CLIPBOARD_PATH_INVALID");all+=p;all.push_back(0);}all.push_back(0);output.resize(sizeof(DROPFILES)+all.size()*2);DROPFILES header{};header.pFiles=sizeof(DROPFILES);header.fWide=TRUE;memcpy(output.data(),&header,sizeof(header));memcpy(output.data()+sizeof(header),all.data(),all.size()*2);format=CF_HDROP;}
  HGLOBAL memory=GlobalAlloc(GMEM_MOVEABLE,output.size());if(!memory){if(bitmap)DeleteObject(bitmap);throw std::runtime_error("CLIPBOARD_MEMORY");}auto p=GlobalLock(memory);if(!p){GlobalFree(memory);if(bitmap)DeleteObject(bitmap);throw std::runtime_error("CLIPBOARD_MEMORY");}memcpy(p,output.data(),output.size());GlobalUnlock(memory);
  try{open();}catch(...){GlobalFree(memory);if(bitmap)DeleteObject(bitmap);throw;}bool ok=EmptyClipboard()&&SetClipboardData(format,memory);if(bitmap&&!SetClipboardData(CF_BITMAP,bitmap))DeleteObject(bitmap);CloseClipboard();if(!ok){GlobalFree(memory);throw std::runtime_error("CLIPBOARD_WRITE_FAILED");}clear();return {{"written",true}};
 }
};




