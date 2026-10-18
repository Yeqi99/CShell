#define wmain desktop_program_main
#include "desktop.cpp"
#undef wmain
#include <cassert>
int wmain(){
 unsigned cases=0;
 for(auto size:std::vector<std::vector<UINT>>{{2,2,2,2},{1920,1200,1920,1200},{1920,1200,1280,800},{1919,1199,638,398},{640,360,320,180}}){
  UINT sw=size[0],sh=size[1],w=size[2],h=size[3];std::vector<uint8_t>src((size_t)sw*sh*4),actual,expected((size_t)w*h*3/2);
  uint32_t seed=1;for(auto&v:src){seed=seed*1664525+1013904223;v=(uint8_t)(seed>>24);}
  nv12(src,sw,sh,actual,w,h);
  for(UINT y=0;y<h;y+=2)for(UINT x=0;x<w;x+=2){int rr=0,gg=0,bb=0;
   for(UINT dy=0;dy<2;dy++)for(UINT dx=0;dx<2;dx++){auto p=src.data()+(((size_t)(y+dy)*sh/h)*sw+(size_t)(x+dx)*sw/w)*4;int b=p[0],g=p[1],r=p[2];expected[(size_t)(y+dy)*w+x+dx]=clamp(((47*r+157*g+16*b+128)>>8)+16);rr+=r;gg+=g;bb+=b;}
   rr/=4;gg/=4;bb/=4;size_t uv=(size_t)w*h+(size_t)(y/2)*w+x;expected[uv]=clamp(((-26*rr-87*gg+112*bb+128)>>8)+128);expected[uv+1]=clamp(((112*rr-102*gg-10*bb+128)>>8)+128);
  }
  if(actual!=expected){std::cerr<<"Conversion mismatch";return 1;}cases++;
 }
 std::cout<<"PASS "<<cases<<" full/scaled NV12 conversions byte-identical to reference"<<std::endl;
}
