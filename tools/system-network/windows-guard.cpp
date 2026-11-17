// CShell system-network kill switch. Explicit elevated apply/remove only.
// Persistent WFP filters remain after this process or the TUN engine exits.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fwpmu.h>
#include "wfp-constants.h"
#include <iphlpapi.h>
#include <netioapi.h>
#include <iostream>
#include <string>
#include <vector>
static const GUID provider={0xc6e11001,0x9301,0x4030,{0x91,0x75,0x45,0x55,0x20,0x32,0x10,0x01}};
static const GUID sublayer={0xc6e11002,0x9301,0x4030,{0x91,0x75,0x45,0x55,0x20,0x32,0x10,0x01}};
static void check(DWORD code){if(code!=ERROR_SUCCESS)throw code;}
static void filter(HANDLE h,const GUID&layer,FWP_ACTION_TYPE action,UINT8 weight,std::vector<FWPM_FILTER_CONDITION0> conditions){
 FWPM_FILTER0 f{};f.displayData.name=const_cast<wchar_t*>(L"CAgent system network guard");f.providerKey=const_cast<GUID*>(&provider);f.layerKey=layer;f.subLayerKey=sublayer;f.flags=FWPM_FILTER_FLAG_PERSISTENT;f.action.type=action;f.weight.type=FWP_UINT8;f.weight.uint8=weight;f.numFilterConditions=static_cast<UINT32>(conditions.size());f.filterCondition=conditions.data();check(FwpmFilterAdd0(h,&f,nullptr,nullptr));
}
static void remove(HANDLE h){FWPM_FILTER_ENUM_TEMPLATE0 query{};query.providerKey=const_cast<GUID*>(&provider);HANDLE enumeration=nullptr;check(FwpmFilterCreateEnumHandle0(h,&query,&enumeration));FWPM_FILTER0** entries=nullptr;UINT32 count=0;try{do{check(FwpmFilterEnum0(h,enumeration,128,&entries,&count));for(UINT32 i=0;i<count;i++)check(FwpmFilterDeleteById0(h,entries[i]->filterId));FwpmFreeMemory0(reinterpret_cast<void**>(&entries));}while(count);}catch(...){FwpmFilterDestroyEnumHandle0(h,enumeration);throw;}FwpmFilterDestroyEnumHandle0(h,enumeration);DWORD e=FwpmSubLayerDeleteByKey0(h,&sublayer);if(e!=FWP_E_SUBLAYER_NOT_FOUND)check(e);e=FwpmProviderDeleteByKey0(h,&provider);if(e!=FWP_E_PROVIDER_NOT_FOUND)check(e);}
int wmain(int argc,wchar_t**argv){
 if(argc==2&&std::wstring(argv[1])==L"describe"){std::cout<<"{\"platform\":\"win32\",\"persistent\":true,\"scope\":\"system-tcp\",\"requiresAdministrator\":true}";return 0;}
 const bool allowTun=argc==3&&std::wstring(argv[1])==L"allow-tun";const bool apply=argc==5&&std::wstring(argv[1])==L"apply";const bool erase=argc==2&&std::wstring(argv[1])==L"remove";if(!apply&&!erase&&!allowTun){std::cerr<<"Usage: guard describe | apply <TUN-alias> <controller-exe> <engine-exe> | remove";return 2;}
 HANDLE h=nullptr;try{check(FwpmEngineOpen0(nullptr,RPC_C_AUTHN_WINNT,nullptr,nullptr,&h));check(FwpmTransactionBegin0(h,0));
 if(erase)remove(h);else if(allowTun){
  FWPM_PROVIDER0* existing=nullptr;check(FwpmProviderGetByKey0(h,&provider,&existing));FwpmFreeMemory0(reinterpret_cast<void**>(&existing));NET_LUID luid{};check(ConvertInterfaceAliasToLuid(argv[2],&luid));
  for(const GUID&layer:{FWPM_LAYER_ALE_AUTH_CONNECT_V4,FWPM_LAYER_ALE_AUTH_CONNECT_V6}){FWPM_FILTER_CONDITION0 c{};c.fieldKey=FWPM_CONDITION_IP_LOCAL_INTERFACE;c.matchType=FWP_MATCH_EQUAL;c.conditionValue.type=FWP_UINT64;c.conditionValue.uint64=&luid.Value;filter(h,layer,FWP_ACTION_PERMIT,10,{c});}
 }else{
  // Refuse replacement of an existing owner. Explicit remove is the recovery path.
  FWPM_PROVIDER0* existing=nullptr;DWORD e=FwpmProviderGetByKey0(h,&provider,&existing);if(e==ERROR_SUCCESS){FwpmFreeMemory0(reinterpret_cast<void**>(&existing));throw static_cast<DWORD>(ERROR_ALREADY_EXISTS);}if(e!=FWP_E_PROVIDER_NOT_FOUND)check(e);
  NET_LUID luid{};const bool hasTun=std::wstring(argv[2])!=L"pending";if(hasTun)check(ConvertInterfaceAliasToLuid(argv[2],&luid));
  FWPM_PROVIDER0 p{};p.providerKey=provider;p.displayData.name=const_cast<wchar_t*>(L"CAgent system network");p.flags=FWPM_PROVIDER_FLAG_PERSISTENT;check(FwpmProviderAdd0(h,&p,nullptr));
  FWPM_SUBLAYER0 sub{};sub.subLayerKey=sublayer;sub.providerKey=const_cast<GUID*>(&provider);sub.displayData.name=p.displayData.name;sub.flags=FWPM_SUBLAYER_FLAG_PERSISTENT;sub.weight=0xfffe;check(FwpmSubLayerAdd0(h,&sub,nullptr));
  for(const GUID&layer:{FWPM_LAYER_ALE_AUTH_CONNECT_V4,FWPM_LAYER_ALE_AUTH_CONNECT_V6}){
   filter(h,layer,FWP_ACTION_BLOCK,1,{});
   FWPM_FILTER_CONDITION0 loop{};loop.fieldKey=FWPM_CONDITION_FLAGS;loop.matchType=FWP_MATCH_FLAGS_ALL_SET;loop.conditionValue.type=FWP_UINT32;loop.conditionValue.uint32=FWP_CONDITION_FLAG_IS_LOOPBACK;filter(h,layer,FWP_ACTION_PERMIT,10,{loop});
   FWPM_FILTER_CONDITION0 tun{};tun.fieldKey=FWPM_CONDITION_IP_LOCAL_INTERFACE;tun.matchType=FWP_MATCH_EQUAL;tun.conditionValue.type=FWP_UINT64;tun.conditionValue.uint64=&luid.Value;if(hasTun)filter(h,layer,FWP_ACTION_PERMIT,10,{tun});
   for(int a=3;a<=4;a++){FWP_BYTE_BLOB* app=nullptr;check(FwpmGetAppIdFromFileName0(argv[a],&app));FWPM_FILTER_CONDITION0 c{};c.fieldKey=FWPM_CONDITION_ALE_APP_ID;c.matchType=FWP_MATCH_EQUAL;c.conditionValue.type=FWP_BYTE_BLOB_TYPE;c.conditionValue.byteBlob=app;try{filter(h,layer,FWP_ACTION_PERMIT,10,{c});}catch(...){FwpmFreeMemory0(reinterpret_cast<void**>(&app));throw;}FwpmFreeMemory0(reinterpret_cast<void**>(&app));}
  }
 }
 check(FwpmTransactionCommit0(h));FwpmEngineClose0(h);std::cout<<"{\"ok\":true}";return 0;
 }catch(DWORD code){if(h){FwpmTransactionAbort0(h);FwpmEngineClose0(h);}std::cerr<<"WFP_GUARD_FAILED:"<<code;return 1;}
}
