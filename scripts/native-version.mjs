export function nativeVersionSource(version) {
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version)||version.split('.').some(n=>Number(n)>65535))
    throw Error('Invalid native file version');
  return `using System.Reflection;\n[assembly: AssemblyTitle("CAgent")]\n[assembly: AssemblyProduct("CAgent")]\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n[assembly: AssemblyInformationalVersion("${version}")]\n`;
}
