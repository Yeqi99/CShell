import unittest,tempfile,pathlib
from cshell_wechat.moments import parse_post,prepare,result_page,record_changes
from cshell_wechat.contracts import BridgeError

XML='<SnsDataItem><TimelineObject><username>test</username><createTime>42</createTime><contentDesc>A &amp; B</contentDesc></TimelineObject><LocalExtraInfo/></SnsDataItem>'

class MomentsTests(unittest.TestCase):
    def test_current_wrapper_and_entities(self):
        item=parse_post('9223372036854775807','',XML)
        self.assertEqual(item['text'],'A & B');self.assertEqual(item['authorId'],'test')
        self.assertEqual(item['postId'],'9223372036854775807')

    def test_reject_xml_and_depth(self):
        self.assertEqual(parse_post('1','', '<!DOCTYPE a [<!ENTITY x "x">]><a/>')['contentStatus'],'rejected-xml')
        self.assertEqual(parse_post('1','', '<a>'*25+'</a>'*25)['contentStatus'],'xml-limit')
        self.assertEqual(parse_post('1','',None)['contentStatus'],'oversized-or-null')

    def test_cursor_account_and_incomplete(self):
        raw={'state':[0,2,0,101],'cleanup':{'unloaded':True,'codeRestored':True},'databasePath':'account-a','rows':[['2','',XML],['1','',XML]]}
        page=result_page(raw,{'limit':1});self.assertTrue(page['hasMore'])
        raw['databasePath']='account-b'
        with self.assertRaises(BridgeError):result_page(raw,{'limit':1,'cursor':page['nextCursor']})
        raw['state'][3]=9
        with self.assertRaises(BridgeError):result_page(raw,{'limit':1})

    def test_incremental_survives_reopen_and_tracks_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            path=pathlib.Path(d);page={'accountScope':'a','items':[parse_post('1','',XML)]}
            self.assertEqual(record_changes(path,page)['changes'][0]['kind'],'observed')
            self.assertEqual(record_changes(path,page)['changes'],[])
            page['items']=[parse_post('1','',XML.replace('<LocalExtraInfo/>','<LocalExtraInfo><like>1</like></LocalExtraInfo>'))]
            self.assertEqual(record_changes(path,page)['changes'][0]['kind'],'updated')
            page['accountScope']='b'
            self.assertEqual(record_changes(path,page)['changes'][0]['kind'],'observed')

    def test_limits_and_cursor(self):
        for params in ({'limit':True},{'limit':6},{'cursor':'garbage'}):
            with self.assertRaises(BridgeError):prepare(params)

if __name__=='__main__':unittest.main()
