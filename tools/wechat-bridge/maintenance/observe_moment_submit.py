"""Observe one queued comment on the explicitly authorized AI test Moment."""
import pathlib
from observe_file_send import main,SOURCE
SOURCE=SOURCE.replace('storage.add(64).readByteArray(0x758)','storage.add(64).readByteArray(24)')
if __name__=='__main__':main(0x3062d80,'own-test-post-queued-comment',SOURCE,pathlib.Path(__file__).with_suffix('.c'))
