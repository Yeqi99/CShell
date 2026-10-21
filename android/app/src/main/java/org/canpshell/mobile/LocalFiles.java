package org.canpshell.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Phone files are confined to a user-selected SAF tree, never arbitrary device paths. */
public final class LocalFiles implements AutoCloseable {
  private static final int CHOOSE=4410, IMPORT=4411, EXPORT=4412, MAX_ENTRIES=10000;
  private static final String MIME_DIR=DocumentsContract.Document.MIME_TYPE_DIR;
  private final Activity activity;
  private final SharedPreferences prefs;
  private final Consumer<JSONObject> statusCallback, fileCallback;
  private final ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(8));
  private final Map<String,String> parents=new HashMap<>();
  private volatile boolean closed;
  private volatile long lastGrantCheck;
  private String currentTree="";
  private JSONObject pending;
  private boolean choosing;

  public LocalFiles(Activity activity,Consumer<JSONObject> statusCallback,Consumer<JSONObject> fileCallback){
    this.activity=activity;this.statusCallback=statusCallback;this.fileCallback=fileCallback;
    prefs=activity.getSharedPreferences("local-files",Activity.MODE_PRIVATE);
  }
  public synchronized boolean hasPendingPicker(){return choosing||pending!=null;}
  private void emit(Consumer<JSONObject> callback,JSONObject result){activity.runOnUiThread(()->{if(!closed)callback.accept(result);});}
  private JSONObject error(Exception e){return json("error",e instanceof SecurityException?"手机目录授权已撤销，请重新选择目录":e.getMessage()==null?"手机文件操作失败":e.getMessage());}
  private static JSONObject json(String key,Object value){JSONObject j=new JSONObject();try{j.put(key,value);}catch(Exception ignored){}return j;}
  private void result(JSONObject request,JSONObject result){try{result.put("request",request.getString("request"));}catch(Exception ignored){}emit(fileCallback,result);}

  private synchronized Uri tree()throws IOException {
    String saved=prefs.getString("tree","");
    if(saved.isEmpty())throw new IOException("请先选择手机目录");
    Uri uri=Uri.parse(saved);boolean allowed=false;
    for(UriPermission permission:activity.getContentResolver().getPersistedUriPermissions())
      if(permission.getUri().equals(uri)&&permission.isReadPermission()){allowed=true;break;}
    if(!allowed)throw new SecurityException("目录授权已撤销");
    if(!saved.equals(currentTree)){parents.clear();currentTree=saved;}
    Uri root=DocumentsContract.buildDocumentUriUsingTree(uri,DocumentsContract.getTreeDocumentId(uri));
    parents.put(root.toString(),null);return uri;
  }
  private Uri root(Uri tree){return DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));}
  private synchronized Uri resolve(String path)throws IOException {
    Uri tree=tree();if(path.isEmpty()||path.equals("."))return root(tree);
    if(path.length()>8192||!parents.containsKey(path))throw new IOException("目录位置已失效，请回到手机目录首页");
    Uri uri=Uri.parse(path);
    if(!Objects.equals(uri.getAuthority(),tree.getAuthority())||!DocumentsContract.getTreeDocumentId(uri).equals(DocumentsContract.getTreeDocumentId(tree)))throw new IOException("路径不在所选手机目录中");
    return uri;
  }
  private void check(String selectedTree)throws IOException {
    if(closed||Thread.currentThread().isInterrupted())throw new IOException("传输已停止");
    if(!prefs.getString("tree","").equals(selectedTree))throw new IOException("手机目录已更换，请重试");
    long now=android.os.SystemClock.elapsedRealtime();
    if(now-lastGrantCheck>=1000){if(!tree().toString().equals(selectedTree))throw new IOException("手机目录已更换，请重试");lastGrantCheck=now;}
  }
  private JSONObject metadata(Uri uri)throws Exception {
    String[] columns={DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE};
    try(Cursor c=activity.getContentResolver().query(uri,columns,null,null,null)){
      if(c==null||!c.moveToFirst())throw new IOException("文件已移动或不可访问");
      return new JSONObject().put("name",c.getString(0)).put("directory",MIME_DIR.equals(c.getString(1))).put("mime",c.getString(1)).put("size",c.isNull(2)?JSONObject.NULL:c.getLong(2));
    }
  }
  public JSONObject status(){
    try{Uri tree=tree(),root=root(tree);return new JSONObject().put("available",true).put("name",metadata(root).getString("name")).put("path",root.toString());}
    catch(Exception e){JSONObject value=json("available",false);if(!prefs.getString("tree","").isEmpty())try{value.put("error",error(e).get("error"));}catch(Exception ignored){}return value;}
  }
  public void choose(){activity.runOnUiThread(()->{
    boolean started=false;
    try{synchronized(this){if(hasPendingPicker())throw new IOException("请先完成当前文件选择");choosing=true;started=true;}
      Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
      activity.startActivityForResult(intent,CHOOSE);
    }catch(Exception e){if(started)synchronized(this){choosing=false;}JSONObject value=status();try{value.put("error",error(e).get("error"));}catch(Exception ignored){}emit(statusCallback,value);}
  });}
  public void request(JSONObject request){
    try{
      UUID.fromString(request.getString("request"));if(!"local".equals(request.getString("session")))throw new IOException("文件来源不匹配");
      String op=request.getString("operation");
      if(!Arrays.asList("list","preview","upload","download").contains(op))throw new IOException("不支持的手机文件操作");
      if(closed)throw new IOException("文件页已关闭");
      if(op.equals("upload")||op.equals("download"))activity.runOnUiThread(()->pick(request));
      else worker.execute(()->operate(request,null));
    }catch(RejectedExecutionException e){result(request,json("error","文件任务繁忙，请稍后重试"));}
    catch(Exception e){result(request,error(e));}
  }
  private void pick(JSONObject request){
    try{
      synchronized(this){if(hasPendingPicker())throw new IOException("请先完成当前文件选择");pending=request;}
      boolean importing="upload".equals(request.getString("operation"));
      Uri location=resolve(request.optString("path","."));
      JSONObject info=metadata(location);if(importing!=info.getBoolean("directory"))throw new IOException(importing?"请选择目标目录":"请选择要导出的文件");
      Intent intent=new Intent(importing?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(importing?"*/*":info.optString("mime","application/octet-stream"));
      if(!importing)intent.putExtra(Intent.EXTRA_TITLE,info.getString("name"));
      activity.startActivityForResult(intent,importing?IMPORT:EXPORT);
    }catch(Exception e){synchronized(this){if(pending==request)pending=null;}result(request,error(e));}
  }
  public boolean onActivityResult(int code,int response,Intent data){
    if(code==CHOOSE){
      synchronized(this){choosing=false;}
      if(response!=Activity.RESULT_OK||data==null||data.getData()==null){JSONObject s=status();try{s.put("cancelled",true);}catch(Exception ignored){}emit(statusCallback,s);return true;}
      try{
        Uri selected=data.getData();if(!DocumentsContract.isTreeUri(selected))throw new IOException("请选择目录");
        int flags=data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if((flags&Intent.FLAG_GRANT_READ_URI_PERMISSION)==0)throw new IOException("未获得目录读取权限");
        activity.getContentResolver().takePersistableUriPermission(selected,
          (flags&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)!=0
            ? Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            : Intent.FLAG_GRANT_READ_URI_PERMISSION);
        String old=prefs.getString("tree","");
        if(!prefs.edit().putString("tree",selected.toString()).commit())throw new IOException("无法保存手机目录");
        synchronized(this){parents.clear();currentTree="";}
        // Release only our previous tree grant, never another feature's document permission.
        if(!old.isEmpty()&&!old.equals(selected.toString()))try{activity.getContentResolver().releasePersistableUriPermission(Uri.parse(old),Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(Exception ignored){}
        emit(statusCallback,status());
      }catch(Exception e){JSONObject s=status();try{s.put("error",error(e).get("error"));}catch(Exception ignored){}emit(statusCallback,s);}
      return true;
    }
    if(code!=IMPORT&&code!=EXPORT)return false;
    JSONObject request;synchronized(this){request=pending;pending=null;}if(request==null)return true;
    if(response!=Activity.RESULT_OK||data==null||data.getData()==null){result(request,json("cancelled",true));return true;}
    Uri selected=data.getData();try{worker.execute(()->operate(request,selected));}catch(RejectedExecutionException e){result(request,json("error","文件任务繁忙，请重试"));}return true;
  }
  private JSONObject list(Uri directory,String selectedTree)throws Exception {
    if(!metadata(directory).getBoolean("directory"))throw new IOException("请选择目录");
    Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(directory,DocumentsContract.getDocumentId(directory));
    String[] columns={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE};
    List<JSONObject> items=new ArrayList<>();
    try(Cursor c=activity.getContentResolver().query(children,columns,null,null,null)){
      if(c==null)throw new IOException("无法读取目录");
      while(c.moveToNext()){
        check(selectedTree);if(items.size()>=MAX_ENTRIES)throw new IOException("目录超过 10000 项，请选择更小的目录");
        Uri child=DocumentsContract.buildDocumentUriUsingTree(directory,c.getString(0));
        items.add(new JSONObject().put("name",c.getString(1)).put("path",child.toString()).put("directory",MIME_DIR.equals(c.getString(2))).put("size",c.isNull(3)?JSONObject.NULL:c.getLong(3)));
      }
    }
    items.sort((a,b)->{int dirs=Boolean.compare(b.optBoolean("directory"),a.optBoolean("directory"));return dirs!=0?dirs:a.optString("name").compareToIgnoreCase(b.optString("name"));});
    synchronized(this){
      // Keep only a bounded navigation capability cache. Root remains reachable.
      if(parents.size()+items.size()>22000){
        Map<String,String> ancestors=new HashMap<>();String cursor=directory.toString();
        while(cursor!=null&&parents.containsKey(cursor)&&!ancestors.containsKey(cursor)){String parent=parents.get(cursor);ancestors.put(cursor,parent);cursor=parent;}
        parents.clear();parents.putAll(ancestors);parents.put(root(tree()).toString(),null);
      }
      for(JSONObject item:items)parents.put(item.getString("path"),directory.toString());
      return new JSONObject().put("path",directory.toString()).put("parent",parents.get(directory.toString())==null?JSONObject.NULL:parents.get(directory.toString())).put("name",metadata(directory).getString("name")).put("entries",new JSONArray(items));
    }
  }
  private void copy(InputStream in,OutputStream out,String tree)throws IOException {
    LocalFileStreams.copy(in,out,()->check(tree));
  }
  private void operate(JSONObject request,Uri selected){
    Uri created=null;boolean committed=false;JSONObject failure=null;
    try{
      String selectedTree=tree().toString(),op=request.getString("operation");Uri path=resolve(request.optString("path","."));check(selectedTree);JSONObject result=new JSONObject();
      if(op.equals("list"))result=list(path,selectedTree);
      else if(op.equals("preview")){
        JSONObject info=metadata(path);if(info.getBoolean("directory"))throw new IOException("请选择文件");if(info.optLong("size",0)>65536)throw new IOException("文件超过 64 KiB，请导出后查看");
        try(InputStream in=activity.getContentResolver().openInputStream(path)){
          result.put("name",info.getString("name")).put("text",LocalFileStreams.preview(in,()->check(selectedTree)));
        }
      }else if(op.equals("download")){
        if(selected==null||selected.equals(path)||(DocumentsContract.isDocumentUri(activity,selected)&&Objects.equals(selected.getAuthority(),path.getAuthority())&&DocumentsContract.getDocumentId(selected).equals(DocumentsContract.getDocumentId(path))))throw new IOException("请选择不同的导出位置");
        try(InputStream in=activity.getContentResolver().openInputStream(path);OutputStream out=activity.getContentResolver().openOutputStream(selected,"wt")){copy(in,out,selectedTree);}
      }else if(op.equals("upload")){
        if(selected==null)throw new IOException("请选择要导入的文件");String name=null;
        try(Cursor c=activity.getContentResolver().query(selected,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(c!=null&&c.moveToFirst())name=c.getString(0);}
        if(name==null||name.isEmpty()||name.equals(".")||name.equals("..")||name.contains("/")||name.contains("\\")||name.indexOf(0)>=0)throw new IOException("文件名无效");
        JSONArray entries=list(path,selectedTree).getJSONArray("entries");for(int i=0;i<entries.length();i++)if(name.equals(entries.getJSONObject(i).getString("name")))throw new IOException("目录已有同名文件，请先重命名后导入");
        check(selectedTree);
        String mime=activity.getContentResolver().getType(selected);created=DocumentsContract.createDocument(activity.getContentResolver(),path,mime==null?"application/octet-stream":mime,name);
        if(created==null)throw new IOException("所选目录不可写");
        try(InputStream in=activity.getContentResolver().openInputStream(selected);OutputStream out=activity.getContentResolver().openOutputStream(created,"wt")){copy(in,out,selectedTree);}
        committed=true;result.put("name",metadata(created).getString("name"));
      }
      check(selectedTree);result(request,result);
    }catch(Exception e){failure=error(e);}
    finally{
      if(created!=null&&!committed)try{if(!DocumentsContract.deleteDocument(activity.getContentResolver(),created))throw new IOException("cleanup");}
      catch(Exception cleanup){if(failure==null)failure=json("error","导入未完成");try{failure.put("error",failure.optString("error")+"；未能清理未完成文件，请在所选目录检查");}catch(Exception ignored){}}
      if(failure!=null)result(request,failure);
    }
  }
  @Override public void close(){closed=true;worker.shutdownNow();synchronized(this){pending=null;choosing=false;parents.clear();}}
}
