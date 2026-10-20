"""Public article reader. No cookie extraction or CAPTCHA bypass."""
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from .contracts import require, BridgeError

MAX_BYTES = 4 * 1024 * 1024

def article_url(value):
    require(isinstance(value,str) and len(value)<=8192 and not any(ord(c)<33 for c in value), 'INVALID_ARTICLE_URL','Expected a WeChat article URL')
    try:
        p=urlsplit(value)
        valid=p.scheme=='https' and p.hostname=='mp.weixin.qq.com' and not p.username and not p.password and p.port in (None,443)
    except ValueError: valid=False
    require(valid,'INVALID_ARTICLE_URL','Only https://mp.weixin.qq.com articles are supported')
    require(p.path=='/s' or re.fullmatch(r'/s/[A-Za-z0-9_-]+',p.path),'INVALID_ARTICLE_URL','Expected an article path')
    query=parse_qsl(p.query,keep_blank_values=True)
    keys=[k for k,v in query if k in ('__biz','mid','idx','sn')]
    require(len(keys)==len(set(keys)),'INVALID_ARTICLE_URL','Duplicate article identity')
    identity={k:v for k,v in query if k in keys}
    if p.path=='/s':
        require(all(identity.get(k) for k in ('__biz','mid','idx','sn')),'INVALID_ARTICLE_URL','Missing article identity')
        require(identity['mid'].isdigit() and identity['idx'].isdigit() and re.fullmatch('[0-9a-fA-F]{32}',identity['sn']),'INVALID_ARTICLE_URL','Malformed article identity')
    return urlunsplit(('https','mp.weixin.qq.com',p.path,urlencode(identity),''))

class ArticleHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack=[];self.content=[];self.title=[];self.author=[];self.visible=[];self.has_body=False
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs); parent=self.stack[-1][1] if self.stack else None
        zone={'js_content':'body','activity-name':'title','js_name':'author'}.get(attrs.get('id'),parent)
        if tag in ('script','style'):zone='ignore'
        if attrs.get('id')=='js_content':self.has_body=True
        if tag in ('p','div','section','br','li') and zone=='body':self.content.append('\n')
        if tag not in ('br','img','meta','link','input','hr','source','wbr'):self.stack.append((tag,zone))
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:
                self.stack=self.stack[:i];break
    def handle_data(self,data):
        zone=self.stack[-1][1] if self.stack else None
        if zone=='ignore':return
        self.visible.append(data)
        if zone=='body':self.content.append(data)
        elif zone=='title':self.title.append(data)
        elif zone=='author':self.author.append(data)

def parse_article(html,url):
    require(len(html.encode('utf-8'))<=MAX_BYTES,'ARTICLE_TOO_LARGE','Article exceeds read limit')
    p=ArticleHTML();p.feed(html)
    visible=' '.join(p.visible)
    if not p.has_body:
        if '环境异常' in visible or '完成验证后' in visible:
            return {'status':'verification_required','url':url,'content':None,'complete':False}
        if any(t in visible for t in ('该内容已被发布者删除','此内容因违规无法查看','内容已删除')):
            return {'status':'unavailable','url':url,'content':None,'complete':False}
        return {'status':'unsupported_page','url':url,'content':None,'complete':False}
    body='\n'.join(line.strip() for line in ''.join(p.content).splitlines() if line.strip())
    require(bool(body),'ARTICLE_EMPTY','Article body was empty')
    return {'status':'read','url':url,'title':''.join(p.title).strip(),'author':''.join(p.author).strip(),'content':body,'complete':True,'coverage':'HTML text only; images, audio, video and comments are not included','commentCapability':'unknown'}

class ArticleRedirect(HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        try: url=article_url(newurl)
        except BridgeError: raise BridgeError('ARTICLE_REDIRECT_REQUIRES_INTERACTION','Article redirected outside supported article paths')
        return super().redirect_request(req,fp,code,msg,headers,url)

def read_article(params):
    require(isinstance(params,dict) and set(params)=={'url'},'INVALID_REQUEST','Only url is supported')
    url=article_url(params['url'])
    request=Request(url,headers={'User-Agent':'CShell-ArticleReader/0.1','Accept':'text/html'})
    try:
        with build_opener(ArticleRedirect()).open(request,timeout=20) as response:
            require(response.headers.get_content_type()=='text/html','ARTICLE_CONTENT_TYPE','Expected HTML')
            raw=response.read(MAX_BYTES+1)
            require(len(raw)<=MAX_BYTES,'ARTICLE_TOO_LARGE','Article exceeds read limit')
    except BridgeError as error:
        if error.code=='ARTICLE_REDIRECT_REQUIRES_INTERACTION':
            return {'status':'interaction_required','url':url,'content':None,'complete':False,'reason':'Redirect leaves supported article paths; open in WeChat to inspect'}
        raise
    return parse_article(raw.decode('utf-8','replace'),url)
