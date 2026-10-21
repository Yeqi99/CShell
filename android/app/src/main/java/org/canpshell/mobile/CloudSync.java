package org.canpshell.mobile;

import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Native-only credentials and crypto. The WebView receives public descriptors only. */
final class CloudSync {
  private final Context context;
  private JSONObject state;
  CloudSync(Context context) { this.context=context; }
  private SecretKey localKey()throws Exception{
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);String alias="cshell-cloud-sync";
    if(!store.containsAlias(alias)){KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
    return (SecretKey)store.getKey(alias,null);
  }
  private static byte[] bytes(String value){return value.getBytes(StandardCharsets.UTF_8);}
  private static String b64(byte[] value){return Base64.encodeToString(value,Base64.NO_WRAP);}
  private static byte[] un64(String value){return Base64.decode(value,Base64.DEFAULT);}
  private void load()throws Exception{
    if(state!=null)return;
    String raw=context.getSharedPreferences("cloud-sync",0).getString("vault","");
    if(raw.isEmpty()){state=new JSONObject();return;}
    String[] pair=raw.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE,localKey(),new GCMParameterSpec(128,un64(pair[0])));cipher.updateAAD(bytes("cshell-cloud-local:1"));
    state=new JSONObject(new String(cipher.doFinal(un64(pair[1])),StandardCharsets.UTF_8));
  }
  private void save()throws Exception{
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,localKey());cipher.updateAAD(bytes("cshell-cloud-local:1"));
    String encoded=b64(cipher.getIV())+":"+b64(cipher.doFinal(bytes(state.toString())));
    if(!context.getSharedPreferences("cloud-sync",0).edit().putString("vault",encoded).commit())throw new IOException("无法保存加密同步状态");
  }
  private JSONObject api(String path,JSONObject body)throws Exception{
    HttpURLConnection connection=(HttpURLConnection)new URL("https://shell.canp.ai/api/v1/"+path).openConnection();
    connection.setConnectTimeout(15000);connection.setReadTimeout(25000);connection.setInstanceFollowRedirects(false);
    connection.setRequestProperty("Content-Type","application/json");
    if(state.has("session"))connection.setRequestProperty("Authorization","Bearer "+state.getJSONObject("session").getString("token"));
    try{
      if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);byte[] payload=bytes(body.toString());connection.setFixedLengthStreamingMode(payload.length);try(OutputStream out=connection.getOutputStream()){out.write(payload);}}
      int status=connection.getResponseCode();InputStream input=status<400?connection.getInputStream():connection.getErrorStream();
      if(input==null)throw new IOException("云端响应为空");
      ByteArrayOutputStream output=new ByteArrayOutputStream();try(InputStream in=input){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(output.size()+n>13*1024*1024)throw new IOException("云端响应超过上限");output.write(buffer,0,n);}}
      JSONObject result=new JSONObject(output.toString("UTF-8"));
      if(status!=200)throw new IOException(result.optString("error","云端请求失败"));return result;
    }finally{connection.disconnect();}
  }
  private JSONObject decrypt(JSONObject envelope,String key)throws Exception{
    if(envelope.getInt("format")!=1||!key.matches("[A-Za-z0-9_-]{43}"))throw new IOException("密钥或格式不正确");
    byte[] raw=Base64.decode(key,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),nonce=un64(envelope.getString("nonce"));
    if(raw.length!=32||nonce.length!=12)throw new IOException("密钥或密文不正确");
    JSONObject data=new JSONObject(new String(CloudCipher.transform(false,raw,nonce,un64(envelope.getString("ciphertext")),state.getJSONObject("session").getString("accountId")),StandardCharsets.UTF_8));
    validate(data);return data;
  }
  private JSONObject encrypt(JSONObject data)throws Exception{
    byte[] raw=Base64.decode(state.getString("key"),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),nonce=new byte[12];new SecureRandom().nextBytes(nonce);
    byte[] plaintext=bytes(data.toString());if(plaintext.length>8*1024*1024)throw new IOException("同步数据超过 8 MiB");
    return new JSONObject().put("format",1).put("nonce",b64(nonce)).put("ciphertext",b64(CloudCipher.transform(true,raw,nonce,plaintext,state.getJSONObject("session").getString("accountId"))));
  }
  private void validate(JSONObject data)throws Exception{
    if(data.getInt("format")!=1)throw new IOException("不支持的保险库版本");
    JSONArray profiles=data.getJSONObject("store").getJSONArray("profiles");if(profiles.length()>10000)throw new IOException("连接数量过多");
    Set<String> ids=new HashSet<>();
    for(int i=0;i<profiles.length();i++){JSONObject p=profiles.getJSONObject(i);String id=p.getString("id");UUID.fromString(id);if(!ids.add(id))throw new IOException("重复的连接");p.getString("name");p.getString("host");p.getString("username");}
    data.getJSONObject("ai").getJSONArray("providers");data.getJSONArray("devices");
  }
  private JSONObject status()throws Exception{
    return new JSONObject().put("email",state.has("session")?state.getJSONObject("session").getString("email"):"")
      .put("unlocked",state.has("key")).put("revision",state.optLong("revision",0));
  }
  private JSONObject publicData(JSONObject data)throws Exception{
    JSONArray profiles=new JSONArray(),models=new JSONArray();JSONArray all=data.getJSONObject("store").getJSONArray("profiles");
    for(int i=0;i<all.length();i++){
      JSONObject p=all.getJSONObject(i);String protocol=p.optString("protocol","ssh");if(!protocol.equals("ssh")&&!protocol.equals("client"))continue;
      profiles.put(new JSONObject().put("id",p.getString("id")).put("protocol",protocol.equals("client")?"agent":"ssh").put("name",p.getString("name"))
        .put("host",p.getString("host")).put("port",String.valueOf(p.getInt("port"))).put("username",p.getString("username"))
        .put("auth",p.getString("auth")).put("group",p.optString("group")).put("favorite",p.optBoolean("favorite")));
    }
    JSONArray providers=data.getJSONObject("ai").getJSONArray("providers");for(int i=0;i<providers.length();i++){JSONObject p=providers.getJSONObject(i);models.put(new JSONObject().put("name",p.optString("name")).put("model",p.optString("model")));}
    return new JSONObject().put("profiles",profiles).put("models",models).put("theme",data.getJSONObject("store").getJSONObject("preferences").optString("theme","light"));
  }
  synchronized JSONObject call(JSONObject request)throws Exception{
    load();String action=request.getString("action");JSONObject result=new JSONObject();
    if(action.equals("code")){api("auth/code",new JSONObject().put("email",request.getString("email")));}
    else if((action.equals("login") || action.equals("password-login"))){
      JSONObject session=api("auth/"+action,new JSONObject().put("email",request.getString("email")).put(action.equals("password-login")?"password":"code",request.getString("code")));
      if(!state.has("session")||!state.getJSONObject("session").getString("accountId").equals(session.getString("accountId")))state=new JSONObject();
      state.put("session",session);
      if(action.equals("password-login") && !session.isNull("keybox")){
        JSONObject box=session.getJSONObject("keybox"), envelope=box.getJSONObject("envelope");
        byte[] salt=android.util.Base64.decode(box.getString("salt"),android.util.Base64.DEFAULT);
        if(salt.length!=32)throw new IOException("自动解锁数据不正确");
        javax.crypto.spec.PBEKeySpec spec=new javax.crypto.spec.PBEKeySpec(request.getString("code").toCharArray(),salt,210000,256);
        byte[] derived=javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();spec.clearPassword();
        byte[] clear=CloudCipher.transform(false,derived,android.util.Base64.decode(envelope.getString("nonce"),android.util.Base64.DEFAULT),android.util.Base64.decode(envelope.getString("ciphertext"),android.util.Base64.DEFAULT),session.getString("accountId"));
        state.put("key",new JSONObject(new String(clear,java.nio.charset.StandardCharsets.UTF_8)).getString("key"));
      }
      save();
      if(state.has("key"))return call(new JSONObject().put("action","download"));
    }else if(action.equals("unlock")){
      JSONObject remote=api("vault",null);JSONObject data=decrypt(remote.getJSONObject("envelope"),request.getString("key"));
      state.put("key",request.getString("key"));save();
    }else if((action.equals("download")||action.equals("refresh"))){
      JSONObject remote=api("vault",null);if(action.equals("refresh") && remote.getLong("revision")==state.optLong("revision",0))return result.put("status",status());if(remote.getLong("revision")<state.optLong("revision",0))throw new IOException("云端版本回退");
      JSONObject data=decrypt(remote.getJSONObject("envelope"),state.getString("key"));
      if(state.has("bundle"))state.put("backup",state.getJSONObject("bundle"));
      state.put("bundle",data).put("revision",remote.getLong("revision"));state.remove("pending");save();result=publicData(data);
    }else if(action.equals("upload")){
      if(!state.has("bundle"))throw new IOException("请先从 Windows 上传，再在这里恢复云端");
      if(!state.has("pending")){
        JSONObject data=new JSONObject(state.getJSONObject("bundle").toString());JSONObject store=data.getJSONObject("store");
        JSONArray input=request.getJSONArray("profiles"),previous=store.getJSONArray("profiles"),merged=new JSONArray();Map<String,JSONObject> existing=new HashMap<>();
        for(int i=0;i<previous.length();i++){JSONObject p=previous.getJSONObject(i);existing.put(p.getString("id"),p);if(!Arrays.asList("ssh","client").contains(p.optString("protocol","ssh")))merged.put(p);}
        Set<String> ids=new HashSet<>();
        for(int i=0;i<input.length();i++){
          JSONObject p=input.getJSONObject(i);String id=p.getString("id");UUID.fromString(id);if(!ids.add(id))throw new IOException("重复连接");
          JSONObject old=existing.get(id),next=old==null?new JSONObject():new JSONObject(old.toString());
          if(p.optString("protocol").equals("agent")&&old==null)throw new IOException("新增 cagent 需先在桌面端配对；本轮未上传");
          for(String field:Arrays.asList("id","name","host","username","group","auth"))next.put(field,p.getString(field));
          next.put("protocol",p.optString("protocol").equals("agent")?"client":"ssh").put("port",Integer.parseInt(p.getString("port"))).put("favorite",p.optBoolean("favorite"));
          if(old!=null&&(!old.optString("host").equals(next.optString("host"))||old.optInt("port")!=next.optInt("port")||!old.optString("username").equals(next.optString("username"))||!old.optString("auth").equals(next.optString("auth"))))store.getJSONObject("secrets").remove(id);
          merged.put(next);
        }
        store.put("profiles",merged);String theme=request.getString("theme");if(!theme.equals("light")&&!theme.equals("dark"))throw new IOException("主题不正确");store.getJSONObject("preferences").put("theme",theme);
        validate(data);state.put("pendingBundle",data).put("pending",new JSONObject().put("baseRevision",state.getLong("revision")).put("mutationId",UUID.randomUUID().toString()).put("envelope",encrypt(data)));save();
      }
      JSONObject answer=api("vault",state.getJSONObject("pending"));state.put("backup",state.getJSONObject("bundle"));state.put("bundle",state.getJSONObject("pendingBundle")).put("revision",answer.getLong("revision"));state.remove("pending");state.remove("pendingBundle");save();
    }else if(action.equals("logout")){api("auth/logout",new JSONObject());state.remove("session");state.remove("key");state.remove("pending");state.remove("pendingBundle");save();}
    else if(!action.equals("status"))throw new IOException("不支持的同步操作");
    return result.put("status",status());
  }
  synchronized void fillCredentials(JSONObject request)throws Exception{
    load();if(!state.has("bundle")||!request.has("cloudProfileId"))return;
    JSONObject data=state.getJSONObject("bundle").getJSONObject("store");JSONArray profiles=data.getJSONArray("profiles");
    for(int i=0;i<profiles.length();i++){
      JSONObject p=profiles.getJSONObject(i);if(!p.getString("id").equals(request.getString("cloudProfileId")))continue;
      if(!p.getString("host").equals(request.getString("host"))||p.getInt("port")!=request.getInt("port")||!p.getString("username").equals(request.getString("username"))||!p.getString("auth").equals(request.getString("auth")))return;
      JSONObject secret=data.getJSONObject("secrets").optJSONObject(p.getString("id"));if(secret==null)return;
      for(String field:Arrays.asList("password","privateKey","passphrase"))if(request.optString(field).isEmpty()&&secret.has(field))request.put(field,secret.getString(field));return;
    }
  }
}
