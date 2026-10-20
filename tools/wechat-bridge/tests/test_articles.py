import unittest
from cshell_wechat.articles import article_url,parse_article

class ArticleTests(unittest.TestCase):
    def test_canonical_identity(self):
        u='https://mp.weixin.qq.com/s?__biz=abc&mid=12&idx=1&sn='+'a'*32+'&sharer_shareinfo=private#rd'
        self.assertNotIn('private',article_url(u))
        self.assertNotIn('#',article_url(u))
    def test_reject_targets_and_ambiguity(self):
        for u in ('http://mp.weixin.qq.com/s/a','https://mp.weixin.qq.com.evil.test/s/a','https://user@mp.weixin.qq.com/s/a','https://mp.weixin.qq.com:123/s/a','https://mp.weixin.qq.com/mp/profile','https://mp.weixin.qq.com/s?mid=1&mid=2','https://127.0.0.1/s/a'):
            with self.subTest(u=u),self.assertRaises(Exception):article_url(u)
    def test_body_not_page_chrome_or_script(self):
        h='<h1 id="activity-name">标题</h1><a id="js_name">作者</a><div id="js_content"><p>正文 &amp; 内容</p><script>secret</script><p>第二段</p></div><footer>留言</footer>'
        r=parse_article(h,'https://mp.weixin.qq.com/s/a')
        self.assertEqual(r['content'],'正文 & 内容\n第二段')
        self.assertEqual(r['title'],'标题');self.assertEqual(r['author'],'作者')
        self.assertEqual(r['commentCapability'],'unknown')
    def test_verification_and_deleted(self):
        for html,status in [('<h2>环境异常</h2><p>完成验证后即可继续访问</p>','verification_required'),('<p>该内容已被发布者删除</p>','unavailable'),('<h1>Welcome</h1>','unsupported_page')]:
            r=parse_article(html,'https://mp.weixin.qq.com/s/a');self.assertEqual(r['status'],status);self.assertIsNone(r['content'])

if __name__=='__main__':unittest.main()
