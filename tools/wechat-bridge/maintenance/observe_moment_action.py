"""Bounded developer observation of one outgoing Moments interaction.

No mutations. Outputs only the action group and comments, never BaseRequest.
Uses the same pinned process/cleanup lifecycle as observe_file_send.py.
"""
import pathlib
from observe_file_send import main,SOURCE

SOURCE=SOURCE.replace("const strings=[];for(let i=0;i<storage.add(16).readInt();i++){", "const strings=[];for(let i=0;i<10;i++){")
SOURCE=SOURCE.replace('storage.add(2048+i*272)','storage.add(512+i*520)')
SOURCE=SOURCE.replace('offset:p.readU32(),value:p.add(8).readUtf8String(p.add(4).readU32())','slot:i,value:p.add(4).readUtf8String(p.readU32())')
SOURCE=SOURCE.replace('storage.add(64).readByteArray(0x758)','storage.add(64).readByteArray(448)')

if __name__=='__main__':main(0x3088550,'one-outgoing-sns-action',SOURCE,pathlib.Path(__file__).with_suffix('.c'))
