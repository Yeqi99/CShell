#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3d10.h>
#include <dxgi1_2.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <codecapi.h>

#include <wmcodecdsp.h>
#include <io.h>
#include <fcntl.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <functional>
#include <iostream>
#include <mutex>
#include <set>
#include <sstream>
#include <thread>
#include <vector>
#include "vendor/json.hpp"
#include "input-state.hpp"
#include "desktop-broker-client.hpp"
using json=nlohmann::json;
template<class T>struct Com{T*p=nullptr;~Com(){reset();}Com()=default;Com(const Com&)=delete;Com&operator=(const Com&)=delete;T*operator->()const{return p;}operator bool()const{return p!=nullptr;}T**put(){reset();return &p;}void reset(){if(p)p->Release();p=nullptr;}};
void check(HRESULT hr,const char*stage){if(FAILED(hr)){char b[128];snprintf(b,sizeof(b),"%s: HRESULT 0x%08lx",stage,(unsigned long)hr);throw std::runtime_error(b);}}
using Clock=std::chrono::steady_clock;
uint64_t micros(){return std::chrono::duration_cast<std::chrono::microseconds>(Clock::now().time_since_epoch()).count();}
// Sleep(1) can round to the system timer quantum (~15.6 ms). A private
// high-resolution waitable timer avoids imposing that latency on every MFT
// event poll without changing the system-wide timer resolution.
void pauseMicros(uint64_t us){
 struct Timer{HANDLE handle=CreateWaitableTimerExW(nullptr,nullptr,0x2,TIMER_ALL_ACCESS);Timer(){if(!handle)handle=CreateWaitableTimerW(nullptr,FALSE,nullptr);}~Timer(){if(handle)CloseHandle(handle);}};
 static thread_local Timer timer;
 if(!us)return;
 if(timer.handle){LARGE_INTEGER due;due.QuadPart=-(LONGLONG)us*10;if(SetWaitableTimer(timer.handle,&due,0,nullptr,nullptr,FALSE)){WaitForSingleObject(timer.handle,INFINITE);return;}}
 Sleep((DWORD)std::max<uint64_t>(1,(us+999)/1000));
}
std::string utf8(const wchar_t*s){int n=WideCharToMultiByte(CP_UTF8,0,s,-1,nullptr,0,nullptr,nullptr);std::string result(n,'\0');WideCharToMultiByte(CP_UTF8,0,s,-1,&result[0],n,nullptr,nullptr);if(!result.empty())result.pop_back();return result;}
bool systemWorker=false;
HDESK systemDesktop=nullptr;
void bindSystemDesktop(){
 HANDLE token=nullptr;if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))throw std::runtime_error("System desktop token unavailable");
 DWORD n=0;GetTokenInformation(token,TokenUser,nullptr,0,&n);std::vector<BYTE> buffer(n);BOOL ok=GetTokenInformation(token,TokenUser,buffer.data(),n,&n);CloseHandle(token);
 if(!ok||!IsWellKnownSid(((TOKEN_USER*)buffer.data())->User.Sid,WinLocalSystemSid))throw std::runtime_error("System desktop worker requires the installed service");
 // Request playback on the already-authorized input desktop; do not change its ACL or token.
 systemDesktop=OpenInputDesktop(0,FALSE,DESKTOP_READOBJECTS|DESKTOP_WRITEOBJECTS|DESKTOP_JOURNALPLAYBACK|DESKTOP_SWITCHDESKTOP);
 if(!systemDesktop||!SetThreadDesktop(systemDesktop))throw std::runtime_error("CAPTURE_DESKTOP_UNAVAILABLE");systemWorker=true;
}
void checkCaptureDesktop(){
 auto name=[](HDESK d){DWORD bytes=0;GetUserObjectInformationW(d,UOI_NAME,nullptr,0,&bytes);if(!bytes)throw std::runtime_error("CAPTURE_DESKTOP_UNAVAILABLE");std::vector<wchar_t> n(bytes/sizeof(wchar_t)+1);if(!GetUserObjectInformationW(d,UOI_NAME,n.data(),bytes,&bytes))throw std::runtime_error("CAPTURE_DESKTOP_UNAVAILABLE");return std::wstring(n.data());};
 HDESK input=OpenInputDesktop(0,FALSE,DESKTOP_READOBJECTS);if(!input)throw std::runtime_error("CAPTURE_SECURE_OR_INACCESSIBLE_DESKTOP");
 struct Close{HDESK p;~Close(){CloseDesktop(p);}}close{input};
 if((!systemWorker&&name(input)!=L"Default")||name(input)!=name(GetThreadDesktop(GetCurrentThreadId())))throw std::runtime_error("CAPTURE_SECURE_OR_DIFFERENT_DESKTOP");
}
std::mutex outputMutex;
void packet(json meta,const std::vector<uint8_t>&body={}){std::lock_guard<std::mutex>lock(outputMutex);std::string h=meta.dump();uint32_t sizes[2]={(uint32_t)h.size(),(uint32_t)body.size()};if(fwrite(sizes,4,2,stdout)!=2||fwrite(h.data(),1,h.size(),stdout)!=h.size()||(!body.empty()&&fwrite(body.data(),1,body.size(),stdout)!=body.size()))throw std::runtime_error("output pipe closed");fflush(stdout);}
struct Capture{
 Com<ID3D11Device> device;Com<ID3D11DeviceContext> context;Com<IDXGIOutputDuplication> duplication;Com<ID3D11Texture2D> stage;
 UINT width=0,height=0;double hz=0;LONG left=0,top=0;std::string name;
 std::string path="dxgi",fallback;HDC screen=nullptr,memoryDC=nullptr;HBITMAP bitmap=nullptr;HGDIOBJ original=nullptr;void*dib=nullptr;
 ~Capture(){if(memoryDC&&original)SelectObject(memoryDC,original);if(bitmap)DeleteObject(bitmap);if(memoryDC)DeleteDC(memoryDC);if(screen)ReleaseDC(nullptr,screen);}
 void openGdi(UINT index){
  checkCaptureDesktop();std::vector<MONITORINFOEXW> monitors;
  if(!EnumDisplayMonitors(nullptr,nullptr,[](HMONITOR m,HDC,LPRECT,LPARAM arg)->BOOL{MONITORINFOEXW info{};info.cbSize=sizeof(info);if(GetMonitorInfoW(m,&info))reinterpret_cast<std::vector<MONITORINFOEXW>*>(arg)->push_back(info);return TRUE;},reinterpret_cast<LPARAM>(&monitors)))throw std::runtime_error("GDI monitor enumeration failed");
  // If DXGI already identified a display, preserve that exact display across
  // fallback instead of assuming two different enumerators use the same order.
  if(!name.empty()){auto selected=std::find_if(monitors.begin(),monitors.end(),[&](const MONITORINFOEXW&m){return utf8(m.szDevice)==name;});if(selected==monitors.end())throw std::runtime_error("Selected DXGI display is absent from the current GDI session");index=(UINT)(selected-monitors.begin());}
  if(index>=monitors.size())throw std::runtime_error("GDI display not found in current session");auto&info=monitors[index];left=info.rcMonitor.left;top=info.rcMonitor.top;width=info.rcMonitor.right-left;height=info.rcMonitor.bottom-top;name=utf8(info.szDevice);if(!width||!height)throw std::runtime_error("GDI display has no area");
  DEVMODEW mode{};mode.dmSize=sizeof(mode);if(EnumDisplaySettingsW(info.szDevice,ENUM_CURRENT_SETTINGS,&mode))hz=mode.dmDisplayFrequency>1?mode.dmDisplayFrequency:0;
  screen=GetDC(nullptr);if(!screen)throw std::runtime_error("GDI screen DC unavailable");memoryDC=CreateCompatibleDC(screen);if(!memoryDC)throw std::runtime_error("GDI memory DC unavailable");
  BITMAPINFO bi{};bi.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);bi.bmiHeader.biWidth=width;bi.bmiHeader.biHeight=-(LONG)height;bi.bmiHeader.biPlanes=1;bi.bmiHeader.biBitCount=32;bi.bmiHeader.biCompression=BI_RGB;bitmap=CreateDIBSection(screen,&bi,DIB_RGB_COLORS,&dib,nullptr,0);if(!bitmap||!dib)throw std::runtime_error("GDI capture bitmap unavailable");original=SelectObject(memoryDC,bitmap);if(!original||original==HGDI_ERROR)throw std::runtime_error("GDI bitmap selection failed");path="gdi";
 }
 void open(UINT index){checkCaptureDesktop();try{openDxgi(index);}catch(const std::exception&e){fallback=e.what();duplication.reset();stage.reset();context.reset();device.reset();openGdi(index);}}
 void openDxgi(UINT index){
  Com<IDXGIFactory1> factory;check(CreateDXGIFactory1(__uuidof(IDXGIFactory1),(void**)factory.put()),"DXGI factory");
  Com<IDXGIAdapter1> adapter;Com<IDXGIOutput> output;UINT count=0;bool found=false;
  for(UINT a=0;factory->EnumAdapters1(a,adapter.put())!=DXGI_ERROR_NOT_FOUND;a++){
   for(UINT o=0;adapter->EnumOutputs(o,output.put())!=DXGI_ERROR_NOT_FOUND;o++){DXGI_OUTPUT_DESC available{};if(FAILED(output->GetDesc(&available))||!available.AttachedToDesktop||available.DesktopCoordinates.right<=available.DesktopCoordinates.left||available.DesktopCoordinates.bottom<=available.DesktopCoordinates.top)continue;if(count++==index){found=true;break;}}if(found)break;
  }if(!found)throw std::runtime_error("display not found");
  DXGI_OUTPUT_DESC desc{};check(output->GetDesc(&desc),"display description");left=desc.DesktopCoordinates.left;top=desc.DesktopCoordinates.top;name=utf8(desc.DeviceName);
  if(desc.Rotation!=DXGI_MODE_ROTATION_IDENTITY&&desc.Rotation!=DXGI_MODE_ROTATION_UNSPECIFIED)throw std::runtime_error("rotated display capture not implemented");
  DEVMODEW mode{};mode.dmSize=sizeof(mode);if(EnumDisplaySettingsW(desc.DeviceName,ENUM_CURRENT_SETTINGS,&mode))hz=mode.dmDisplayFrequency>1?mode.dmDisplayFrequency:0;
  D3D_FEATURE_LEVEL level;check(D3D11CreateDevice(adapter.p,D3D_DRIVER_TYPE_UNKNOWN,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,device.put(),&level,context.put()),"D3D11 device");
  Com<ID3D10Multithread> multithread;if(SUCCEEDED(device->QueryInterface(__uuidof(ID3D10Multithread),(void**)multithread.put())))multithread->SetMultithreadProtected(TRUE);
  Com<IDXGIOutput1> output1;check(output->QueryInterface(__uuidof(IDXGIOutput1),(void**)output1.put()),"DXGI output1");check(output1->DuplicateOutput(device.p,duplication.put()),"desktop duplication");
  DXGI_OUTDUPL_DESC dd{};duplication->GetDesc(&dd);width=dd.ModeDesc.Width;height=dd.ModeDesc.Height;
  D3D11_TEXTURE2D_DESC td{};td.Width=width;td.Height=height;td.MipLevels=1;td.ArraySize=1;td.Format=DXGI_FORMAT_B8G8R8A8_UNORM;td.SampleDesc.Count=1;td.Usage=D3D11_USAGE_STAGING;td.CPUAccessFlags=D3D11_CPU_ACCESS_READ;check(device->CreateTexture2D(&td,nullptr,stage.put()),"capture staging texture");
 }
 bool acquire(const std::function<void(ID3D11Texture2D*)>&consume,UINT timeout=16){
  checkCaptureDesktop();
  DXGI_OUTDUPL_FRAME_INFO info{};Com<IDXGIResource> resource;HRESULT hr=duplication->AcquireNextFrame(timeout,&info,resource.put());if(hr==DXGI_ERROR_WAIT_TIMEOUT)return false;check(hr,"capture frame");
  struct Release{IDXGIOutputDuplication*p;~Release(){p->ReleaseFrame();}}release{duplication.p};
  Com<ID3D11Texture2D> texture;check(resource->QueryInterface(__uuidof(ID3D11Texture2D),(void**)texture.put()),"capture texture");consume(texture.p);return true;
 }
 bool frame(std::vector<uint8_t>&bgra,UINT timeout=16){
  if(path=="gdi"){checkCaptureDesktop();if(!BitBlt(memoryDC,0,0,width,height,screen,left,top,SRCCOPY|CAPTUREBLT))throw std::runtime_error("GDI BitBlt failed: "+std::to_string(GetLastError()));GdiFlush();bgra.resize((size_t)width*height*4);memcpy(bgra.data(),dib,bgra.size());return true;}
  return acquire([&](ID3D11Texture2D*texture){
  context->CopyResource(stage.p,texture);D3D11_MAPPED_SUBRESOURCE mapped{};check(context->Map(stage.p,0,D3D11_MAP_READ,0,&mapped),"capture map");
  bgra.resize((size_t)width*height*4);for(UINT y=0;y<height;y++)memcpy(bgra.data()+(size_t)y*width*4,(uint8_t*)mapped.pData+(size_t)y*mapped.RowPitch,width*4);context->Unmap(stage.p,0);
 },timeout);
 }
};
struct GpuConverter{
 Com<ID3D11VideoDevice> device;Com<ID3D11VideoContext> context;Com<ID3D11VideoProcessorEnumerator> enumerator;Com<ID3D11VideoProcessor> processor;Com<ID3D11Texture2D> texture;Com<ID3D11VideoProcessorOutputView> output;
 void open(Capture&capture,UINT w,UINT h,UINT fps){
  if(!capture.device)throw std::runtime_error("Capture backend has no D3D11 device; CPU conversion required");
  check(capture.device->QueryInterface(__uuidof(ID3D11VideoDevice),(void**)device.put()),"video device");check(capture.context->QueryInterface(__uuidof(ID3D11VideoContext),(void**)context.put()),"video context");
  D3D11_VIDEO_PROCESSOR_CONTENT_DESC desc{};desc.InputFrameFormat=D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;desc.InputWidth=capture.width;desc.InputHeight=capture.height;desc.OutputWidth=w;desc.OutputHeight=h;desc.InputFrameRate={fps,1};desc.OutputFrameRate={fps,1};desc.Usage=D3D11_VIDEO_USAGE_OPTIMAL_SPEED;
  check(device->CreateVideoProcessorEnumerator(&desc,enumerator.put()),"video processor enumeration");UINT in=0,out=0;check(enumerator->CheckVideoProcessorFormat(DXGI_FORMAT_B8G8R8A8_UNORM,&in),"BGRA video support");check(enumerator->CheckVideoProcessorFormat(DXGI_FORMAT_NV12,&out),"NV12 video support");if(!(in&D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_INPUT)||!(out&D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT))throw std::runtime_error("GPU BGRA/NV12 conversion unsupported");
  check(device->CreateVideoProcessor(enumerator.p,0,processor.put()),"video processor");
  D3D11_TEXTURE2D_DESC td{};td.Width=w;td.Height=h;td.MipLevels=1;td.ArraySize=1;td.Format=DXGI_FORMAT_NV12;td.SampleDesc.Count=1;td.Usage=D3D11_USAGE_DEFAULT;td.BindFlags=D3D11_BIND_RENDER_TARGET;
  check(capture.device->CreateTexture2D(&td,nullptr,texture.put()),"GPU NV12 texture");D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC ov{};ov.ViewDimension=D3D11_VPOV_DIMENSION_TEXTURE2D;check(device->CreateVideoProcessorOutputView(texture.p,enumerator.p,&ov,output.put()),"video output view");
  RECT source{0,0,(LONG)capture.width,(LONG)capture.height},target{0,0,(LONG)w,(LONG)h};context->VideoProcessorSetStreamSourceRect(processor.p,0,TRUE,&source);context->VideoProcessorSetStreamDestRect(processor.p,0,TRUE,&target);context->VideoProcessorSetOutputTargetRect(processor.p,TRUE,&target);context->VideoProcessorSetStreamFrameFormat(processor.p,0,D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);context->VideoProcessorSetStreamAutoProcessingMode(processor.p,0,FALSE);
  D3D11_VIDEO_PROCESSOR_COLOR_SPACE rgb{},yuv{};rgb.Nominal_Range=D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_0_255;yuv.YCbCr_Matrix=1;yuv.Nominal_Range=D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;context->VideoProcessorSetStreamColorSpace(processor.p,0,&rgb);context->VideoProcessorSetOutputColorSpace(processor.p,&yuv);
 }
 void convert(ID3D11Texture2D*source){D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC iv{};iv.ViewDimension=D3D11_VPIV_DIMENSION_TEXTURE2D;Com<ID3D11VideoProcessorInputView> input;check(device->CreateVideoProcessorInputView(source,enumerator.p,&iv,input.put()),"video input view");D3D11_VIDEO_PROCESSOR_STREAM stream{};stream.Enable=TRUE;stream.pInputSurface=input.p;check(context->VideoProcessorBlt(processor.p,output.p,0,1,&stream),"GPU BGRA to NV12");}
};
// SendInput is deliberately confined to this optional, default-denied private
// pipe owner. Secure desktop access additionally requires the installed system broker.
struct NativeInput {
 Capture& capture;HANDLE pipe;std::mutex mutex;std::atomic<bool> quitting{false};
 InputState state;std::thread watchdog;
 static std::wstring desktopName(HDESK desktop){
  DWORD bytes=0;GetUserObjectInformationW(desktop,UOI_NAME,nullptr,0,&bytes);
  if(!bytes)throw std::runtime_error("INPUT_DESKTOP_UNAVAILABLE");
  std::vector<wchar_t> name(bytes/sizeof(wchar_t)+1);
  if(!GetUserObjectInformationW(desktop,UOI_NAME,name.data(),bytes,&bytes))throw std::runtime_error("INPUT_DESKTOP_UNAVAILABLE");return name.data();
 }
 static void checkDesktop(){
  HDESK active=OpenInputDesktop(0,FALSE,DESKTOP_READOBJECTS);
  if(!active)throw std::runtime_error("INPUT_SECURE_OR_INACCESSIBLE_DESKTOP");
  struct Close{HDESK value;~Close(){CloseDesktop(value);}} close{active};
  auto current=desktopName(GetThreadDesktop(GetCurrentThreadId()));auto target=desktopName(active);
  if(current!=target||(!systemWorker&&target!=L"Default"))throw std::runtime_error("INPUT_SECURE_OR_DIFFERENT_DESKTOP");
 }
 void inject(const json&e){
  checkDesktop();INPUT value{};const auto kind=e.at("kind").get<std::string>();
  if(kind=="secure-attention"){
#ifdef CAGENT_EXPERIMENTAL_SYSTEM_BROKER
   if(!systemWorker||!brokerSecureAttentionAvailable())throw std::runtime_error("INPUT_SECURE_ATTENTION_UNAVAILABLE");
   brokerSecureAttention();return;
#else
   throw std::runtime_error("INPUT_SECURE_ATTENTION_UNAVAILABLE");
#endif
  }
  if(kind=="text"){
   auto text=e.at("text").get<std::string>();int length=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),(int)text.size(),nullptr,0);
   if(length<=0||length>512)throw std::runtime_error("INPUT_INVALID_TEXT");std::wstring wide(length,L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text.data(),(int)text.size(),wide.data(),length);
   std::vector<INPUT> inputs;inputs.reserve(length*2);for(wchar_t unit:wide){INPUT down{};down.type=INPUT_KEYBOARD;down.ki.wScan=unit;down.ki.dwFlags=KEYEVENTF_UNICODE;inputs.push_back(down);down.ki.dwFlags|=KEYEVENTF_KEYUP;inputs.push_back(down);}
   if(SendInput((UINT)inputs.size(),inputs.data(),sizeof(INPUT))!=inputs.size())throw std::runtime_error("INPUT_TEXT_FAILED");return;
  }
  if(kind=="key"){
   auto code=e.at("code").get<unsigned>();value.type=INPUT_KEYBOARD;value.ki.wScan=(WORD)(code&0xff);
   value.ki.dwFlags=KEYEVENTF_SCANCODE|((code&0x100)?KEYEVENTF_EXTENDEDKEY:0)|(e.at("down").get<bool>()?0:KEYEVENTF_KEYUP);
  }else{
   value.type=INPUT_MOUSE;
   if(kind=="button"){
    auto button=e.at("button").get<unsigned>();bool down=e.at("down").get<bool>();
    const DWORD downs[]={MOUSEEVENTF_LEFTDOWN,MOUSEEVENTF_RIGHTDOWN,MOUSEEVENTF_MIDDLEDOWN,MOUSEEVENTF_XDOWN,MOUSEEVENTF_XDOWN};
    const DWORD ups[]={MOUSEEVENTF_LEFTUP,MOUSEEVENTF_RIGHTUP,MOUSEEVENTF_MIDDLEUP,MOUSEEVENTF_XUP,MOUSEEVENTF_XUP};
    value.mi.dwFlags=down?downs[button]:ups[button];if(button>=3)value.mi.mouseData=button==3?XBUTTON1:XBUTTON2;
   }else if(kind=="move"){
    const int left=GetSystemMetrics(SM_XVIRTUALSCREEN),top=GetSystemMetrics(SM_YVIRTUALSCREEN),width=GetSystemMetrics(SM_CXVIRTUALSCREEN),height=GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if(width<=1||height<=1||!capture.width||!capture.height||capture.left<left||capture.top<top||(int64_t)capture.left+capture.width>(int64_t)left+width||(int64_t)capture.top+capture.height>(int64_t)top+height)throw std::runtime_error("INPUT_DISPLAY_CHANGED_RESTART_REQUIRED");
    const double x=capture.left+e.at("x").get<double>()*(capture.width-1),y=capture.top+e.at("y").get<double>()*(capture.height-1);
    value.mi.dx=(LONG)std::llround((x-left)*65535.0/(width-1));value.mi.dy=(LONG)std::llround((y-top)*65535.0/(height-1));
    value.mi.dwFlags=MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE|MOUSEEVENTF_VIRTUALDESK;
   }else if(kind=="wheel"){
    value.mi.dwFlags=e.value("horizontal",false)?MOUSEEVENTF_HWHEEL:MOUSEEVENTF_WHEEL;value.mi.mouseData=(DWORD)e.at("delta").get<int>();
   }else throw std::runtime_error("INPUT_UNSUPPORTED_KIND");
  }
  SetLastError(ERROR_SUCCESS);
  if(SendInput(1,&value,sizeof(value))!=1)throw std::runtime_error("INPUT_INJECTION_FAILED_POSSIBLE_UIPI_OR_DESKTOP_RESTRICTION win32="+std::to_string(GetLastError()));
 }
 NativeInput(Capture& display,HANDLE input):capture(display),pipe(input),state([this](const json&e){inject(e);}){
  watchdog=std::thread([this]{if(systemWorker&&!SetThreadDesktop(systemDesktop))return;bool reported=false;while(!quitting){
   {std::lock_guard<std::mutex> lock(mutex);try{
    DWORD available=0;if(!PeekNamedPipe(pipe,nullptr,0,nullptr,&available,nullptr))state.revoke();else state.tick(micros()/1000);
    reported=false;
   }catch(const std::exception&e){if(!reported)std::cerr<<"input release pending: "<<e.what()<<std::endl;reported=true;}}
   Sleep(50);
  }});
 }
 json command(const json&c,bool initialized){
  std::lock_guard<std::mutex> lock(mutex);const auto op=c.at("op").get<std::string>();
  if(op=="input-grant"){
   if(!initialized)throw std::runtime_error("INPUT_CAPTURE_NOT_READY");checkDesktop();state.grant(InputState::integer(c.at("generation")),micros()/1000);
  }else if(op=="input-revoke")state.revoke();else state.apply(c.at("event"),micros()/1000);
  return {{"type","input-status"},{"allowed",state.allowed},{"generation",state.generation},{"sequence",state.lastSequence},{"ownedKeys",state.keys.size()},{"ownedButtons",state.buttons.size()}};
 }
 ~NativeInput(){quitting=true;if(watchdog.joinable())watchdog.join();try{state.revoke();}catch(const std::exception&e){std::cerr<<"INPUT_RELEASE_FAILED ownedKeys="<<state.keys.size()<<" ownedButtons="<<state.buttons.size()<<" "<<e.what()<<std::endl;}}
};
uint8_t clamp(int x){return(uint8_t)std::max(0,std::min(255,x));}
void nv12(const std::vector<uint8_t>&src,UINT sw,UINT sh,std::vector<uint8_t>&out,UINT w,UINT h){
 out.resize((size_t)w*h*3/2);
 if(sw==w&&sh==h){
  for(UINT y=0;y<h;y+=2)for(UINT x=0;x<w;x+=2){int rr=0,gg=0,bb=0;
   const uint8_t*base=src.data()+((size_t)y*w+x)*4;
   for(UINT dy=0;dy<2;dy++)for(UINT dx=0;dx<2;dx++){auto p=base+(size_t)dy*w*4+dx*4;int b=p[0],g=p[1],r=p[2];out[(size_t)(y+dy)*w+x+dx]=clamp(((47*r+157*g+16*b+128)>>8)+16);rr+=r;gg+=g;bb+=b;}
   rr/=4;gg/=4;bb/=4;size_t uv=(size_t)w*h+(size_t)(y/2)*w+x;out[uv]=clamp(((-26*rr-87*gg+112*bb+128)>>8)+128);out[uv+1]=clamp(((112*rr-102*gg-10*bb+128)>>8)+128);
  }return;
 }
 // Scale coordinate divisions once per column/row, not four times per pixel.
 // Retain the exact BT.709 limited-range conversion and 2x2 chroma average.
 std::vector<size_t> columns(w);for(UINT x=0;x<w;x++)columns[x]=((size_t)x*sw/w)*4;
 for(UINT y=0;y<h;y+=2){
  const uint8_t*rows[]={src.data()+((size_t)y*sh/h)*sw*4,src.data()+((size_t)(y+1)*sh/h)*sw*4};
  for(UINT x=0;x<w;x+=2){int rr=0,gg=0,bb=0;for(UINT dy=0;dy<2;dy++)for(UINT dx=0;dx<2;dx++){auto p=rows[dy]+columns[x+dx];int b=p[0],g=p[1],r=p[2];out[(size_t)(y+dy)*w+x+dx]=clamp(((47*r+157*g+16*b+128)>>8)+16);rr+=r;gg+=g;bb+=b;}rr/=4;gg/=4;bb/=4;size_t uv=(size_t)w*h+(size_t)(y/2)*w+x;out[uv]=clamp(((-26*rr-87*gg+112*bb+128)>>8)+128);out[uv+1]=clamp(((112*rr-102*gg-10*bb+128)>>8)+128);}
 }
}
struct Encoder{
 Com<IMFTransform> transform;Com<IMFMediaEventGenerator> events;Com<ICodecAPI> codec;Com<IMFDXGIDeviceManager> manager;bool hardware=false,async=false,needInput=false;UINT width=0,height=0,fps=0,bitrate=0;std::string name;uint64_t frameNo=0;
 void set(const GUID&key,ULONG value){if(!codec)return;VARIANT v;VariantInit(&v);v.vt=VT_UI4;v.ulVal=value;codec->SetValue(&key,&v);}
 void initialize(IMFActivate*activate,UINT w,UINT h,UINT f,UINT b,bool hw,ID3D11Device*d3d=nullptr){
  check(activate->ActivateObject(__uuidof(IMFTransform),(void**)transform.put()),"activate encoder");hardware=hw;width=w;height=h;fps=f;bitrate=b;
  wchar_t*n=nullptr;UINT32 length=0;if(SUCCEEDED(activate->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute,&n,&length))){name=utf8(n);CoTaskMemFree(n);}
  Com<IMFAttributes> attributes;check(transform->GetAttributes(attributes.put()),"encoder attributes");UINT32 value=0;attributes->GetUINT32(MF_TRANSFORM_ASYNC,&value);async=value!=0;if(async){check(attributes->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK,TRUE),"async encoder unlock");check(transform->QueryInterface(__uuidof(IMFMediaEventGenerator),(void**)events.put()),"encoder event generator");}
  if(d3d){UINT32 aware=0;attributes->GetUINT32(MF_SA_D3D11_AWARE,&aware);if(!aware)throw std::runtime_error("Encoder has no D3D11 surface support");UINT token=0;check(MFCreateDXGIDeviceManager(&token,manager.put()),"DXGI device manager");check(manager->ResetDevice(d3d,token),"DXGI encoder device");check(transform->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER,(ULONG_PTR)manager.p),"encoder D3D11 manager");}
  const GUID codecInterface={0x901db4c7,0x31ce,0x41a2,{0x85,0xdc,0x8f,0xa0,0xbf,0x41,0xb8,0xda}}; transform->QueryInterface(codecInterface,(void**)codec.put());if(codec){VARIANT v;VariantInit(&v);v.vt=VT_BOOL;v.boolVal=VARIANT_TRUE;codec->SetValue(&CODECAPI_AVLowLatencyMode,&v);set(CODECAPI_AVEncMPVDefaultBPictureCount,0);set(CODECAPI_AVEncCommonRateControlMode,eAVEncCommonRateControlMode_CBR);set(CODECAPI_AVEncCommonMeanBitRate,b);set(CODECAPI_AVEncVideoInputColorTransferMatrix,eAVEncVideoColorTransferMatrix_BT709);set(CODECAPI_AVEncVideoOutputColorTransferMatrix,eAVEncVideoColorTransferMatrix_BT709);set(CODECAPI_AVEncVideoInputColorNominalRange,eAVEncVideoColorNominalRange_16_235);set(CODECAPI_AVEncVideoOutputColorNominalRange,eAVEncVideoColorNominalRange_16_235);}
  Com<IMFMediaType> output;check(MFCreateMediaType(output.put()),"output type");output->SetGUID(MF_MT_MAJOR_TYPE,MFMediaType_Video);output->SetGUID(MF_MT_SUBTYPE,MFVideoFormat_H264);output->SetUINT32(MF_MT_AVG_BITRATE,b);output->SetUINT32(MF_MT_INTERLACE_MODE,MFVideoInterlace_Progressive);output->SetUINT32(MF_MT_MPEG2_PROFILE,eAVEncH264VProfile_Main);output->SetUINT32(MF_MT_YUV_MATRIX,MFVideoTransferMatrix_BT709);output->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE,MFNominalRange_16_235);MFSetAttributeSize(output.p,MF_MT_FRAME_SIZE,w,h);MFSetAttributeRatio(output.p,MF_MT_FRAME_RATE,f,1);MFSetAttributeRatio(output.p,MF_MT_PIXEL_ASPECT_RATIO,1,1);check(transform->SetOutputType(0,output.p,0),"H264 output type");
  Com<IMFMediaType> input;check(MFCreateMediaType(input.put()),"input type");input->SetGUID(MF_MT_MAJOR_TYPE,MFMediaType_Video);input->SetGUID(MF_MT_SUBTYPE,MFVideoFormat_NV12);input->SetUINT32(MF_MT_INTERLACE_MODE,MFVideoInterlace_Progressive);input->SetUINT32(MF_MT_YUV_MATRIX,MFVideoTransferMatrix_BT709);input->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE,MFNominalRange_16_235);MFSetAttributeSize(input.p,MF_MT_FRAME_SIZE,w,h);MFSetAttributeRatio(input.p,MF_MT_FRAME_RATE,f,1);MFSetAttributeRatio(input.p,MF_MT_PIXEL_ASPECT_RATIO,1,1);check(transform->SetInputType(0,input.p,0),"NV12 input type");
  check(transform->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING,0),"begin encoding");check(transform->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM,0),"start encoding");
 }
 void open(UINT w,UINT h,UINT f,UINT b,ID3D11Device*d3d=nullptr){
  std::string failures;
  for(bool hw:{true,false}){IMFActivate**list=nullptr;UINT32 count=0;MFT_REGISTER_TYPE_INFO output={MFMediaType_Video,MFVideoFormat_H264};UINT flags=MFT_ENUM_FLAG_SORTANDFILTER|(hw?MFT_ENUM_FLAG_HARDWARE:MFT_ENUM_FLAG_SYNCMFT|MFT_ENUM_FLAG_LOCALMFT);check(MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER,flags,nullptr,&output,&list,&count),"enumerate encoders");
   bool ok=false;for(UINT i=0;i<count&&!ok;i++){try{initialize(list[i],w,h,f,b,hw,d3d);ok=true;}catch(const std::exception&e){failures+=e.what();failures+=';';codec.reset();events.reset();transform.reset();manager.reset();needInput=false;list[i]->ShutdownObject();}}
   for(UINT i=0;i<count;i++)list[i]->Release();CoTaskMemFree(list);if(ok)return;
  }throw std::runtime_error("No usable H264 encoder: "+failures);
 }
 bool output(std::vector<uint8_t>&bytes,bool&key){
  MFT_OUTPUT_STREAM_INFO info{};check(transform->GetOutputStreamInfo(0,&info),"output stream info");Com<IMFSample> own;Com<IMFMediaBuffer> buffer;
  if(!(info.dwFlags&MFT_OUTPUT_STREAM_PROVIDES_SAMPLES)){check(MFCreateSample(own.put()),"output sample");check(MFCreateMemoryBuffer(std::max<UINT>(info.cbSize,width*height*2),buffer.put()),"output buffer");own->AddBuffer(buffer.p);}
  MFT_OUTPUT_DATA_BUFFER data{};data.pSample=own.p;DWORD status=0;HRESULT hr=transform->ProcessOutput(0,1,&data,&status);if(data.pEvents)data.pEvents->Release();
  if(hr==MF_E_TRANSFORM_NEED_MORE_INPUT)return false;if(hr==MF_E_TRANSFORM_STREAM_CHANGE){Com<IMFMediaType> changed;check(transform->GetOutputAvailableType(0,0,changed.put()),"encoder changed output type");check(transform->SetOutputType(0,changed.p,0),"encoder output renegotiation");return false;}check(hr,"encode output");
  Com<IMFSample> provided;if(!own)provided.p=data.pSample;IMFSample*sample=data.pSample;if(!sample)return false;Com<IMFMediaBuffer> packed;check(sample->ConvertToContiguousBuffer(packed.put()),"encoded buffer");BYTE*p=nullptr;DWORD size=0;check(packed->Lock(&p,nullptr,&size),"encoded buffer lock");bytes.assign(p,p+size);packed->Unlock();UINT32 clean=0;sample->GetUINT32(MFSampleExtension_CleanPoint,&clean);key=clean!=0;return !bytes.empty();
 }
 bool eventOutput(std::vector<uint8_t>&bytes,bool&key){Com<IMFMediaEvent> event;HRESULT hr=events->GetEvent(MF_EVENT_FLAG_NO_WAIT,event.put());if(hr==MF_E_NO_EVENTS_AVAILABLE)return false;check(hr,"encoder event");MediaEventType type;event->GetType(&type);HRESULT status;event->GetStatus(&status);check(status,"encoder event status");if(type==METransformNeedInput)needInput=true;if(type==METransformHaveOutput)return output(bytes,key);return false;}
 bool encode(const std::vector<uint8_t>&input,std::vector<uint8_t>&bytes,bool&key,bool force,ID3D11Texture2D*surface=nullptr){
  if(force)set(CODECAPI_AVEncVideoForceKeyFrame,1);
  if(async){auto until=Clock::now()+std::chrono::seconds(2);while(!needInput){if(eventOutput(bytes,key))return true;if(Clock::now()>until)throw std::runtime_error("hardware encoder input timeout");pauseMicros(500);}needInput=false;}
  Com<IMFSample> sample;Com<IMFMediaBuffer> buffer;check(MFCreateSample(sample.put()),"input sample");
  if(surface){check(MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D),surface,0,FALSE,buffer.put()),"GPU sample buffer");}
  else{check(MFCreateMemoryBuffer((DWORD)input.size(),buffer.put()),"input buffer");BYTE*p=nullptr;check(buffer->Lock(&p,nullptr,nullptr),"input lock");memcpy(p,input.data(),input.size());buffer->Unlock();buffer->SetCurrentLength((DWORD)input.size());}
  sample->AddBuffer(buffer.p);sample->SetSampleTime((LONGLONG)frameNo*10000000/fps);sample->SetSampleDuration(10000000/fps);frameNo++;check(transform->ProcessInput(0,sample.p,0),"encode input");
  if(!async)return output(bytes,key);
  auto until=Clock::now()+std::chrono::seconds(2);while(Clock::now()<until){if(eventOutput(bytes,key))return true;pauseMicros(500);}throw std::runtime_error("hardware encoder output timeout");
 }
 ~Encoder(){if(transform){transform->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH,0);transform->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING,0);}}
};

// The host owns authentication, authorization and network IO. This helper only
// accepts a private inherited pipe. One frame credit bounds the output queue.
void workerTrace(const wchar_t* message){if(!systemWorker)return;HANDLE log=RegisterEventSourceW(nullptr,L"CAgentDesktopBroker");if(log){ReportEventW(log,EVENTLOG_INFORMATION_TYPE,0,1,nullptr,1,0,&message,nullptr);DeregisterEventSource(log);}}
void stream(){workerTrace(L"Worker stream entered");
 _setmode(_fileno(stdout),_O_BINARY);
 HANDLE input=GetStdHandle(STD_INPUT_HANDLE);DWORD mode=0;
 if(GetFileType(input)!=FILE_TYPE_PIPE||GetConsoleMode(input,&mode))throw std::runtime_error("stream requires an inherited control pipe");
 std::string pending;bool stop=false,credit=false,force=true;json settings;
 Capture capture;GpuConverter converter;Encoder encoder;bool initialized=false,gpu=false;std::string gpuFallback;json active;uint64_t frame=0,last=0;NativeInput inputOwner(capture,input);
 auto commands=[&](){
  DWORD available=0;if(!PeekNamedPipe(input,nullptr,0,nullptr,&available,nullptr)){stop=true;return;}
  while(available){char bytes[4096];DWORD read=0;if(!ReadFile(input,bytes,std::min<DWORD>(available,sizeof(bytes)),&read,nullptr)||!read){stop=true;return;}pending.append(bytes,read);
   size_t end;while((end=pending.find('\n'))!=std::string::npos){if(end>8192)throw std::runtime_error("control command too large");auto command=json::parse(pending.substr(0,end));pending.erase(0,end+1);auto op=command.value("op",std::string());
    if(op=="configure"){workerTrace(L"Worker configuration received");settings=command;force=true;}else if(op=="ack")credit=true;else if(op=="keyframe")force=true;else if(op=="stop")stop=true;
    else if(op=="input-grant"||op=="input-revoke"||op=="input-event"){
     try{packet(inputOwner.command(command,initialized));}catch(const std::exception&e){packet({{"type","input-error"},{"message",e.what()}});}
    }else throw std::runtime_error("unsupported control command");
   }if(pending.size()>8192)throw std::runtime_error("control command too large");if(!PeekNamedPipe(input,nullptr,0,nullptr,&available,nullptr)){stop=true;return;}
  }
 };
 std::vector<uint8_t>bgra,yuv,encoded;
 while(!stop){commands();if(stop)break;if(settings.empty()){Sleep(2);continue;}
  if(active!=settings){
   if(initialized)throw std::runtime_error("configuration changed; restart helper with fresh stream generation");
   UINT display=settings.value("display",0u);if(settings.value("forceGdi",0u)){checkCaptureDesktop();capture.fallback="DXGI capture invalid call; recovered with GDI";capture.openGdi(display);}else capture.open(display);
   UINT w=std::min(settings.value("width",capture.width),capture.width)&~1u,h=std::min(settings.value("height",capture.height),capture.height)&~1u;
   UINT fps=settings.value("fps",(UINT)std::max(1.0,capture.hz)),bitrate=settings.value("bitrate",0u);
   uint64_t memory=settings.value("memoryBudgetBytes",(uint64_t)256*1024*1024);
   if(!w||!h||!fps||!bitrate||w>capture.width||h>capture.height||(uint64_t)capture.width*capture.height*4+(uint64_t)w*h*4>memory||memory>SIZE_MAX)throw std::runtime_error("capture settings exceed source or memory budget");
   try{converter.open(capture,w,h,fps);encoder.open(w,h,fps,bitrate,capture.device.p);gpu=true;}catch(const std::exception&e){gpuFallback=e.what();encoder.open(w,h,fps,bitrate);}
   active=settings;initialized=true;workerTrace(L"Worker capture ready");
   bool secureAttention=false;
#ifdef CAGENT_EXPERIMENTAL_SYSTEM_BROKER
   secureAttention=systemWorker&&brokerSecureAttentionAvailable();
#endif
   packet({{"type","ready"},{"systemDesktop",systemWorker},{"secureAttention",secureAttention},{"width",w},{"height",h},{"sourceWidth",capture.width},{"sourceHeight",capture.height},{"fps",fps},{"hardware",encoder.hardware},{"encoder",encoder.name},{"input",false},{"pixelPath",gpu?"d3d11-nv12-surface":"cpu-nv12"},{"gpuFallback",gpuFallback},{"colorMatrix","bt709"},{"fullRange",false},{"capturePath",capture.path},{"captureFallback",capture.fallback}});
  }
  if(!credit){pauseMicros(1000);continue;}
  auto now=micros();if(last&&now-last<1000000/encoder.fps){pauseMicros(std::min<uint64_t>(1000,1000000/encoder.fps-(now-last)));continue;}
  auto started=micros(),captured=started;
  if(gpu){if(!capture.acquire([&](ID3D11Texture2D*t){captured=micros();converter.convert(t);},5))continue;}
  else{if(!capture.frame(bgra,5))continue;captured=micros();nv12(bgra,capture.width,capture.height,yuv,encoder.width,encoder.height);}
  auto converted=micros();bool key=false;
  if(encoder.encode(yuv,encoded,key,force,gpu?converter.texture.p:nullptr)){
   auto finished=micros();packet({{"type","frame"},{"id",frame++},{"key",key},{"timestampUs",captured},{"captureUs",captured-started},{"convertUs",converted-captured},{"encodeUs",finished-converted}},encoded);
   credit=false;force=false;last=started;
  }
 }
}
int wmain(int argc,wchar_t**argv){
 try{
#ifdef CAGENT_EXPERIMENTAL_SYSTEM_BROKER
  if(argc==2&&std::wstring(argv[1])==L"--recovery-plan"){std::cout<<brokerControl(4)<<std::endl;return 0;}
  if(argc==4&&std::wstring(argv[1])==L"--recover-console"){
   auto number=[](const wchar_t* s){std::wstring text(s);if(text.empty()||text.size()>10||!std::all_of(text.begin(),text.end(),[](wchar_t c){return c>=L'0'&&c<=L'9';}))throw std::runtime_error("Invalid recovery plan");return (DWORD)std::stoul(text);};
   std::cout<<brokerControl(5,number(argv[2]),number(argv[3]))<<std::endl;return 0;
  }
  if(argc>2&&std::wstring(argv[1])==L"--system-pipe"){bindSystemDesktop();connectSystemWorker(argv[2]);}
  else if(argc>1&&std::wstring(argv[1])==L"--stream"&&brokerStream())return 0;
#else
  if(argc>1&&std::wstring(argv[1])==L"--system-pipe")throw std::runtime_error("System broker is not enabled in this build");
#endif
 }catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}
 SetProcessDPIAware();HRESULT co=CoInitializeEx(nullptr,COINIT_MULTITHREADED);if(FAILED(co))return 1;HRESULT mf=MFStartup(MF_VERSION);if(FAILED(mf)){std::cerr<<"Media Foundation unavailable";return 1;}
 try{
  if(argc>1&&std::wstring(argv[1])==L"--probe"){
   json result={{"version",1},{"capture","DXGI Desktop Duplication"},{"encoders",json::array()}};
   try{Capture c;c.open(0);result["capture"]=c.path=="gdi"?"GDI BitBlt":"DXGI Desktop Duplication";result["capturePath"]=c.path;result["captureFallback"]=c.fallback;result["display"]={{"name",c.name},{"width",c.width},{"height",c.height},{"refreshHz",c.hz}};}catch(const std::exception&e){result["captureError"]=e.what();}
   for(bool hw:{true,false}){IMFActivate**list=nullptr;UINT32 n=0;MFT_REGISTER_TYPE_INFO o={MFMediaType_Video,MFVideoFormat_H264};if(SUCCEEDED(MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER,MFT_ENUM_FLAG_SORTANDFILTER|(hw?MFT_ENUM_FLAG_HARDWARE:MFT_ENUM_FLAG_SYNCMFT),nullptr,&o,&list,&n))){for(UINT i=0;i<n;i++){wchar_t*s=nullptr;UINT32 z=0;if(SUCCEEDED(list[i]->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute,&s,&z))){result["encoders"].push_back({{"name",utf8(s)},{"hardware",hw}});CoTaskMemFree(s);}list[i]->Release();}CoTaskMemFree(list);}}
   std::cout<<result.dump()<<std::endl;
  }else if(argc>2&&std::wstring(argv[1])==L"--test-encode"){
   Encoder e;e.open(640,360,30,2000000);std::vector<uint8_t>input(640*360*3/2,128),bytes;bool key=false;std::ofstream out(utf8(argv[2]),std::ios::binary);if(!out)throw std::runtime_error("fixture output unavailable");json chunks=json::array();UINT frames=0;auto start=micros();
   for(UINT n=0;n<30;n++){for(UINT y=0;y<360;y++)for(UINT x=0;x<640;x++)input[y*640+x]=(uint8_t)(16+(x+y+n*8)%220);if(e.encode(input,bytes,key,n==0)){chunks.push_back({{"size",bytes.size()},{"key",key},{"timestamp",n*1000000/30}});out.write((char*)bytes.data(),bytes.size());frames++;}}
   std::ofstream manifest(utf8(argv[2])+".json");manifest<<chunks.dump();
   std::cout<<json({{"hardware",e.hardware},{"encoder",e.name},{"frames",frames},{"elapsedUs",micros()-start},{"fixture",true}}).dump()<<std::endl;
  }else if(argc>1&&(std::wstring(argv[1])==L"--stream"||std::wstring(argv[1])==L"--system-pipe"))stream();
  else throw std::runtime_error("Usage: --probe | --test-encode output.h264 | --stream (private pipe)");
 }catch(const std::exception&e){if(systemWorker){try{packet({{"type","capture-error"},{"message",std::string(e.what()).substr(0,2048)}});}catch(...){} std::wstring detail;for(const char* p=e.what();*p&&detail.size()<2048;++p)detail.push_back((unsigned char)*p);workerTrace(detail.c_str());}std::cerr<<e.what()<<std::endl;MFShutdown();CoUninitialize();return 1;}
 MFShutdown();CoUninitialize();return 0;
}

