package org.canpshell.mobile;
import android.content.*;
import android.content.pm.*;
import org.json.*;
import java.io.IOException;
import java.util.*;

final class AndroidApplications {
  private final Context context;
  AndroidApplications(Context context){this.context=context.getApplicationContext();}
  JSONArray list()throws Exception{JSONArray rows=new JSONArray();Set<String> seen=new HashSet<>();PackageManager pm=context.getPackageManager();Intent query=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);for(ResolveInfo r:pm.queryIntentActivities(query,0)){if(r.activityInfo==null||!r.activityInfo.enabled||!r.activityInfo.exported)continue;String id=r.activityInfo.packageName;if(seen.add(id)){rows.put(new JSONObject().put("id",id).put("name",String.valueOf(r.loadLabel(pm))));if(rows.length()>=500)break;}}return rows;}
  Object launch(JSONObject args)throws Exception{String id=args.getString("packageName");boolean allowed=false;JSONArray apps=list();for(int i=0;i<apps.length();i++)if(id.equals(apps.getJSONObject(i).getString("id")))allowed=true;if(!allowed)throw new IOException("Application is not a visible launcher app");Intent intent=context.getPackageManager().getLaunchIntentForPackage(id);if(intent==null)throw new IOException("Application has no launcher");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(intent);return new JSONObject().put("submitted",true).put("packageName",id).put("note","Android may require the phone to be unlocked and CAgent visible before showing the application.");}
  JSONArray tools()throws Exception{return new JSONArray().put(tool("android_apps_list",false,new JSONObject())).put(tool("android_app_launch",true,new JSONObject().put("packageName",new JSONObject().put("type","string").put("maxLength",255))));}
  private JSONObject tool(String id,boolean write,JSONObject properties)throws Exception{return new JSONObject().put("packageId","cagent.android").put("id",id).put("toolId",id).put("description",write?"Open a real Android launcher application through the operating system; submitted does not guarantee foreground launch.":"List visible launchable applications on this Android device.").put("inputSchema",new JSONObject().put("type","object").put("properties",properties).put("required",write?new JSONArray().put("packageName"):new JSONArray()).put("additionalProperties",false)).put("outputSchema",new JSONObject().put("type",write?"object":"array")).put("permissions",new JSONArray().put(write?"commands.execute":"agent.manage")).put("sideEffect",write);}
}
