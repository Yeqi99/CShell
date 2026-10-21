package org.canpshell.mobile;
import java.util.Base64;
public class CloudCipherInterop {
  public static void main(String[] args)throws Exception{
    byte[] key=Base64.getDecoder().decode(args[0]),nonce=Base64.getDecoder().decode(args[1]),encrypted=Base64.getDecoder().decode(args[2]);
    byte[] plaintext=CloudCipher.transform(false,key,nonce,encrypted,args[3]);
    if(!java.util.Arrays.equals(encrypted,CloudCipher.transform(true,key,nonce,plaintext,args[3])))throw new AssertionError("Wire mismatch");
    try{CloudCipher.transform(false,key,nonce,encrypted,"wrong-account");throw new AssertionError("Missing account binding");}catch(javax.crypto.AEADBadTagException expected){}
    encrypted[0]^=1;
    try{CloudCipher.transform(false,key,nonce,encrypted,args[3]);throw new AssertionError("Missing authentication");}catch(javax.crypto.AEADBadTagException expected){}
    System.out.print(Base64.getEncoder().encodeToString(plaintext));
  }
}
