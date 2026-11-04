package org.canpshell.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.widget.*;
import android.text.InputFilter;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Explicit, anonymous user feedback. Never reads device logs, screenshots or credentials. */
public final class FeedbackActivity extends Activity {
  private EditText message,contact; private TextView status; private Button send;
  private String identity="", pending=""; private boolean busy;
  private android.content.SharedPreferences prefs;
  private android.window.OnBackInvokedCallback backCallback;
  public void onCreate(Bundle state){super.onCreate(state);prefs=getSharedPreferences("feedback-draft",MODE_PRIVATE);
    ScrollView scroll=new ScrollView(this);LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);int pad=(int)(24*getResources().getDisplayMetrics().density);body.setPadding(pad,pad,pad,pad);scroll.addView(body);setContentView(scroll);
    Button back=new Button(this);back.setText("返回设置");back.setOnClickListener(v->requestBack());body.addView(back);
    TextView title=new TextView(this);title.setText("意见与问题反馈");title.setTextSize(24);body.addView(title);
    TextView note=new TextView(this);note.setText("只发送你填写的内容、应用版本和 Android 平台。不会附带日志、截图、账号或设备标识。提交前可查看完整内容。");note.setPadding(0,pad,0,pad);body.addView(note);
    message=new EditText(this);message.setHint("描述遇到的问题或建议");message.setMinLines(5);message.setGravity(android.view.Gravity.TOP);message.setInputType(131073);message.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6000)});body.addView(message);
    contact=new EditText(this);contact.setHint("联系方式（选填）");contact.setSingleLine();contact.setFilters(new InputFilter[]{new InputFilter.LengthFilter(254)});body.addView(contact);
    message.setText(prefs.getString("message",""));contact.setText(prefs.getString("contact",""));identity=prefs.getString("id","");pending=prefs.getString("pending","");
    send=new Button(this);send.setText("预览并提交");body.addView(send);status=new TextView(this);body.addView(status);send.setOnClickListener(v->preview());
    if(android.os.Build.VERSION.SDK_INT>=33){backCallback=this::requestBack;getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,backCallback);}
  }
  static String redact(String value){return FeedbackPrivacy.redact(value); }
  private void requestBack(){if(busy){status.setText("正在提交，请稍候");return;}finish();}
  // API 26–32 fallback. API 33+ uses the registered gesture callback above.
  @android.annotation.SuppressLint("GestureBackNavigation")
  @Override public void onBackPressed(){requestBack();}
  @Override protected void onDestroy(){if(android.os.Build.VERSION.SDK_INT>=33&&backCallback!=null)getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);super.onDestroy();}
  private void save(){prefs.edit().putString("message",message.getText().toString()).putString("contact",contact.getText().toString()).putString("id",identity).putString("pending",pending).apply();}
  @Override protected void onPause(){save();super.onPause();}
  private void preview(){if(busy)return;try{
    String text=redact(message.getText().toString().trim()),address=redact(contact.getText().toString().trim());if(text.isEmpty()){status.setText("请先填写问题或建议");return;}
    JSONObject report=new JSONObject().put("message",text).put("contact",address).put("version",getPackageManager().getPackageInfo(getPackageName(),0).versionName).put("platform","android");
    String content=report.toString();if(!content.equals(pending)||identity.isEmpty()){identity=UUID.randomUUID().toString();pending=content;}save();report.put("id",identity);
    new AlertDialog.Builder(this).setTitle("确认发送以下内容").setMessage("版本："+report.getString("version")+" · Android\n\n"+text+"\n\n联系方式："+(address.isEmpty()?"未填写":address)).setNegativeButton("继续编辑",null).setPositiveButton("发送",(d,w)->submit(report.toString())).show();
  }catch(Exception e){status.setText("无法准备反馈，请重试");}}
  private void submit(String payload){busy=true;send.setEnabled(false);message.setEnabled(false);contact.setEnabled(false);status.setText("正在提交…");new Thread(()->{boolean success=false;HttpURLConnection c=null;try{
    c=AndroidAgentService.dataConnection(this,new URL("https://shell.canp.ai/api/v1/feedback"));c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");byte[] bytes=payload.getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);try(java.io.OutputStream out=c.getOutputStream()){out.write(bytes);}if(c.getResponseCode()==200){try(java.io.InputStream in=c.getInputStream()){java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();byte[] chunk=new byte[512];int count;while((count=in.read(chunk))!=-1){if(buffer.size()+count>4096)throw new java.io.IOException("Response too large");buffer.write(chunk,0,count);}byte[] response=buffer.toByteArray();JSONObject result=new JSONObject(new String(response,StandardCharsets.UTF_8));success=result.optBoolean("received")&&identity.equals(result.optString("id"));}}
  }catch(Exception ignored){}finally{if(c!=null)c.disconnect();}final boolean done=success;runOnUiThread(()->{busy=false;send.setEnabled(true);message.setEnabled(true);contact.setEnabled(true);if(done){message.setText("");contact.setText("");pending="";identity="";save();status.setText("反馈已提交，谢谢。可在此继续提交其他问题。");}else status.setText("提交未完成，草稿已保留。请稍后重试，不会重复提交同一条反馈。");});},"feedback-submit").start();}
}
