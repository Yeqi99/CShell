// Optional Windows x64 virtual display helper. No third-party installer or signature-policy changes.
// Mutating commands require explicit elevated invocation. probe/self-test are read-only.
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

class VirtualDisplay {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
  static readonly Guid DisplayClass = new Guid("4d36e968-e325-11ce-bfc1-08002be10318");
  static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "CAgent", "virtual-display");
  const string Prefix = "ROOT\\CAGENTVDD\\";
  const uint Invalid = 0xffffffff;
  public class Snapshot { public byte[][] paths; public byte[][] modes; public int emptyFallbackError; public string emptyEvidence; }
  public class Journal { public int schema = 1; public string id; public string device; public string phase; public Snapshot before; public string error; }
  [StructLayout(LayoutKind.Sequential)] struct Device { public uint size; public Guid guid; public uint devInst; public IntPtr reserved; }
  [StructLayout(LayoutKind.Sequential)] struct RemoveParams { public uint headerSize,installFunction,scope,profile; }
  [StructLayout(LayoutKind.Sequential)] struct Luid { public uint low; public int high; }
  [StructLayout(LayoutKind.Sequential)] struct PathSource { public Luid adapter; public uint id,index,status; }
  [StructLayout(LayoutKind.Sequential)] struct PathTarget { public Luid adapter; public uint id,index,technology,rotation,scaling,numerator,denominator,scanline; public int available; public uint status; }
  [StructLayout(LayoutKind.Sequential)] struct PathInfo { public PathSource source; public PathTarget target; public uint flags; }
  [StructLayout(LayoutKind.Explicit,Size=64)] struct ModeInfo { [FieldOffset(0)] public uint type; [FieldOffset(4)] public uint id; [FieldOffset(8)] public Luid adapter; [FieldOffset(16)] public uint width; [FieldOffset(20)] public uint height; [FieldOffset(24)] public uint format; [FieldOffset(28)] public int x; [FieldOffset(32)] public int y; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct DisplayDevice {
    public uint size; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string description; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string id;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string key;
  }
  delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,IntPtr rectangle,IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,MonitorCallback callback,IntPtr data);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevicesW(string device,uint index,ref DisplayDevice result,uint flags);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint process,out uint session);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct InstallParams {
    public uint size, flags, flagsEx; public IntPtr parent, handler, context, queue, reserved; public uint reserved2;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string driverPath;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Driver {
    public uint size, type; public IntPtr reserved;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string description;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string manufacturer;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string provider;
    public System.Runtime.InteropServices.ComTypes.FILETIME date; public ulong version;
  }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags,out uint paths,out uint modes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags,ref uint paths,byte[] path,ref uint modes,byte[] mode,IntPtr topology);
  [DllImport("user32.dll")] static extern int SetDisplayConfig(uint paths,byte[] path,uint modes,byte[] mode,uint flags);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(byte[] request);
  [DllImport("setupapi.dll",SetLastError=true)] static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid guid,IntPtr hwnd);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiCreateDeviceInfoW(IntPtr set,string name,ref Guid guid,string description,IntPtr hwnd,uint flags,ref Device device);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiOpenDeviceInfoW(IntPtr set,string name,IntPtr hwnd,uint flags,ref Device device);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiSetDeviceRegistryPropertyW(IntPtr set,ref Device device,uint property,byte[] value,uint size);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiGetDeviceRegistryPropertyW(IntPtr set,ref Device device,uint property,out uint type,byte[] value,uint size,out uint required);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiSetDeviceInstallParamsW(IntPtr set,ref Device device,ref InstallParams parameters);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiGetDeviceInstallParamsW(IntPtr set,ref Device device,ref InstallParams parameters);
  [DllImport("setupapi.dll",SetLastError=true)] static extern bool SetupDiBuildDriverInfoList(IntPtr set,ref Device device,uint type);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiEnumDriverInfoW(IntPtr set,ref Device device,uint type,uint index,ref Driver driver);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiSetSelectedDriverW(IntPtr set,ref Device device,ref Driver driver);
  [DllImport("setupapi.dll",SetLastError=true)] static extern bool SetupDiCallClassInstaller(uint code,IntPtr set,ref Device device);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool SetupDiSetClassInstallParamsW(IntPtr set,ref Device device,ref RemoveParams parameters,uint size);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
  [DllImport("setupapi.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr SetupDiGetClassDevsW(ref Guid guid,string enumerator,IntPtr hwnd,uint flags);
  [DllImport("setupapi.dll",SetLastError=true)] static extern bool SetupDiEnumDeviceInfo(IntPtr set,uint index,ref Device device);

  static uint U(byte[] value,int offset) { return BitConverter.ToUInt32(value,offset); }
  static int I(byte[] value,int offset) { return BitConverter.ToInt32(value,offset); }
  static void Put(byte[] value,int offset,uint data) { Buffer.BlockCopy(BitConverter.GetBytes(data),0,value,offset,4); }
  static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", ""); }
  static string Source(byte[] p) { return Hex(p.Take(12).ToArray()); }
  static string Target(byte[] p) { return Hex(p.Skip(20).Take(12).ToArray()); }
  static byte[][] Split(byte[] source,uint count,int size) { return Enumerable.Range(0,(int)count).Select(i=>source.Skip(i*size).Take(size).ToArray()).ToArray(); }
  static byte[] Flatten(byte[][] source) { return source.SelectMany(x=>x).ToArray(); }
  static void Win(bool success,string operation) { if (!success) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),operation); }
  static void Status(int code,string operation) { if(code!=0) throw new System.ComponentModel.Win32Exception(code,operation); }
  static Device NewDevice() { return new Device { size=(uint)Marshal.SizeOf(typeof(Device)) }; }
  static IntPtr DeviceSet() { Guid guid=DisplayClass; IntPtr result=SetupDiCreateDeviceInfoList(ref guid,IntPtr.Zero); if(result==new IntPtr(-1)) Win(false,"Create device set"); return result; }
  static bool CanProveEmpty(int error,bool console,bool desktop,bool enumerated,int monitors,int metricMonitors,int attached) {
    // Access denied and arbitrary failures never become an empty desktop.
    return (error==31||error==50)&&console&&desktop&&enumerated&&monitors==0&&metricMonitors==0&&attached==0;
  }
  static Snapshot EmptyIfProven(int error) {
    if(error!=31&&error!=50) return null;
    uint session; bool console=ProcessIdToSessionId(GetCurrentProcessId(),out session)&&session!=0&&session==WTSGetActiveConsoleSessionId();
    if(!console) return null;
    IntPtr desktop=OpenInputDesktop(0,false,1); if(desktop==IntPtr.Zero) return null;
    try {
      int monitors=0,attached=0; MonitorCallback callback=delegate { monitors++; return true; };
      bool enumerated=EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,callback,IntPtr.Zero);
      bool completed=false;
      for(uint i=0;i<256;i++) { DisplayDevice d=new DisplayDevice {size=(uint)Marshal.SizeOf(typeof(DisplayDevice))};
        if(!EnumDisplayDevicesW(null,i,ref d,0)) { completed=true; break; } if((d.flags&1)!=0)attached++;
      }
      if(!CanProveEmpty(error,console,true,enumerated&&completed,monitors,GetSystemMetrics(80),attached)) return null;
      return new Snapshot {paths=new byte[0][],modes=new byte[0][],emptyFallbackError=error,emptyEvidence="Active console; input desktop readable; monitor enumeration succeeded with zero monitors; SM_CMONITORS=0; no desktop-attached display device"};
    } finally { CloseDesktop(desktop); }
  }
  static Snapshot Read(uint flags) {
    for(int attempt=0;attempt<8;attempt++) {
      uint pc,mc; int sizing=GetDisplayConfigBufferSizes(flags,out pc,out mc);
      if(sizing!=0) { Snapshot empty=EmptyIfProven(sizing); if(empty!=null)return empty; Status(sizing,"Size display topology; zero-active-display state not proven"); }
      if(pc>1024||mc>4096) throw new Exception("Unexpected display topology size");
      byte[] paths=new byte[pc*72],modes=new byte[mc*64];
      int code=QueryDisplayConfig(flags,ref pc,paths,ref mc,modes,IntPtr.Zero);
      if(code==122) continue;
      if(code!=0) { Snapshot empty=EmptyIfProven(code); if(empty!=null)return empty; Status(code,"Read display topology; zero-active-display state not proven"); }
      return new Snapshot { paths=Split(paths,pc,72), modes=Split(modes,mc,64) };
    }
    throw new Exception("Display topology changed continuously");
  }
  static string Adapter(byte[] path) {
    byte[] request=new byte[276]; Put(request,0,4); Put(request,4,276); Buffer.BlockCopy(path,0,request,8,8);
    Status(DisplayConfigGetDeviceInfo(request),"Read display adapter identity");
    return Encoding.Unicode.GetString(request,20,256).TrimEnd('\0').Replace('#','\\').ToUpperInvariant();
  }
  static byte[] SourceMode(Snapshot state,byte[] path) {
    uint index=U(path,12); if(index>=state.modes.Length || U(state.modes[index],0)!=1) throw new Exception("Missing source display mode");
    return state.modes[index];
  }
  // Validate logical modes rather than transient status flags/driver-selected mode indices.
  static void Preserved(Snapshot before,Snapshot after) {
    foreach(byte[] path in before.paths) {
      byte[] found=after.paths.SingleOrDefault(p=>Source(p)==Source(path)&&Target(p)==Target(path));
      if(found==null || (U(found,68)&1)==0) throw new Exception("An existing display path was removed");
      byte[] a=SourceMode(before,path),b=SourceMode(after,found);
      if(!a.Skip(16).Take(20).SequenceEqual(b.Skip(16).Take(20))) throw new Exception("An existing display geometry or primary position changed");
      foreach(int offset in new[]{40,44,48,52,56}) if(U(path,offset)!=U(found,offset)) throw new Exception("An existing display rotation/scaling/timing changed");
    }
  }
  static Snapshot Extend(Snapshot before,Snapshot all,byte[] candidate,int width,int height) {
    if(width<1||height<1) throw new Exception("Invalid display dimensions");
    long right=0;
    foreach(byte[] path in before.paths) { byte[] mode=SourceMode(before,path); right=Math.Max(right,(long)I(mode,28)+U(mode,16)); }
    if(right>int.MaxValue-width) throw new Exception("Display coordinates overflow");
    var modes=before.modes.Select(x=>(byte[])x.Clone()).ToList();
    var paths=before.paths.Select(x=>(byte[])x.Clone()).ToList();
    byte[] added=(byte[])candidate.Clone();
    uint targetIndex=U(added,32);
    if(targetIndex<all.modes.Length && U(all.modes[targetIndex],0)==2) { Put(added,32,(uint)modes.Count); modes.Add((byte[])all.modes[targetIndex].Clone()); }
    else Put(added,32,Invalid);
    if(U(added,32)==Invalid&&U(added,48)==0&&U(added,52)==0)Put(added,56,0);
    byte[] source=new byte[64]; Put(source,0,1); Put(source,4,U(added,8)); Buffer.BlockCopy(added,0,source,8,8);
    Put(source,16,(uint)width); Put(source,20,(uint)height); Put(source,24,4); Put(source,28,(uint)right);
    Put(added,12,(uint)modes.Count); modes.Add(source); Put(added,68,1);
    paths.Add(added); return new Snapshot {paths=paths.ToArray(),modes=modes.ToArray()};
  }
  static void Apply(Snapshot state) {
    byte[] paths=Flatten(state.paths),modes=Flatten(state.modes);
    Status(SetDisplayConfig((uint)state.paths.Length,paths,(uint)state.modes.Length,modes,0x20|0x40),"Validate display topology");
    Status(SetDisplayConfig((uint)state.paths.Length,paths,(uint)state.modes.Length,modes,0x20|0x80|0x200),"Apply and persist display topology");
  }
  static string Property(IntPtr set,ref Device device,uint property) {
    byte[] value=new byte[8192]; uint type,required;
    if(!SetupDiGetDeviceRegistryPropertyW(set,ref device,property,out type,value,(uint)value.Length,out required)) return "";
    return Encoding.Unicode.GetString(value,0,(int)required).TrimEnd('\0');
  }
  static void RejectExistingDriver() {
    Guid guid=DisplayClass; IntPtr set=SetupDiGetClassDevsW(ref guid,null,IntPtr.Zero,0);
    if(set==new IntPtr(-1)) Win(false,"Enumerate display devices");
    try { for(uint i=0;;i++) { Device d=NewDevice(); if(!SetupDiEnumDeviceInfo(set,i,ref d)) { if(Marshal.GetLastWin32Error()!=259) Win(false,"Enumerate display device"); break; }
      if(Property(set,ref d,1).Split('\0').Any(h=>h.Equals("Root\\MttVDD",StringComparison.OrdinalIgnoreCase)||h.Equals("MttVDD",StringComparison.OrdinalIgnoreCase)))
        throw new Exception("An existing Virtual Display Driver device exists; it will not be adopted, reconfigured or removed");
    }} finally { SetupDiDestroyDeviceInfoList(set); }
  }
  static void VerifyPackage(string directory) {
    string[] names={"mttvdd.cat","MttVDD.dll","MttVDD.inf","vdd_settings.xml"};
    string[] hashes={"08A0093FC9B2E32B287A6F8A77CA4DE0A31830D29FC33D2B13A918DC859468F6","C9CA837F57A98FBD43BC416A7F535A95843626E7759EAF85CF0CD7CE334DBB05","550D211FE481E74DFE3F9D724ED78BE48B3A9113405965D683D9373E8D672F5D","EDB2501D6D5DA17F66D15D4B97A6F4A3F0D8963165AC4A6A6259D95118288020"};
    for(int i=0;i<names.Length;i++) using(var sha=SHA256.Create()) using(var file=File.OpenRead(Path.Combine(directory,names[i]))) {
      if(Hex(sha.ComputeHash(file))!=hashes[i]) throw new Exception("Pinned release file mismatch: "+names[i]);
    }
  }
  static void SecureRoot() {
    string parent=Path.GetDirectoryName(Root);
    if(Directory.Exists(parent)&&(File.GetAttributes(parent)&FileAttributes.ReparsePoint)!=0) throw new Exception("CAgent data directory is a reparse point");
    Directory.CreateDirectory(Root);
    if((File.GetAttributes(Root)&FileAttributes.ReparsePoint)!=0) throw new Exception("Journal directory is a reparse point");
    var acl=new DirectorySecurity(); acl.SetAccessRuleProtection(true,false);
    foreach(string sid in new[]{"S-1-5-18","S-1-5-32-544"}) acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
    Directory.SetAccessControl(Root,acl);
  }
  static string JournalPath(string id) { return Path.Combine(Root,new Guid(id).ToString("N")+".json"); }
  static void Save(Journal journal) {
    string path=JournalPath(journal.id),temp=path+".tmp";
    using(var stream=new FileStream(temp,FileMode.Create,FileAccess.Write,FileShare.None)) { byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(journal)); stream.Write(bytes,0,bytes.Length); stream.Flush(true); }
    if(File.Exists(path)) File.Replace(temp,path,null); else File.Move(temp,path);
  }
  static Journal Load(string id) {
    Journal j=Json.Deserialize<Journal>(File.ReadAllText(JournalPath(id)));
    if(j.schema!=1||j.id!=new Guid(id).ToString("N")||j.device!=Prefix+j.id||j.before==null) throw new Exception("Invalid ownership journal");
    return j;
  }
  static void Create(Journal journal,string directory) {
    IntPtr set=DeviceSet(); Device device=NewDevice(); Guid guid=DisplayClass;
    try {
      Win(SetupDiCreateDeviceInfoW(set,journal.device,ref guid,"CAgent virtual display "+journal.id,IntPtr.Zero,0,ref device),"Create owned root device");
      byte[] hardware=Encoding.Unicode.GetBytes("Root\\MttVDD\0\0"),name=Encoding.Unicode.GetBytes("CAgent virtual display "+journal.id+"\0");
      Win(SetupDiSetDeviceRegistryPropertyW(set,ref device,1,hardware,(uint)hardware.Length),"Set pinned hardware ID");
      Win(SetupDiSetDeviceRegistryPropertyW(set,ref device,12,name,(uint)name.Length),"Set ownership name");
      InstallParams parameters=new InstallParams {size=(uint)Marshal.SizeOf(typeof(InstallParams))};
      Win(SetupDiGetDeviceInstallParamsW(set,ref device,ref parameters),"Read device install parameters");
      parameters.flags|=0x10000|0x800000; parameters.driverPath=Path.GetFullPath(Path.Combine(directory,"MttVDD.inf"));
      if(parameters.driverPath.Length>=260) throw new Exception("Driver package path too long");
      Win(SetupDiSetDeviceInstallParamsW(set,ref device,ref parameters),"Select single pinned INF");
      Win(SetupDiBuildDriverInfoList(set,ref device,2),"Build compatible driver list");
      Driver driver=new Driver {size=(uint)Marshal.SizeOf(typeof(Driver))};
      Win(SetupDiEnumDriverInfoW(set,ref device,2,0,ref driver),"Find pinned compatible driver");
      Win(SetupDiSetSelectedDriverW(set,ref device,ref driver),"Select pinned driver");
      journal.phase="registering"; Save(journal);
      Win(SetupDiCallClassInstaller(0x19,set,ref device),"Register owned root device");
      journal.phase="installing"; Save(journal);
      Win(SetupDiCallClassInstaller(2,set,ref device),"Install signed display driver");
      Win(SetupDiGetDeviceInstallParamsW(set,ref device,ref parameters),"Read installation result");
      if((parameters.flags&(0x80|0x100))!=0) throw new Exception("Driver requested a reboot; no automatic reboot will occur");
    } finally { SetupDiDestroyDeviceInfoList(set); }
  }
  static void RemoveOwned(Journal journal) {
    IntPtr set=DeviceSet(); Device device=NewDevice();
    try {
      if(!SetupDiOpenDeviceInfoW(set,journal.device,IntPtr.Zero,0,ref device)) { if(Marshal.GetLastWin32Error()==-536870389) return; Win(false,"Open owned root device"); }
      if(Property(set,ref device,12)!="CAgent virtual display "+journal.id || Property(set,ref device,1)!="Root\\MttVDD") throw new Exception("Device ownership mismatch; refusing removal");
      RemoveParams parameters=new RemoveParams {headerSize=8,installFunction=5,scope=1,profile=0};
      Win(SetupDiSetClassInstallParamsW(set,ref device,ref parameters,(uint)Marshal.SizeOf(typeof(RemoveParams))),"Scope removal to the owned device in all profiles");
      Win(SetupDiCallClassInstaller(5,set,ref device),"Remove owned root device");
    } finally { SetupDiDestroyDeviceInfoList(set); }
  }
  static void Rollback(Journal journal) {
    var errors=new List<string>();
    try { RemoveOwned(journal); } catch(Exception e) { errors.Add(e.Message); }
    try {
      if(journal.before.paths.Length>0) { Apply(journal.before); Preserved(journal.before,Read(2)); }
      else if(Read(2).paths.Any(p=>Adapter(p).Contains(journal.device.ToUpperInvariant()))) throw new Exception("Owned display remains active after rollback");
    } catch(Exception e) { errors.Add(e.Message); }
    journal.phase=errors.Count==0?"removed":"recovery-required"; journal.error=String.Join("; ",errors); Save(journal);
    if(errors.Count>0) throw new Exception("Rollback incomplete: "+journal.error);
  }
  static void Uninstall(Journal journal) {
    // Normal uninstall preserves intervening user changes and newly attached physical displays.
    Snapshot current=Read(2);
    var keep=current.paths.Where(p=>!Adapter(p).Contains(journal.device.ToUpperInvariant())).ToArray();
    Snapshot desired=new Snapshot {paths=keep,modes=current.modes};
    journal.phase="removing"; Save(journal);
    RemoveOwned(journal);
    if(keep.Length>0) { Apply(desired); Preserved(desired,Read(2)); }
    else if(Read(2).paths.Any(p=>Adapter(p).Contains(journal.device.ToUpperInvariant()))) throw new Exception("Owned target remains active after removal");
    journal.phase="removed"; Save(journal);
  }
  public class Preflight { public bool elevated,consoleSession,topologyAvailable,executable; public uint sessionId,consoleSessionId; public string reason; }
  static Preflight Inspect() {
    var r=new Preflight();
    r.elevated=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    uint session; r.consoleSessionId=WTSGetActiveConsoleSessionId();
    r.consoleSession=ProcessIdToSessionId(GetCurrentProcessId(),out session)&&session!=0&&session==r.consoleSessionId; r.sessionId=session;
    if(!r.elevated) r.reason="ADMINISTRATOR_REQUIRED";
    else if(!r.consoleSession) r.reason="CONSOLE_SESSION_REQUIRED";
    else { IntPtr desktop=OpenInputDesktop(0,false,1); if(desktop==IntPtr.Zero) r.reason="INPUT_DESKTOP_UNAVAILABLE";
      else { CloseDesktop(desktop); try { Read(2); r.topologyAvailable=true; } catch(Exception) { r.reason="TOPOLOGY_UNAVAILABLE"; } }
    }
    r.executable=r.elevated&&r.consoleSession&&r.topologyAvailable;
    if(r.executable)r.reason="READY_NOT_FRAME_VERIFIED";
    return r;
  }
  static object Install(string package,int width,int height) {
    var readiness=Inspect(); if(!readiness.executable)throw new Exception(readiness.reason);
    VerifyPackage(package); RejectExistingDriver();
    // Do not overwrite a user's global VDD configuration. The upstream default is used.
    if(Directory.Exists(@"C:\VirtualDisplayDriver") || Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\MikeTheTech\VirtualDisplayDriver","VDDPATH",null)!=null)
      throw new Exception("Existing global Virtual Display Driver configuration must be reviewed manually");
    Journal journal=new Journal {id=Guid.NewGuid().ToString("N"),phase="prepared",before=Read(2)}; journal.device=Prefix+journal.id; Save(journal);
    string staged=Path.Combine(Root,journal.id+"-driver"); Directory.CreateDirectory(staged);
    foreach(string name in new[]{"MttVDD.inf","MttVDD.dll","mttvdd.cat","vdd_settings.xml"}) File.Copy(Path.Combine(package,name),Path.Combine(staged,name),false);
    VerifyPackage(staged);
    try {
      Create(journal,staged); journal.phase="waiting-for-display"; Save(journal);
      byte[] candidate=null; Snapshot all=null;
      for(int i=0;i<60;i++) {
        all=Read(1); var paths=all.paths.Where(p=>Adapter(p).Contains(journal.device.ToUpperInvariant())).GroupBy(Target).ToArray();
        if(paths.Length>1) throw new Exception("Owned adapter unexpectedly exposes multiple targets");
        if(paths.Length==1) { candidate=paths[0].FirstOrDefault(p=>U(p,60)!=0); if(candidate!=null) break; }
        Thread.Sleep(500);
      }
      if(candidate==null) throw new Exception("Owned display target did not become available");
      journal.phase="applying-topology"; Save(journal);
      Snapshot desired=Extend(journal.before,all,candidate,width,height); Apply(desired);
      Snapshot actual=Read(2); Preserved(journal.before,actual);
      if(actual.paths.Length!=journal.before.paths.Length+1 || !actual.paths.Any(p=>Target(p)==Target(candidate))) throw new Exception("Virtual secondary display was not activated exclusively");
      journal.phase="active"; Save(journal); return journal;
    } catch(Exception e) {
      journal.error=e.Message; Save(journal);
      try { Rollback(journal); } catch(Exception recovery) { throw new Exception(e.Message+"; "+recovery.Message+"; task="+journal.id); }
      throw new Exception(e.Message+"; rolled back; task="+journal.id);
    }
  }
  static void SelfTest() {
    if(Marshal.SizeOf(typeof(Device))!=32||Marshal.SizeOf(typeof(InstallParams))!=584||Marshal.SizeOf(typeof(Driver))!=1568||Marshal.SizeOf(typeof(PathInfo))!=72||Marshal.SizeOf(typeof(ModeInfo))!=64||Marshal.OffsetOf(typeof(PathInfo),"target").ToInt32()!=20||Marshal.OffsetOf(typeof(PathInfo),"flags").ToInt32()!=68||Marshal.OffsetOf(typeof(PathTarget),"available").ToInt32()!=40||Marshal.OffsetOf(typeof(ModeInfo),"x").ToInt32()!=28)throw new Exception("Unexpected Windows x64 ABI layout");
    if(!CanProveEmpty(31,true,true,true,0,0,0)||!CanProveEmpty(50,true,true,true,0,0,0))throw new Exception("Proven empty headless baseline rejected");
    if(CanProveEmpty(5,true,true,true,0,0,0)||CanProveEmpty(87,true,true,true,0,0,0)||CanProveEmpty(31,false,true,true,0,0,0)||CanProveEmpty(31,true,false,true,0,0,0)||CanProveEmpty(31,true,true,false,0,0,0)||CanProveEmpty(31,true,true,true,1,0,0)||CanProveEmpty(31,true,true,true,0,1,0)||CanProveEmpty(31,true,true,true,0,0,1))throw new Exception("Unproven headless state accepted");
    byte[] p=new byte[72],m=new byte[64]; Put(p,12,0); Put(p,68,1); Put(m,0,1); Put(m,16,1920); Put(m,20,1080); Put(m,24,4);
    Snapshot before=new Snapshot { paths=new[]{p},modes=new[]{m} }; byte[] candidate=new byte[72]; Put(candidate,0,77); Put(candidate,20,77); Put(candidate,32,Invalid);
    Snapshot next=Extend(before,new Snapshot {paths=new byte[0][],modes=new byte[0][]},candidate,1280,720); Preserved(before,next);
    if(I(next.modes[1],28)!=1920||U(next.paths[1],12)!=1||before.paths.Length!=1) throw new Exception("Secondary extension failed");
    next.modes[0][28]=1; bool rejected=false; try { Preserved(before,next); } catch { rejected=true; } if(!rejected) throw new Exception("Primary move was accepted");
    next=Extend(before,new Snapshot {paths=new byte[0][],modes=new byte[0][]},candidate,1280,720); next.paths[0][40]=2;
    rejected=false; try { Preserved(before,next); } catch { rejected=true; } if(!rejected) throw new Exception("Rotation change was accepted");
    Snapshot empty=new Snapshot {paths=new byte[0][],modes=new byte[0][]}; next=Extend(empty,empty,candidate,1920,1080);
    if(I(next.modes[0],28)!=0||next.paths.Length!=1) throw new Exception("Headless topology construction failed");
    rejected=false; try { Preserved(before,empty); } catch { rejected=true; } if(!rejected) throw new Exception("Existing display removal was accepted");
    Console.WriteLine("{\"passed\":true,\"cases\":[\"x64-abi\",\"proven-empty-only\",\"reject-access-denied-as-empty\",\"append-secondary\",\"original-immutable\",\"reject-primary-move\",\"reject-rotation-change\",\"headless-layout\",\"reject-existing-display-removal\"]}");
  }
  static int Main(string[] args) {
    try {
      if(args.Length==1&&args[0]=="self-test") { SelfTest(); return 0; }
      if(!Environment.Is64BitProcess) throw new Exception("Windows x64 helper required");
      if(args.Length==1&&args[0]=="preflight") { Console.WriteLine(Json.Serialize(Inspect())); return 0; }
      if(args.Length==1&&args[0]=="probe") { Snapshot state=Read(2); Console.WriteLine(Json.Serialize(new {activePaths=state.paths.Length,topology=state,mutated=false})); return 0; }
      if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new Exception("ADMINISTRATOR_REQUIRED: 请在目标机器以管理员身份运行 CAgent 后查看虚拟显示安装记录或执行安装；本次未读取记录、未安装驱动，不会自动提权");
      if(args.Length==1&&args[0]=="list") { Console.WriteLine(Json.Serialize(Directory.Exists(Root)?Directory.GetFiles(Root,"*.json").Select(path=>Load(Path.GetFileNameWithoutExtension(path))).Select(j=>new {id=j.id,phase=j.phase,error=j.error,device=j.device}).ToArray():new object[0])); return 0; }
      if(args.Length==2&&args[0]=="status") { Console.WriteLine(Json.Serialize(Load(args[1]))); return 0; }
      SecureRoot();
      using(var mutex=new Mutex(false,@"Global\CAgent.VirtualDisplay.Install")) {
        bool entered=false; try { try { entered=mutex.WaitOne(0); } catch(AbandonedMutexException) { entered=true; }
          if(!entered) throw new Exception("Virtual display operation already running");
          object result;
          if(args.Length==4&&args[0]=="install") result=Install(args[1],Int32.Parse(args[2]),Int32.Parse(args[3]));
          else if(args.Length==2&&args[0]=="remove") { Journal j=Load(args[1]); Uninstall(j); result=j; }
          else if(args.Length==2&&args[0]=="recover") { Journal j=Load(args[1]); Rollback(j); result=j; }
          else if(args.Length==2&&args[0]=="status") result=Load(args[1]);
          else if(args.Length==1&&args[0]=="list") result=Directory.GetFiles(Root,"*.json").Select(path=>Load(Path.GetFileNameWithoutExtension(path))).Select(j=>new {id=j.id,phase=j.phase,error=j.error,device=j.device}).ToArray();
          else throw new Exception("Usage: probe | self-test | install <pinned-directory> <width> <height> | status <task-id> | remove <task-id> | recover <task-id>");
          Console.WriteLine(Json.Serialize(result)); return 0;
        } finally { if(entered) mutex.ReleaseMutex(); }
      }
    } catch(Exception e) { Console.WriteLine(Json.Serialize(new {error=e.Message,success=false})); return 1; }
  }
}
