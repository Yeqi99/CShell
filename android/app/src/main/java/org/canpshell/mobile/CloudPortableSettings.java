package org.canpshell.mobile;

import org.json.JSONObject;

/** Public mobile projection; never exposes secrets or rewrites opaque account fields. */
final class CloudPortableSettings {
  static JSONObject project(JSONObject store) throws Exception {
    JSONObject source=store.optJSONObject("preferences"), appearance=new JSONObject();
    if(source!=null)for(String key:new String[]{"uiFontSize","uiFont","fontSize","terminalFont","lineHeight"})
      if(source.has(key))appearance.put(key,source.get(key));
    JSONObject enabled=new JSONObject(), extensions=store.optJSONObject("extensions");
    JSONObject choices=extensions==null?null:extensions.optJSONObject("enabled");
    if(choices!=null)for(java.util.Iterator<String> keys=choices.keys();keys.hasNext();){
      String key=keys.next();Object choice=choices.get(key);
      if(choice instanceof Boolean)enabled.put(key,choice);
    }
    return new JSONObject().put("preferences",appearance).put("extensions",enabled)
      .put("theme",source==null?"light":source.optString("theme","light"));
  }
}
