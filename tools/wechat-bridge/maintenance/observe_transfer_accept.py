"""Observe a user-performed receipt. Never calls the payment function."""
from pathlib import Path
from observe_file_send import main, SOURCE

SOURCE = SOURCE.replace(
    "const strings=[];for(let i=0;i<storage.add(16).readInt();i++){",
    "return {callerRva:ptr(storage.add(64).readU64().toString()).sub(base).toString()};const strings=[];for(let i=0;i<storage.add(16).readInt();i++){")

if __name__ == '__main__':
    main(0x5392cc0, 'user-performed-test-transfer-receipt/callsite-only', SOURCE, Path(__file__).with_suffix('.c'))
