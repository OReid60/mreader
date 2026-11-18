package app.mreader;
import java.util.*;
import okhttp3.*;
public final class SourceSessionAgentTest {
  static final byte[] IMAGE={(byte)0x89,0x50,0x4e,0x47,0x00,(byte)0xff};
  static String reader(String... urls){String html="<img src='https://ads.test/cover.jpg'><div class='touch-manipulation select-none'><div class='flex-col'>";for(String url:urls)html+="<div class='group'><img src='"+url+"'></div>";return html+"</div></div><img src='https://ads.test/ad.jpg'>";}
  public static final class FixtureSource {
    final OkHttpClient client=new OkHttpClient.Builder().addInterceptor(chain->{
      if(!"verification-session".equals(chain.request().header("X-Fixture")))throw new java.io.IOException("Source headers lost");
      byte[] body=chain.request().url().host().equals("source.test")?reader("https://images.test/title/1/0.webp","https://images.test/title/1/1.webp").getBytes(java.nio.charset.StandardCharsets.UTF_8):IMAGE;
      return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(ResponseBody.create(MediaType.parse("text/html"),body)).build();
    }).build();
    public OkHttpClient getClient(){return client;}
    public Headers getHeaders(){return new Headers.Builder().add("X-Fixture","verification-session").build();}
  }
  public static void main(String[] args)throws Exception{
    String first="https://images.test/title/1/0.webp",second="https://images.test/title/1/1.webp";
    if(!SourceSessionAgent.parsePages(reader(first,second),"https://source.test/chapter").equals(Arrays.asList(first,second)))throw new AssertionError("Reader isolation failed");
    for(String html:Arrays.asList("<img src='"+first+"'><img src='"+second+"'>",reader(first,"https://other.test/title/1/1.webp"),reader(first,"https://images.test/other/1.webp"),reader(first,"https://images.test/title/1/2.webp"),reader(first,"http://images.test/title/1/1.webp")))if(!SourceSessionAgent.parsePages(html,"https://source.test/chapter").isEmpty())throw new AssertionError("Unrelated images accepted");
    suwayomi.tachidesk.manga.impl.util.source.GetSource.sourceCache.put(7L,new FixtureSource());
    if(SourceSessionAgent.chapterPages("7","https://source.test/chapter").size()!=2)throw new AssertionError("Source-client fetch failed");
    if(!Arrays.equals(SourceSessionAgent.fetch("7",first,1024),IMAGE))throw new AssertionError("Source image transport failed");
    try{SourceSessionAgent.fetch("7",first,3);throw new AssertionError("Response bound ignored");}catch(java.io.IOException expected){}
    int port;try(java.net.ServerSocket probe=new java.net.ServerSocket(0)){port=probe.getLocalPort();}
    SourceSessionAgent.premain(Integer.toString(port),null);
    byte[] manifest=exchange(port,true,"pages","7","https://source.test/chapter");
    if(!new String(manifest,java.nio.charset.StandardCharsets.UTF_8).equals(first+"\n"+second))throw new AssertionError("Manifest protocol failed");
    if(!Arrays.equals(exchange(port,true,"image","7","https://source.test/chapter",first),IMAGE))throw new AssertionError("Binary image protocol failed");
    exchange(port,false,"image","7","https://source.test/chapter","https://images.test/advert/0.webp");
    System.out.println("PASS desktop parser, image isolation, source client/headers and response limits");
  }
  static byte[] exchange(int port,boolean success,String... values)throws Exception{
    try(java.net.Socket socket=new java.net.Socket("127.0.0.1",port)){
      socket.setSoTimeout(5000);java.io.DataOutputStream out=new java.io.DataOutputStream(socket.getOutputStream());
      SourceSessionAgent.write(out,System.getenv("MREADER_SESSION_TOKEN"));for(String value:values)SourceSessionAgent.write(out,value);out.flush();
      java.io.DataInputStream in=new java.io.DataInputStream(socket.getInputStream());if(in.readBoolean()!=success)throw new AssertionError("Unexpected protocol status");
      int size=in.readInt();if(size<0||size>65536)throw new AssertionError("Invalid fixture response size");byte[] bytes=new byte[size];in.readFully(bytes);return bytes;
    }
  }
}
