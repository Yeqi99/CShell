package org.canpshell.mobile;

import android.app.Instrumentation;
import android.app.Activity;
import java.io.StringWriter;
import java.io.PrintWriter;
import android.os.Bundle;
import android.util.Base64;
import org.json.JSONArray;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Runs against scripts/android-agent-fixture.ts: real TLS, KeyStore identity and a native PTY. */
@SuppressWarnings("deprecation")
public final class AgentProtocolTest extends Instrumentation {
  private Bundle arguments;
  @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); this.arguments=arguments; start(); }
  @Override public void onStart() {
    String[] tests={"testRejectIdentityBeforeSendingSecret","testCancelBeforeConnect","testPinnedNativePtyReconnectAndRevocation"};
    int failures=0;StringBuilder report=new StringBuilder();
    for(int i=0;i<tests.length;i++) {
      Bundle status=new Bundle();status.putString("class",getClass().getName());status.putString("test",tests[i]);status.putInt("numtests",tests.length);status.putInt("current",i+1);status.putString("id","CShellAgentInstrumentation");sendStatus(1,status);
      try{setUp();getClass().getMethod(tests[i]).invoke(this);sendStatus(0,status);report.append("PASS ").append(tests[i]).append("\n");}
      catch(Throwable error){failures++;Throwable cause=error.getCause()==null?error:error.getCause();StringWriter text=new StringWriter();cause.printStackTrace(new PrintWriter(text));status.putString("stack",text.toString());sendStatus(-2,status);report.append(text).append("\n");}
    }
    Bundle result=new Bundle();result.putString("stream",report + (failures==0?"OK (3 tests)":"FAILURES!!! Tests run: 3, Failures: "+failures));finish(Activity.RESULT_OK,result);
  }
  private static void assertTrue(boolean condition){assertTrue("Expected true",condition);}
  private static void assertTrue(String message,boolean condition){if(!condition)throw new AssertionError(message);}
  private static void assertFalse(boolean condition){assertTrue("Expected false",!condition);}
  private static void assertNotNull(Object value){assertNotNull("Expected non-null",value);}
  private static void assertNotNull(String message,Object value){assertTrue(message,value!=null);}
  private static void fail(String message){throw new AssertionError(message);}

  private String host, password, fingerprint;
  private int port;
  private void setUp() throws Exception {
    host=arguments.getString("agentHost","10.0.2.2");
    port=Integer.parseInt(arguments.getString("agentPort","47839"));
    password=arguments.getString("agentPassword");fingerprint=arguments.getString("agentFingerprint");
    assertNotNull("Provide fixture password",password);assertNotNull("Provide fixture fingerprint",fingerprint);
  }
  private boolean pin(byte[] cert) {
    try {StringBuilder result=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(cert))result.append(String.format(Locale.ROOT,"%02x",b));return result.toString().equals(fingerprint.replace(":","").toLowerCase(Locale.ROOT));}
    catch(Exception e){return false;}
  }
  public void testPinnedNativePtyReconnectAndRevocation() throws Exception {
    AtomicReference<JSONArray> choices=new AtomicReference<>();
    AtomicReference<AgentConnection> active=new AtomicReference<>();
    BlockingQueue<String> output=new LinkedBlockingQueue<>();CountDownLatch disconnected=new CountDownLatch(1);
    AgentConnection.Events events=(type,value)->{
      try {
        if(type.equals("environments"))choices.set(new JSONArray(value));
        if(type.equals("data")){output.offer(new String(Base64.decode(value,Base64.DEFAULT),StandardCharsets.UTF_8));active.get().acknowledge();}
        if(type.equals("closed"))disconnected.countDown();
      }catch(Exception e){output.offer("EVENT_ERROR:"+e.getMessage());}
    };
    AgentConnection first=new AgentConnection(events);active.set(first);
    try {
      first.connect(host,port,password,this::pin);
      assertNotNull(choices.get());assertTrue(choices.get().length()>0);
      int selected=-1;
      for(int i=0;i<choices.get().length();i++)if(!choices.get().getJSONObject(i).getString("shell").equals("wsl")){selected=i;break;}
      assertTrue("Fixture needs a host shell",selected>=0);
      first.open(selected);first.resize(110,35);
      // Only generated output contains the complete marker, so terminal echo cannot satisfy the assertion.
      String shell=choices.get().getJSONObject(selected).getString("shell");
      String command=shell.equals("cmd") ? "echo CSHELL_ANDROID_NA^TIVE_OK\r" : shell.equals("powershell") ? "Write-Output ('CSHELL_ANDROID_' + 'NATIVE_OK')\r" : "printf 'CSHELL_ANDROID_%s\\n' NATIVE_OK\r";
      first.input(command);StringBuilder received=new StringBuilder();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(15);
      while(System.nanoTime()<deadline&&!received.toString().contains("CSHELL_ANDROID_NATIVE_")){String chunk=output.poll(1,TimeUnit.SECONDS);if(chunk!=null)received.append(chunk);}
      assertTrue("Native shell did not execute command",received.toString().contains("CSHELL_ANDROID_NATIVE_"));
      // Burst more than the native PTY flow-control window. No artificial line-by-line pacing.
      output.clear();
      String burst=shell.equals("cmd")
        ? "powershell -NoProfile -Command \"[Console]::Write(('x' * 8388608)); [Console]::WriteLine(('CSHELL_PRESSURE_' + 'DONE'))\"\r"
        : shell.equals("powershell")
          ? "[Console]::Write(('x' * 8388608)); [Console]::WriteLine(('CSHELL_PRESSURE_' + 'DONE'))\r"
          : "head -c 8388608 /dev/zero | tr '\\0' x; printf 'CSHELL_PRESSURE_%s\\n' DONE\r";
      first.input(burst);
      long total=0;String tail="";boolean ended=false;deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(60);
      while(System.nanoTime()<deadline && !ended) {
        String chunk=output.poll(1,TimeUnit.SECONDS);
        if(chunk==null)continue;
        total+=chunk.length();tail+=chunk;
        ended=tail.contains("CSHELL_PRESSURE_DONE");
        if(tail.length()>512)tail=tail.substring(tail.length()-512);
      }
      assertTrue("8 MiB burst did not complete through ACK flow control",ended && total>=8388608L);
      assertTrue("Burst output must leave the session connected",disconnected.getCount()==1);

    } finally {first.close();}
    assertTrue(disconnected.await(5,TimeUnit.SECONDS));
    // Persisted KeyStore controller identity reconnects without passing a password again.
    AtomicReference<JSONArray> restored=new AtomicReference<>();CountDownLatch revoked=new CountDownLatch(1);
    AgentConnection second=new AgentConnection((type,value)->{try{if(type.equals("environments"))restored.set(new JSONArray(value));if(type.equals("closed"))revoked.countDown();}catch(Exception e){throw new RuntimeException(e);}});
    try {
      second.connect(host,port,"",this::pin);assertTrue(restored.get().length()>0);second.open(0);
      second.input("echo __CSHELL_TEST_REVOKE__\r");assertTrue("Revocation must disconnect the native session",revoked.await(10,TimeUnit.SECONDS));
    } finally {second.close();}
    AgentConnection revokedPeer=new AgentConnection((type,value)->{});
    try {revokedPeer.connect(host,port,"",this::pin);fail("Revoked identity must not reconnect without authorization");}
    catch(Exception expected) {assertNotNull(expected.getMessage());}finally{revokedPeer.close();}
  }
  public void testRejectIdentityBeforeSendingSecret() throws Exception {
    AtomicBoolean asked=new AtomicBoolean();AgentConnection connection=new AgentConnection((type,value)->{});
    try{connection.connect(host,port,"never-send-this-secret",certificate->{asked.set(true);return false;});fail("Rejected pin must block authentication");}
    catch(Exception expected){assertTrue(asked.get());}finally{connection.close();}
  }
  public void testCancelBeforeConnect() throws Exception {
    AgentConnection connection=new AgentConnection((type,value)->{});connection.close();AtomicBoolean asked=new AtomicBoolean();
    try{connection.connect(host,port,password,certificate->{asked.set(true);return true;});fail("Cancelled session cannot connect");}
    catch(Exception expected){assertFalse(asked.get());}finally{connection.close();}
  }
}
