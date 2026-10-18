#pragma once
#include <functional>
#include <set>
#include <stdexcept>
#include <cmath>
#include <cstdint>
#include <exception>
#include "vendor/json.hpp"

// One owner and monotonically increasing generation per private helper pipe.
// Callers serialize access. Failed releases retain ownership for retry.
struct InputState {
 using Json=nlohmann::json;
 bool allowed=false;uint64_t generation=0,lastSequence=0,lastLease=0;
 std::set<unsigned> keys,buttons;
 std::function<void(const Json&)> sink;
 explicit InputState(std::function<void(const Json&)> output):sink(output){}
 static uint64_t integer(const Json& v,uint64_t max=9007199254740991ULL){
  if(!v.is_number_integer()||(!v.is_number_unsigned()&&v.get<int64_t>()<0))throw std::runtime_error("nonnegative integer required");
  auto value=v.get<uint64_t>();if(value>max)throw std::runtime_error("integer out of range");return value;
 }
 static bool boolean(const Json& v){if(!v.is_boolean())throw std::runtime_error("boolean required");return v.get<bool>();}
 void release(){
  std::exception_ptr failure;
  for(auto it=keys.begin();it!=keys.end();){try{sink({{"kind","key"},{"code",*it},{"down",false}});it=keys.erase(it);}catch(...){failure=std::current_exception();++it;}}
  for(auto it=buttons.begin();it!=buttons.end();){try{sink({{"kind","button"},{"button",*it},{"down",false}});it=buttons.erase(it);}catch(...){failure=std::current_exception();++it;}}
  if(failure)std::rethrow_exception(failure);
 }
 void grant(uint64_t next,uint64_t now){
  if(!next||next>9007199254740991ULL||next<=generation)throw std::runtime_error("stale input generation");
  allowed=false;release();generation=next;lastSequence=0;lastLease=now;allowed=true;
 }
 void revoke(){allowed=false;release();}
 void tick(uint64_t now){if(allowed&&(now<lastLease||now-lastLease>5000))allowed=false;if(!allowed&&(!keys.empty()||!buttons.empty()))release();}
 void apply(const Json& event,uint64_t now){
  tick(now);if(!allowed)throw std::runtime_error("input permission denied");
  auto gen=integer(event.at("generation")),seq=integer(event.at("sequence"));
  if(gen!=generation||!seq||seq<=lastSequence)throw std::runtime_error("stale input event");
  auto kind=event.at("kind").get<std::string>();
  if(kind=="lease"){lastSequence=seq;lastLease=now;return;}
  if(kind=="key"){
   auto code=(unsigned)integer(event.at("code"),0x1ff);bool down=boolean(event.at("down"));
   if(!(code&0xff))throw std::runtime_error("invalid scan code");
   if(!down&&!keys.count(code))throw std::runtime_error("key not owned by session");
   sink(event);if(down)keys.insert(code);else keys.erase(code);
  }else if(kind=="button"){
   auto button=(unsigned)integer(event.at("button"),4);bool down=boolean(event.at("down"));
   if(!down&&!buttons.count(button))throw std::runtime_error("button not owned by session");
   sink(event);if(down)buttons.insert(button);else buttons.erase(button);
  }else if(kind=="move"){
   if(!event.at("x").is_number()||!event.at("y").is_number())throw std::runtime_error("numeric pointer position required");
   auto x=event.at("x").get<double>(),y=event.at("y").get<double>();
   if(!std::isfinite(x)||!std::isfinite(y)||x<0||x>1||y<0||y>1)throw std::runtime_error("invalid pointer position");sink(event);
  }else if(kind=="wheel"){
   auto&v=event.at("delta");if(!v.is_number_integer()||(v.is_number_unsigned()&&v.get<uint64_t>()>32767))throw std::runtime_error("integer wheel delta required");
   auto delta=v.get<int64_t>();if(delta < -32768 || delta>32767)throw std::runtime_error("wheel delta overflow");
   if(event.contains("horizontal"))boolean(event.at("horizontal"));sink(event);
  }else throw std::runtime_error("unsupported input kind");
  lastSequence=seq;lastLease=now;
 }
};
