import os
import tempfile
import unittest
from server import Service
from metering import Metering


class MeteringTests(unittest.TestCase):
    def test_retries_out_of_order_and_restart_do_not_double_count(self):
        with tempfile.TemporaryDirectory() as d:
            service=Service(os.path.join(d,'test.db'),b'x'*32,lambda *a:None)
            with service.db() as db:
                db.execute('INSERT INTO accounts VALUES(?,?)',('a','a@example.com'))
            meter=Metering(service)
            meter.record('a','s','mcp',100,200,0)
            meter.record('a','s','mcp',100,200,0)
            meter.record('a','s','mcp',50,150,0)
            Metering(service).record('a','s','mcp',120,240,0)
            self.assertEqual(meter.summary('a')[0]['egressBytes'],240)
            self.assertEqual(meter.summary('a')[0]['ingressBytes'],120)
            with self.assertRaises(ValueError):meter.record('a','s','relay',120,240,0)
            with self.assertRaises(ValueError):meter.record('unknown','s','relay',1,1,0)
            with self.assertRaises(ValueError):meter.record('a','s','mcp',True,1,0)
            meter.record('a','s','mcp',3,4,2678400)
            self.assertEqual(len(meter.summary('a')),2)

if __name__=='__main__':unittest.main()
