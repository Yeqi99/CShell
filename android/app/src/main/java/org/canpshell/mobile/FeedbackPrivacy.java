package org.canpshell.mobile;
final class FeedbackPrivacy {
  static String redact(String value){return value.replaceAll("(?i)Bearer\\s+[^\\s\"']+","Bearer [已隐藏]").replaceAll("sk-[A-Za-z0-9_-]{8,}","[密钥已隐藏]").replaceAll("(?i)(password|token|api[_-]?key|secret)(\\s*[=:]\\s*)([^\\s,;]+)","$1$2[已隐藏]").replaceAll("(https?://)[^/@\\s]+:[^/@\\s]+@","$1[已隐藏]@");}
}
