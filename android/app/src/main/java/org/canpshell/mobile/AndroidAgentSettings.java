package org.canpshell.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Host configuration is local to this installation, separate from saved connections. */
final class AndroidAgentSettings {
  private static final String ALIAS="cshell-android-host-settings-v1";
  private static SecretKey key() throws Exception {
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(!store.containsAlias(ALIAS)){
      KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
      generator.generateKey();
    }
    return (SecretKey)store.getKey(ALIAS,null);
  }
  static synchronized JSONObject read(Context context) throws Exception {
    SharedPreferences p=context.getSharedPreferences("cagent-host-settings",0);
    String password="",encrypted=p.getString("secret","");
    if(!encrypted.isEmpty()){
      String[] parts=encrypted.split("\\.",2);
      if(parts.length!=2)throw new IllegalStateException("连接密码无法读取，请重新设置");
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
      password=new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    return new JSONObject().put("enabled",p.getBoolean("enabled",false)).put("port",p.getInt("port",24443))
      .put("advertisedHost",p.getString("advertisedHost","")).put("advertisedPort",p.getInt("advertisedPort",0)).put("password",password);
  }
  static synchronized JSONObject update(Context context,JSONObject changes) throws Exception {
    JSONObject value=read(context);
    for(String field:new String[]{"enabled","port","advertisedHost","advertisedPort","password"})
      if(changes.has(field))value.put(field,changes.get(field));
    int port=value.getInt("port"),publicPort=value.getInt("advertisedPort");
    String host=value.getString("advertisedHost").trim(),password=value.getString("password");
    if(port<1024||port>65535||publicPort<0||publicPort>65535)throw new IllegalArgumentException("端口须为 1024–65535，对外端口可为 1–65535");
    if(host.length()>253||host.matches(".*[\\s/\\\\\\p{Cntrl}].*"))throw new IllegalArgumentException("对外地址仅填写 IP 或域名");
    if(password.length()>128)throw new IllegalArgumentException("连接密码过长");
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
    String secret=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+"."+Base64.encodeToString(cipher.doFinal(password.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
    if(!context.getSharedPreferences("cagent-host-settings",0).edit().putBoolean("enabled",value.getBoolean("enabled"))
      .putInt("port",port).putString("advertisedHost",host).putInt("advertisedPort",publicPort).putString("secret",secret).commit())
      throw new IllegalStateException("设置保存失败");
    return read(context);
  }
}
