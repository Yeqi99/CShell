"""Offline payload decoder. No media download, XML execution, or server protocol claims."""
import re
import xml.etree.ElementTree as ET
from .contracts import require, normalize

def decode(params):
    raw=params.get('message')
    require(isinstance(raw,dict),'INVALID_MESSAGE','message must be an object')
    for key in ('from','to','member','text'):
        require(isinstance(raw.get(key,''),str),'INVALID_FIELD',key+' must be a string')
    require(len(raw.get('text','').encode('utf8'))<=65536,'PAYLOAD_LIMIT','Payload exceeds 64 KiB')
    result=normalize(raw);content=raw.get('text','');result['format']='text'
    if result['conversationType']=='group':
        match=re.match(r'^(wxid_[A-Za-z0-9_]{3,64}):\r?\n',content)
        if match:
            result['senderId']=match.group(1);content=content[match.end():];result['text']=content
            result['senderSource']='body-prefix'
    if not content.lstrip().startswith('<'):
        return result
    require(not re.search(r'<!\s*(?:DOCTYPE|ENTITY)',content,re.I),'UNSAFE_XML','DTD and entity declarations are not accepted')
    try:root=ET.fromstring(content)
    except ET.ParseError:
        result['format']='unparsed';result['parseWarning']='Malformed XML preserved without interpretation';return result
    result['format']='xml';result['xmlRoot']=root.tag
    app=root if root.tag=='appmsg' else root.find('appmsg')
    if app is not None:
        result['appMessage']={k:app.findtext(k) for k in ('type','title','des','url') if app.find(k) is not None}
        attachment=app.find('appattach')
        if attachment is not None:
            result['attachmentMetadata']={k:attachment.findtext(k) for k in ('totallen','fileext') if attachment.find(k) is not None}
        reference=app.find('refermsg')
        if reference is not None:
            result['reference']={k:reference.findtext(k) for k in ('type','svrid','fromusr','chatusr','displayname','content') if reference.find(k) is not None}
    media=[]
    for tag in ('img','voicemsg','videomsg','emoji','location'):
        node=root if root.tag==tag else root.find(tag)
        if node is not None:
            # Deliberately exclude embedded keys and CDN credentials.
            safe=('length','voicelength','playlength','width','height','md5','label','poiname','x','y')
            media.append({'kind':tag,'metadata':{k:v for k,v in node.attrib.items() if k in safe}})
    if media:result['media']=media
    result['liveFormatVerified']=False
    return result
