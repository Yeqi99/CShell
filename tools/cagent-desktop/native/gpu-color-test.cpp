#define wmain desktop_program_main
#include "desktop.cpp"
#undef wmain
// Synthetic uniform RGB frames only. Uses the real display's D3D device, never
// calls capture.frame/acquire and never reads or persists desktop pixels.
int wmain(int argc,wchar_t**argv){
 if(argc<2||argc>3)return 2;const bool cpu=argc==3&&std::wstring(argv[2])==L"cpu";check(CoInitializeEx(nullptr,COINIT_MULTITHREADED),"COM");check(MFStartup(MF_VERSION),"MF");
 try{
  Capture c;c.open(0);GpuConverter gpu;gpu.open(c,640,360,30);Encoder e;e.open(640,360,30,2000000,cpu?nullptr:c.device.p);
  D3D11_TEXTURE2D_DESC desc{};desc.Width=c.width;desc.Height=c.height;desc.MipLevels=1;desc.ArraySize=1;desc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;desc.SampleDesc.Count=1;desc.Usage=D3D11_USAGE_DEFAULT;desc.BindFlags=D3D11_BIND_RENDER_TARGET;
  Com<ID3D11Texture2D> source,readback;check(c.device->CreateTexture2D(&desc,nullptr,source.put()),"synthetic source");
  gpu.texture->GetDesc(&desc);desc.Usage=D3D11_USAGE_STAGING;desc.BindFlags=0;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;check(c.device->CreateTexture2D(&desc,nullptr,readback.put()),"synthetic readback");
  std::vector<uint8_t> bgra((size_t)c.width*c.height*4),encoded,empty;std::ofstream output(utf8(argv[1]),std::ios::binary);json frames=json::array();bool key=false;
  const int colors[][3]={{0,0,0},{255,255,255},{255,0,0},{0,255,0},{0,0,255},{128,128,128}};
  for(unsigned frame=0;frame<30;frame++){
   auto rgb=colors[frame%6];for(size_t p=0;p<bgra.size();p+=4){bgra[p]=rgb[2];bgra[p+1]=rgb[1];bgra[p+2]=rgb[0];bgra[p+3]=255;}
   c.context->UpdateSubresource(source.p,0,nullptr,bgra.data(),c.width*4,0);gpu.convert(source.p);
   c.context->CopyResource(readback.p,gpu.texture.p);D3D11_MAPPED_SUBRESOURCE mapped{};check(c.context->Map(readback.p,0,D3D11_MAP_READ,0,&mapped),"synthetic map");
   int r=rgb[0],g=rgb[1],b=rgb[2];int expected[]={((47*r+157*g+16*b+128)>>8)+16,((-26*r-87*g+112*b+128)>>8)+128,((112*r-102*g-10*b+128)>>8)+128};
   auto pixels=(uint8_t*)mapped.pData;int actual[]={pixels[180*mapped.RowPitch+320],pixels[(360+90)*mapped.RowPitch+320],pixels[(360+90)*mapped.RowPitch+321]};c.context->Unmap(readback.p,0);
   for(int channel=0;channel<3;channel++)if(std::abs(actual[channel]-expected[channel])>3)throw std::runtime_error("GPU color mismatch: "+json({{"rgb",{r,g,b}},{"expected",{expected[0],expected[1],expected[2]}},{"actual",{actual[0],actual[1],actual[2]}}}).dump());
   if(cpu)nv12(bgra,c.width,c.height,empty,640,360);if(!e.encode(empty,encoded,key,frame==0,cpu?nullptr:gpu.texture.p))throw std::runtime_error("GPU encoder produced no frame");output.write((char*)encoded.data(),encoded.size());frames.push_back({{"size",encoded.size()},{"key",key},{"timestamp",frame*1000000/30},{"rgb",{r,g,b}}});
  }
  std::ofstream manifest(utf8(argv[1])+".json");manifest<<frames.dump();std::cout<<json({{"frames",frames.size()},{"synthetic",true},{"pixelPath",cpu?"cpu-nv12":"d3d11-nv12-surface"},{"hardware",e.hardware},{"encoder",e.name},{"gpuColorTolerance",3}}).dump()<<std::endl;
 }catch(const std::exception&e){std::cerr<<e.what()<<std::endl;MFShutdown();CoUninitialize();return 1;}
 MFShutdown();CoUninitialize();return 0;
}
