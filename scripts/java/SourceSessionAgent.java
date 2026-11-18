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
  static final Map<String,List<String>> manifests=Collections.synchronizedMap(new LinkedHashMap<>());
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
        } else if(operation.equals("pages")) {
          String source=read(in),chapter=read(in);result=String.join("\n",chapterPages(source,chapter));
        } else if(operation.equals("image")) {
          String source=read(in),chapter=read(in),url=read(in);
          List<String> allowed=manifests.get(source+"\n"+chapter);
          if(allowed==null)allowed=chapterPages(source,chapter);
          if(!allowed.contains(url))throw new IllegalArgumentException("Image outside chapter manifest");
          byte[] image=fetch(source,url,64*1024*1024);out.writeBoolean(true);out.writeInt(image.length);out.write(image);out.flush();continue;
        } else throw new IllegalArgumentException("Unknown session operation");
        out.writeBoolean(true);write(out,result);
      }catch(Exception error){out.writeBoolean(false);write(out,"Source session transfer failed: "+error.getClass().getSimpleName());}out.flush();
    }catch(Exception e){}},"Mreader source session");worker.setDaemon(true);worker.start();
  }
  static Object source(String id)throws Exception{
    Class<?> type=Class.forName("suwayomi.tachidesk.manga.impl.util.source.GetSource");Field field=type.getDeclaredField("sourceCache");field.setAccessible(true);
    Object source=((Map<?,?>)field.get(null)).get(Long.parseLong(id));if(source==null)throw new IllegalStateException("Source is not loaded");return source;
  }
  static byte[] fetch(String id,String url,int limit)throws Exception{
    URI uri=URI.create(url);if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)throw new IllegalArgumentException("Invalid source URL");
    Object source=source(id),client=source.getClass().getMethod("getClient").invoke(source),headers=source.getClass().getMethod("getHeaders").invoke(source);
    Class<?> builderType=Class.forName("okhttp3.Request$Builder"),requestType=Class.forName("okhttp3.Request");
    Object builder=builderType.getConstructor().newInstance();builderType.getMethod("url",String.class).invoke(builder,url);builderType.getMethod("headers",Class.forName("okhttp3.Headers")).invoke(builder,headers);
    Object request=builderType.getMethod("build").invoke(builder),call=Class.forName("okhttp3.OkHttpClient").getMethod("newCall",requestType).invoke(client,request);
    Object response=Class.forName("okhttp3.Call").getMethod("execute").invoke(call);
    try{
      Class<?> responseType=Class.forName("okhttp3.Response");
      if(!(Boolean)responseType.getMethod("isSuccessful").invoke(response))throw new IOException("Source HTTP request failed");
      Object finalRequest=responseType.getMethod("request").invoke(response),finalUrl=requestType.getMethod("url").invoke(finalRequest);
      if(!finalUrl.toString().startsWith("https://"))throw new IOException("Unsafe source redirect");
      Object body=responseType.getMethod("body").invoke(response);InputStream input=(InputStream)Class.forName("okhttp3.ResponseBody").getMethod("byteStream").invoke(body);
      try(InputStream stream=input;ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
        byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1){if(bytes.size()+count>limit)throw new IOException("Source response too large");bytes.write(buffer,0,count);}return bytes.toByteArray();
      }
    }finally{Class.forName("okhttp3.Response").getMethod("close").invoke(response);}
  }
  static List<String> chapterPages(String id,String chapter)throws Exception{
    List<String> pages=parsePages(new String(fetch(id,chapter,8*1024*1024),StandardCharsets.UTF_8),chapter);
    synchronized(manifests){if(manifests.size()>=128)manifests.clear();manifests.put(id+"\n"+chapter,pages);}return pages;
  }
  static List<String> parsePages(String html,String base)throws Exception{
    Object doc=Class.forName("org.jsoup.Jsoup").getMethod("parse",String.class,String.class).invoke(null,html,base);
    Class<?> element=Class.forName("org.jsoup.nodes.Element");
    List<?> images=(List<?>)element.getMethod("select",String.class).invoke(doc,"div.touch-manipulation.select-none > div.flex-col > div.group > img");
    if(images.size()<2||images.size()>1000)return Collections.emptyList();
    List<String> result=new ArrayList<>();String origin=null,directory=null;int start=-1;
    java.util.regex.Pattern file=java.util.regex.Pattern.compile("^(.*)/(\\d+)\\.(?:webp|png|jpe?g|avif)$",java.util.regex.Pattern.CASE_INSENSITIVE);
    for(Object image:images){
      String url=(String)element.getMethod("absUrl",String.class).invoke(image,"src");URI uri;
      try{uri=URI.create(url);}catch(IllegalArgumentException e){return Collections.emptyList();}
      if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)return Collections.emptyList();
      java.util.regex.Matcher match=file.matcher(uri.getRawPath());if(!match.matches())return Collections.emptyList();
      int number;try{number=Integer.parseInt(match.group(2));}catch(NumberFormatException e){return Collections.emptyList();}
      String currentOrigin=uri.getHost().toLowerCase(Locale.ROOT)+":"+(uri.getPort()<0?443:uri.getPort());
      if(result.isEmpty()){start=number;origin=currentOrigin;directory=match.group(1);if(start<0||start>1)return Collections.emptyList();}
      if(!origin.equals(currentOrigin)||!directory.equals(match.group(1))||number!=start+result.size())return Collections.emptyList();result.add(url);
    }return result;
  }
  static String read(DataInputStream in)throws IOException{int size=in.readInt();if(size<0||size>65536)throw new IOException("Invalid session frame");byte[] b=new byte[size];in.readFully(b);return new String(b,StandardCharsets.UTF_8);}
  static void write(DataOutputStream out,String s)throws IOException{byte[] b=s.getBytes(StandardCharsets.UTF_8);out.writeInt(b.length);out.write(b);}
}
