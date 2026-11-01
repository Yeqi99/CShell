/** Bound each native text input without splitting a UTF-16 surrogate pair. */
export function desktopTextChunks(text:string):string[]{
  if(text.includes('\0'))throw Error('粘贴内容含不支持的空字符');
  if(text.length>2_000_000)throw Error('粘贴内容超过 2 MB，请使用文件传输');
  const chunks:string[]=[];
  for(let offset=0;offset<text.length;){let end=Math.min(offset+512,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;chunks.push(text.slice(offset,end));offset=end;}
  return chunks;
}
