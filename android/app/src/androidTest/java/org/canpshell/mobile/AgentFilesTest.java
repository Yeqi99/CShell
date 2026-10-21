package org.canpshell.mobile;

import org.json.*;
import android.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;

/** Synthetic RPC responses only: no device file, network connection or user credentials. */
final class AgentFilesTest {
  private static final String ROOT="53ec8a3f-d188-4424-81e7-77f5f123dd32";
  private interface Checked {void run()throws Exception;}
  private static void check(boolean value){if(!value)throw new AssertionError("Agent files regression");}
  private static void rejects(Checked action)throws Exception{boolean rejected=false;try{action.run();}catch(Exception expected){rejected=true;}check(rejected);}
  private static JSONObject request(String op)throws Exception{return new JSONObject().put("operation",op).put("path","/"+ROOT+"/sample.txt");}
  private static JSONObject part(String text,long next,long size,String version,boolean done)throws Exception{return new JSONObject().put("data",Base64.encodeToString(text.getBytes(java.nio.charset.StandardCharsets.UTF_8),Base64.NO_WRAP)).put("next",next).put("size",size).put("version",version).put("done",done);}
  static String run()throws Exception{
    check(AgentFiles.location("/"+ROOT).getString("path").equals("/"));
    check(AgentFiles.location("/"+ROOT+"/folder/file.txt").getString("path").equals("/folder/file.txt"));
    for(String path:new String[]{"/",ROOT,"/bad-id/file","/"+ROOT+"/../secret","/"+ROOT+"/./x","/"+ROOT+"/C:/x","/"+ROOT+"/x\\y","/"+ROOT+"/x\0"})rejects(()->AgentFiles.location(path));
    AtomicInteger calls=new AtomicInteger();
    AgentFiles.Rpc read=(method,params)->{check(method.equals("files.read"));check(params.getString("root").equals(ROOT));int n=calls.getAndIncrement();if(n==0){check(params.getLong("offset")==0&&!params.has("version"));return part("hello",5,6,"v1",false);}check(params.getLong("offset")==5&&params.getString("version").equals("v1"));return part("!",6,6,"v1",true);};
    check(AgentFiles.operationWithRpc(null,read,request("preview"),null,()->false).getString("text").equals("hello!"));check(calls.get()==2);
    rejects(()->AgentFiles.operationWithRpc(null,(m,p)->part("hello",4,5,"v1",true),request("preview"),null,()->false));
    rejects(()->AgentFiles.operationWithRpc(null,(m,p)->part("",0,2,"v1",false),request("preview"),null,()->false));
    rejects(()->AgentFiles.operationWithRpc(null,(m,p)->part("x",1,65537,"v1",false),request("preview"),null,()->false));
    rejects(()->AgentFiles.operationWithRpc(null,(m,p)->part("\0",1,1,"v1",true),request("preview"),null,()->false));
    calls.set(0);
    rejects(()->AgentFiles.operationWithRpc(null,(m,p)->calls.getAndIncrement()==0?part("a",1,2,"v1",false):part("b",2,2,"v2",true),request("preview"),null,()->false));
    AtomicInteger unexpected=new AtomicInteger();AgentFiles.Rpc forbidden=(m,p)->{unexpected.incrementAndGet();throw new AssertionError("Unexpected remote mutation");};
    rejects(()->AgentFiles.operationWithRpc(null,forbidden,request("upload"),null,()->false));
    rejects(()->AgentFiles.operationWithRpc(null,forbidden,request("upload"),null,()->true));
    check(unexpected.get()==0);
    return "OK (Agent file roots, traversal rejection, paged read/version, malformed progress, preview bound, binary rejection, cancellation and upload without selection)";
  }
}
