package org.canpshell.mobile;

import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** AES-GCM wire primitive shared by the Android client and JVM interoperability test. */
final class CloudCipher {
  static byte[] transform(boolean encrypt,byte[] key,byte[] nonce,byte[] input,String account)throws Exception{
    if(key.length!=32||nonce.length!=12)throw new IllegalArgumentException("Invalid vault key or nonce");
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));
    cipher.updateAAD(("cshell-sync:1:"+account).getBytes(StandardCharsets.UTF_8));
    return cipher.doFinal(input);
  }
}
