package org.canpshell.mobile;
import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
final class BrowserStore {
  private static synchronized SecretKey key()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);String alias="cshell-browser-library";if(!ks.containsAlias(alias)){KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();}return (SecretKey)ks.getKey(alias,null);}
  static void write(Context c,String id,String value)throws Exception{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));String data=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);c.getSharedPreferences("browser-library",0).edit().putString(id,data).apply();}
  static String read(Context c,String id)throws Exception{String raw=c.getSharedPreferences("browser-library",0).getString(id,"");if(raw.isEmpty())return "{}";String[] p=raw.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(p[0],Base64.DEFAULT)));cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));return new String(cipher.doFinal(Base64.decode(p[1],Base64.DEFAULT)),StandardCharsets.UTF_8);}
}
