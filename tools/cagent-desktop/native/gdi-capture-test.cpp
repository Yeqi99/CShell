#define wmain desktop_program_main
#include "desktop.cpp"
#undef wmain
// Real current-session GDI capture. Pixel and encoded buffers are discarded;
// this fixture never grants or injects input and never writes image files.
int wmain(){
 SetProcessDPIAware();
 check(CoInitializeEx(nullptr,COINIT_MULTITHREADED),"COM");check(MFStartup(MF_VERSION),"MF");
 try{
  Capture capture;capture.openGdi(0);Encoder encoder;encoder.open(capture.width&~1u,capture.height&~1u,60,12000000);
  std::vector<uint8_t>bgra,yuv,encoded;bool key=false;unsigned count=0;uint64_t begin=micros(),captureUs=0,convertUs=0,encodeUs=0;
  for(unsigned frame=0;frame<10;frame++){auto start=micros();capture.frame(bgra);auto captured=micros();nv12(bgra,capture.width,capture.height,yuv,encoder.width,encoder.height);auto converted=micros();if(encoder.encode(yuv,encoded,key,frame==0))count++;auto end=micros();captureUs+=captured-start;convertUs+=converted-captured;encodeUs+=end-converted;}
  if(count!=10)throw std::runtime_error("Expected ten GDI encoded frames");
  std::cout<<json({{"capturePath",capture.path},{"width",encoder.width},{"height",encoder.height},{"frames",count},{"hardware",encoder.hardware},{"encoder",encoder.name},{"elapsedUs",micros()-begin},{"captureMeanUs",captureUs/10},{"convertMeanUs",convertUs/10},{"encodeMeanUs",encodeUs/10},{"pixelsPersisted",false},{"inputGranted",false}}).dump()<<std::endl;
 }catch(const std::exception&e){std::cerr<<e.what()<<std::endl;MFShutdown();CoUninitialize();return 1;}
 MFShutdown();CoUninitialize();return 0;
}
