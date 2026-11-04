package org.canpshell.mobile;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;

/** Data requests use the chosen machine; control-plane bootstrap stays independent. */
final class AndroidAppNetwork {
  interface ProxySource { Proxy get() throws IOException; }
  static HttpURLConnection open(URL url, boolean selected, ProxySource source) throws IOException {
    if (!url.getProtocol().equals("https") && !url.getProtocol().equals("http"))
      throw new IOException("Unsupported network protocol");
    if (!selected) return (HttpURLConnection)url.openConnection();
    Proxy proxy=source.get();
    if(proxy==null || proxy.type()==Proxy.Type.DIRECT)
      throw new IOException("Selected machine network exit unavailable");
    return (HttpURLConnection)url.openConnection(proxy);
  }
}
