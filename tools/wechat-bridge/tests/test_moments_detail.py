import unittest
from cshell_wechat.moments_detail import parse_detail,detail_page,post_id
from cshell_wechat.contracts import BridgeError

XML='''<SnsDataItem><TimelineObject><id>18446744073709551615</id><username>test</username><contentDesc>正文</contentDesc></TimelineObject><LocalExtraInfo><like_user_list><user_comment><username>friend</username><comment_id>1</comment_id></user_comment></like_user_list><comment_user_list><user_comment><comment_id>2</comment_id><comment_64id>9007199254740993</comment_64id><ref_comment_id>1</ref_comment_id><ref_comment_64id>9007199254740992</ref_comment_64id><content>回复 &amp; 测试</content><is_local_added>1</is_local_added><b_deleted>0</b_deleted></user_comment></comment_user_list></LocalExtraInfo></SnsDataItem>'''
PID='18446744073709551615'
class DetailTests(unittest.TestCase):
    def test_namespaces_and_pending_remain_distinct(self):
        post,items=parse_detail(XML,PID)
        self.assertEqual(post['text'],'正文');self.assertEqual(items[0]['kind'],'like')
        reply=items[1];self.assertEqual(reply['comment64Id'],'9007199254740993')
        self.assertEqual(reply['replyToCommentId'],'1');self.assertEqual(reply['replyToComment64Id'],'9007199254740992')
        self.assertTrue(reply['locallyAdded']);self.assertFalse(reply['deleted']);self.assertEqual(reply['text'],'回复 & 测试')
    def test_cursor_rejects_changed_post_and_account(self):
        first=detail_page(XML,'account-a',{'postId':PID,'limit':1})
        self.assertTrue(first['hasMore']);self.assertFalse(first['complete'])
        args={'postId':PID,'limit':1,'cursor':first['nextCursor']}
        second=detail_page(XML,'account-a',args);self.assertEqual(second['items'][0]['kind'],'comment');self.assertFalse(second['hasMore'])
        for xml,scope in [(XML,'account-b'),(XML.replace('正文','改变'),'account-a')]:
            with self.assertRaises(BridgeError):detail_page(xml,scope,args)
    def test_reject_invalid_or_mismatched_xml_and_ids(self):
        for value in ['0','18446744073709551616','1 OR 1=1',None]:
            with self.assertRaises(BridgeError):post_id(value)
        for xml in [XML.replace(PID,'3'),'<!DOCTYPE x>'+XML,'<x>'*26+'</x>'*26,'x'*24501]:
            with self.assertRaises(BridgeError):parse_detail(xml,PID)
        with self.assertRaises(BridgeError):detail_page(XML,'a',{'postId':PID,'limit':True})
if __name__=='__main__':unittest.main()
