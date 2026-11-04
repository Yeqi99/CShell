package org.canpshell.mobile;
import org.json.*;

/** JVM roundtrip against the same projection used by Android's encrypted vault. */
public final class CloudPortableSettingsTest {
  static void check(boolean ok,String text){if(!ok)throw new AssertionError(text);}
  public static void main(String[] args)throws Exception{
    JSONObject store=new JSONObject("{\"preferences\":{\"theme\":\"dark\",\"uiFontSize\":16,\"fontSize\":18,\"terminalFont\":\"Consolas\",\"lineHeight\":1.4,\"future\":{\"keep\":true}},\"extensions\":{\"enabled\":{\"opencode\":true,\"docker\":false},\"external\":[{\"key\":\"private-value\"}]},\"secrets\":{\"password\":\"never-expose\"},\"groups\":[\"empty-group\"]}");
    String original=store.toString();
    JSONObject mobile=CloudPortableSettings.project(store);
    check(mobile.getJSONObject("preferences").getInt("fontSize")==18,"terminal font consumed");
    check(mobile.getJSONObject("extensions").getBoolean("opencode"),"enabled choice available");
    check(!mobile.getJSONObject("extensions").getBoolean("docker"),"disabled choice available");
    check(!mobile.toString().contains("private-value")&&!mobile.toString().contains("never-expose"),"no secrets exposed");
    check(store.toString().equals(original),"projection must never mutate source");
    JSONObject roundtrip=new JSONObject(store.toString());roundtrip.getJSONObject("preferences").put("theme","light");
    check(roundtrip.getJSONObject("preferences").getJSONObject("future").getBoolean("keep"),"opaque preferences retained");
    check(roundtrip.getJSONObject("extensions").toString().equals(store.getJSONObject("extensions").toString()),"desktop extensions survive mobile write");
    check(roundtrip.getJSONArray("groups").getString(0).equals("empty-group"),"empty groups retained");
    check(CloudPortableSettings.project(new JSONObject()).getJSONObject("extensions").length()==0,"account reset has no old choices");
    System.out.println("PASS: portable rendering, extension choices, secret exclusion, opaque roundtrip, account reset");
  }
}
