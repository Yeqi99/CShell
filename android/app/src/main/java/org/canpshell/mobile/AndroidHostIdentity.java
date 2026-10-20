package org.canpshell.mobile;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import javax.security.auth.x500.X500Principal;
import javax.net.ssl.*;
import java.net.Socket;
import java.math.BigInteger;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.*;

/** Host identity is separate from the controller identity, non-exportable and stable across upgrades. */
final class AndroidHostIdentity {
  final String id;
  final X509Certificate certificate;
  final KeyManager[] managers;
  AndroidHostIdentity(Context context)throws Exception {
    android.content.SharedPreferences prefs=context.getSharedPreferences("cagent-host-identity",0);
    String existing=prefs.getString("id",null);
    if(existing==null){existing=UUID.randomUUID().toString();if(!prefs.edit().putString("id",existing).commit())throw new java.io.IOException("Cannot persist host identity");}
    id=existing;
    final String alias="cshell-android-cagent-host-v1";
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(!store.containsAlias(alias)){
      KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore");
      generator.initialize(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_NONE,KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA384,KeyProperties.DIGEST_SHA512)
        .setCertificateSubject(new X500Principal("CN="+id)).setCertificateSerialNumber(new BigInteger(128,new SecureRandom()).add(BigInteger.ONE))
        .setCertificateNotBefore(new Date(System.currentTimeMillis()-86400000L)).setCertificateNotAfter(new Date(System.currentTimeMillis()+315360000000L)).build());
      generator.generateKeyPair();
    }
    final PrivateKey key=(PrivateKey)store.getKey(alias,null);
    certificate=(X509Certificate)store.getCertificate(alias);certificate.checkValidity();
    managers=new KeyManager[]{new X509ExtendedKeyManager(){
      public String[] getClientAliases(String type,Principal[] issuers){return null;}
      public String chooseClientAlias(String[] types,Principal[] issuers,Socket socket){return null;}
      public String[] getServerAliases(String type,Principal[] issuers){return "EC".equals(type)?new String[]{alias}:null;}
      public String chooseServerAlias(String type,Principal[] issuers,Socket socket){return "EC".equals(type)?alias:null;}
      public String chooseEngineServerAlias(String type,Principal[] issuers,SSLEngine engine){return chooseServerAlias(type,issuers,null);}
      public X509Certificate[] getCertificateChain(String a){return alias.equals(a)?new X509Certificate[]{certificate}:null;}
      public PrivateKey getPrivateKey(String a){return alias.equals(a)?key:null;}
    }};
  }
  String pem()throws Exception{return "-----BEGIN CERTIFICATE-----\n"+Base64.encodeToString(certificate.getEncoded(),Base64.NO_WRAP).replaceAll("(.{64})","$1\n")+"\n-----END CERTIFICATE-----";}
  static String fingerprint(byte[] der)throws Exception{byte[] digest=MessageDigest.getInstance("SHA-256").digest(der);StringBuilder out=new StringBuilder();for(byte b:digest){if(out.length()>0)out.append(':');out.append(String.format(Locale.ROOT,"%02X",b));}return out.toString();}
}
