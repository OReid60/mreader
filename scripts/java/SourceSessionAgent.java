package app.mreader;
import java.io.*;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
/** Authenticated loopback-only transfer of user-completed verification. No logs. */
public final class SourceSessionAgent {
  public static void premain(String port, Instrumentation ignored) throws Exception {
    final String token=System.getenv("MREADER_SESSION_TOKEN");
    if(token==null||token.length()<32)throw new IllegalArgumentException("Missing session token");
    final ServerSocket server=new ServerSocket();server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),Integer.parseInt(port)));
    Thread worker=new Thread(()->{while(!server.isClosed())try(Socket socket=server.accept()){
      socket.setSoTimeout(5000);DataInputStream in=new DataInputStream(socket.getInputStream());DataOutputStream out=new DataOutputStream(socket.getOutputStream());
      if(!MessageDigest.isEqual(read(in).getBytes(StandardCharsets.UTF_8),token.getBytes(StandardCharsets.UTF_8)))continue;
      try {
        String operation=read(in),result;
        if(operation.equals("agent")) {
          Class<?> type=Class.forName("suwayomi.tachidesk.manga.impl.util.source.GetSource");
          Field field=type.getDeclaredField("sourceCache");field.setAccessible(true);
          Object source=((Map<?,?>)field.get(null)).get(Long.parseLong(read(in)));
          if(source==null)throw new IllegalStateException("Source is not loaded");
          Method getter=null;for(Class<?> c=source.getClass();c!=null&&getter==null;c=c.getSuperclass())try{getter=c.getDeclaredMethod("getHeaders");}catch(NoSuchMethodException e){}
          if(getter==null)throw new IllegalStateException("Source has no browser headers");getter.setAccessible(true);
          Object headers=getter.invoke(source);result=(String)headers.getClass().getMethod("get",String.class).invoke(headers,"User-Agent");
          if(result==null||result.isBlank())throw new IllegalStateException("Source user agent unavailable");
        } else if(operation.equals("cookies")) {
          URI uri=URI.create(read(in));if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new IllegalArgumentException("Invalid source origin");
          int count=in.readInt();if(count<0||count>128)throw new IllegalArgumentException("Too many cookies");
          CookieHandler handler=CookieHandler.getDefault();if(!(handler instanceof CookieManager))throw new IllegalStateException("Source session is not ready");
          List<HttpCookie> cookies=new ArrayList<>();
          for(int n=0;n<count;n++)for(HttpCookie cookie:HttpCookie.parse(read(in))){
            String domain=cookie.getDomain();if(domain!=null&&!HttpCookie.domainMatches(domain,uri.getHost()))throw new IllegalArgumentException("Cookie outside source origin");
            if(domain==null)cookie.setDomain(uri.getHost());cookies.add(cookie);
          }
          for(HttpCookie cookie:cookies)((CookieManager)handler).getCookieStore().add(uri,cookie);
          result=Integer.toString(cookies.size());
        } else throw new IllegalArgumentException("Unknown session operation");
        out.writeBoolean(true);write(out,result);
      }catch(Exception error){out.writeBoolean(false);write(out,"Source session transfer failed: "+error.getClass().getSimpleName());}out.flush();
    }catch(Exception e){}},"Mreader source session");worker.setDaemon(true);worker.start();
  }
  static String read(DataInputStream in)throws IOException{int size=in.readInt();if(size<0||size>65536)throw new IOException("Invalid session frame");byte[] b=new byte[size];in.readFully(b);return new String(b,StandardCharsets.UTF_8);}
  static void write(DataOutputStream out,String s)throws IOException{byte[] b=s.getBytes(StandardCharsets.UTF_8);out.writeInt(b.length);out.write(b);}
}
