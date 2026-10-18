#include <iostream>
#include <vector>
#include "input-state.hpp"
int main(){
 using J=nlohmann::json;std::vector<J> effects;bool failRelease=false;
 InputState state([&](const J&e){if(failRelease&&e.contains("down")&&!e["down"].get<bool>())throw std::runtime_error("fake release failed");effects.push_back(e);});
 unsigned checks=0;auto require=[&](bool ok){++checks;if(!ok)throw std::runtime_error("input state assertion failed");};
 auto rejected=[&](const J&e,uint64_t t){try{state.apply(e,t);}catch(...){return true;}return false;};
 auto key=J{{"kind","key"},{"code",30},{"down",true},{"generation",1},{"sequence",1}};
 require(rejected(key,0));state.grant(1,0);state.apply(key,1);require(effects.size()==1);
 require(rejected(key,2));require(effects.size()==1);auto stale=key;stale["generation"]=2;stale["sequence"]=2;require(rejected(stale,3));
 state.revoke();require(effects.size()==2&&!effects.back()["down"].get<bool>());require(rejected(key,4));
 state.grant(2,10);key["generation"]=2;state.apply(key,11);state.tick(5012);require(!state.allowed&&state.keys.empty()&&effects.size()==4);
 state.grant(3,6000);auto up=key;up["generation"]=3;up["down"]=false;const auto before=effects.size();state.apply(up,6001);require(effects.size()==before&&state.allowed);
 auto move=J{{"kind","move"},{"x",2},{"y",0},{"generation",3},{"sequence",1}};require(rejected(move,6001));
 key["generation"]=3;key["sequence"]=2;
 for(auto value:{J(-1),J(1.5),J("1"),J(true),J(18446744073709551615ULL)}){auto bad=key;bad["sequence"]=value;require(rejected(bad,6001));bad=key;bad["code"]=value;require(rejected(bad,6001));}
 auto bad=key;bad["down"]=1;require(rejected(bad,6001));bad=key;bad["code"]=256;require(rejected(bad,6001));
 auto wheel=J{{"kind","wheel"},{"delta",18446744073709551615ULL},{"generation",3},{"sequence",1}};require(rejected(wheel,6001));wheel["delta"]=1.5;require(rejected(wheel,6001));
 key["code"]=0x11d;state.apply(key,6002);require(state.keys.count(0x11d)==1);
 failRelease=true;bool failed=false;try{state.revoke();}catch(...){failed=true;}require(failed&&!state.allowed&&state.keys.count(0x11d)==1);
 failed=false;try{state.grant(4,6003);}catch(...){failed=true;}require(failed&&!state.allowed&&state.generation==3);
 failRelease=false;state.tick(6004);require(state.keys.empty());state.grant(4,6005);
 auto button=J{{"kind","button"},{"button",4},{"down",true},{"generation",4},{"sequence",1}};state.apply(button,6006);state.revoke();require(state.buttons.empty());
 state.grant(5,6007);button["generation"]=5;button["sequence"]=1;button["down"]=false;const auto count=effects.size();state.apply(button,6008);require(state.allowed&&effects.size()==count);require(rejected(button,6009));
 auto late=button;late["kind"]="lease";late["sequence"]=2;bool expired=false;try{state.apply(late,11009);}catch(const std::exception&e){expired=std::string(e.what())=="INPUT_LEASE_EXPIRED";}require(expired&&!state.allowed);
 std::cout<<"{\"passed\":true,\"nativeInputInjected\":false,\"checks\":"<<checks<<",\"failedReleaseRetained\":true,\"strictIntegers\":true}"<<std::endl;
}

