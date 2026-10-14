package org.canpshell.mobile;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import javax.security.auth.x500.X500Principal;
import javax.net.ssl.*;
import java.net.Socket;
import java.math.BigInteger;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.Date;

/** Non-exportable installation identity; no private key ever enters the WebView. */
final class AgentIdentity {
  private static final String ALIAS = "cshell-agent-controller-v1";
  static synchronized KeyManager[] managers() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    if (!store.containsAlias(ALIAS)) {
      KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
      generator.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
        // Conscrypt hashes the TLS transcript itself, then uses NONEwithECDSA in KeyStore.
        .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
        .setCertificateSubject(new X500Principal("CN=CShell Android"))
        .setCertificateSerialNumber(new BigInteger(128, new SecureRandom()).add(BigInteger.ONE))
        .setCertificateNotBefore(new Date(System.currentTimeMillis() - 86400000L))
        .setCertificateNotAfter(new Date(System.currentTimeMillis() + 315360000000L)).build());
      generator.generateKeyPair();
    }
    PrivateKey key = (PrivateKey) store.getKey(ALIAS, null);
    X509Certificate certificate = (X509Certificate) store.getCertificate(ALIAS);
    certificate.checkValidity();
    return new KeyManager[]{new X509ExtendedKeyManager() {
      public String[] getClientAliases(String type, java.security.Principal[] issuers) { return "EC".equals(type) ? new String[]{ALIAS} : null; }
      public String chooseClientAlias(String[] types, java.security.Principal[] issuers, Socket socket) { for(String type:types) if("EC".equals(type)) return ALIAS; return null; }
      public String chooseEngineClientAlias(String[] types, java.security.Principal[] issuers, SSLEngine engine) { return chooseClientAlias(types, issuers, null); }
      public X509Certificate[] getCertificateChain(String alias) { return ALIAS.equals(alias) ? new X509Certificate[]{certificate} : null; }
      public PrivateKey getPrivateKey(String alias) { return ALIAS.equals(alias) ? key : null; }
      public String[] getServerAliases(String type, java.security.Principal[] issuers) { return null; }
      public String chooseServerAlias(String type, java.security.Principal[] issuers, Socket socket) { return null; }
    }};
  }
}
