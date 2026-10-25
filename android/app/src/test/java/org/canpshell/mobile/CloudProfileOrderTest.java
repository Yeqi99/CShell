package org.canpshell.mobile;
import java.util.*;

public final class CloudProfileOrderTest {
  static final class P { final String id,protocol,opaque; P(String id,String protocol){this.id=id;this.protocol=protocol;this.opaque="future-field:"+id;} }
  static boolean supported(P p){return p.protocol.equals("ssh")||p.protocol.equals("client");}
  static List<P> merge(List<P> before,List<P> input){return CloudProfileOrder.merge(before,input,p->p.id,CloudProfileOrderTest::supported);}
  static void order(List<P> actual,String... ids){if(!actual.stream().map(p->p.id).collect(java.util.stream.Collectors.toList()).equals(Arrays.asList(ids)))throw new AssertionError("Wrong order");}
  public static void main(String[] args){
    P a=new P("a","ssh"), b=new P("b","ftp"), c=new P("c","client"), d=new P("d","sftp"),e=new P("e","ftps"), n=new P("new","ssh");
    List<P> before=Arrays.asList(a,b,c,d,e);
    List<P> same=merge(before,Arrays.asList(a,c));order(same,"a","b","c","d","e");
    if(same.get(1)!=b||same.get(3)!=d||same.get(4)!=e)throw new AssertionError("Opaque data replaced");
    order(merge(before,Arrays.asList(c,a)),"c","b","a","d","e");
    order(merge(before,Arrays.asList(c)),"b","c","d","e");
    order(merge(before,Collections.emptyList()),"b","d","e");
    order(merge(before,Arrays.asList(n,a,c)),"new","b","a","d","e","c");
    order(merge(before,Arrays.asList(a,c,n)),"a","b","c","d","e","new");
    P updated=new P("a","ssh");if(merge(before,Arrays.asList(updated,c)).get(0)!=updated)throw new AssertionError("Update lost");
    for(List<P> invalid:Arrays.asList(Arrays.asList(a,a),Arrays.asList(new P("b","ssh")),Arrays.asList(b))){
      try{merge(before,invalid);throw new AssertionError("Invalid identity accepted");}catch(IllegalArgumentException expected){}
    }
    order(before,"a","b","c","d","e");
    System.out.println("PASS: unchanged order, explicit reorder, delete, add, opaque identity/data preservation, duplicate/protocol rejection");
  }
}
