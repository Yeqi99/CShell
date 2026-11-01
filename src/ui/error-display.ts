/** Shared display/log/copy redaction: raw service errors never render directly. */
export function cleanDisplayError(error:string){
 return error.replace(/Error invoking remote method '[^']*':\s*/g,'').replace(/^(Error:\s*)+/,'')
  .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[私钥已隐藏]')
  .replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[密钥已隐藏]')
  .replace(/(Bearer\s+)[^\s"']+/gi,'$1[已隐藏]')
  .replace(/((?:api[_-]?key|password|passwd|secret|access[_-]?token|refresh[_-]?token|token)["']?\s*[:=]\s*)(["'])([^]*?)\2/gi,'$1"[已隐藏]"')
  .replace(/((?:api[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*)[^\s,"'}&]+/gi,'$1[已隐藏]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[认证已隐藏]@');
}
