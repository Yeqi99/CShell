"""Account balances from provider snapshots, independent of CShell entitlements."""
from collections import Counter
from decimal import Decimal
import json


def summarize_inventory(rows, now, costs=None):
    costs=costs or {}
    providers = Counter(row[0] for row in rows)
    amounts, excluded = {}, Counter()
    wallets = {}
    for provider, key, group, conversion, checked, payload in rows:
        if not group and providers[provider] > 1:
            excluded['unknownWallet'] += 1
            continue
        wallet = (provider, group or key)
        if wallet in wallets:
            excluded['duplicateWallet'] += 1
            if (checked or 0) <= (wallets[wallet][1] or 0):
                continue
        wallets[wallet] = conversion, checked, payload, costs.get(key)

    provider_values = {}
    remaining_cny, total_cny = Decimal(0), Decimal(0)
    priced_remaining, priced_total = 0, 0
    for (provider, _), (conversion, checked, payload, monthly) in wallets.items():
        if not checked or now - checked > 86400:
            excluded['staleOrMissing'] += 1
            continue
        for measure in json.loads(payload):
            if monthly and (provider,measure.get('unit')) in (('opencode-go','本月'),('qwen-plan','per1Month')):
                percent=Decimal(str(measure['percent']))
                if 0<=percent<=100:measure=dict(unit='CNY',remaining=Decimal(monthly)*(100-percent)/100,total=monthly)
            if 'remaining' not in measure:
                excluded['windowOnly'] += 1
                continue
            unit = measure['unit']
            item = amounts.setdefault((provider, unit), dict(remaining=Decimal(0), total=Decimal(0), knownTotal=True))
            remaining = Decimal(str(measure['remaining']))
            item['remaining'] += remaining
            if 'total' in measure:
                item['total'] += Decimal(str(measure['total']))
            else:
                item['knownTotal'] = False
            rate = Decimal(1) if unit == 'CNY' else None
            if conversion and unit in ('USD', 'credits'):
                rate = Decimal(conversion)
            if not conversion and provider=='mimo-plan' and unit=='credits' and str(measure.get('total'))=='4100000000':
                rate=Decimal(39)/Decimal(4100000000)
            if rate is None:
                excluded['unknownCost'] += 1
            else:
                provider_values[provider]=provider_values.get(provider,Decimal(0))+remaining*rate
                remaining_cny += remaining * rate
                priced_remaining += 1
                if "total" in measure:
                    total_cny += Decimal(str(measure["total"])) * rate
                    priced_total += 1
    units = [dict(provider=p, unit=u, remaining=str(i['remaining']),
                  total=str(i['total']) if i['knownTotal'] else None)
             for (p, u), i in sorted(amounts.items())]
    return dict(knownRemainingYuan=str(remaining_cny) if priced_remaining else None,
                knownTotalYuan=str(total_cny) if priced_total else None,
                byProvider={p:str(v) for p,v in provider_values.items()},units=units, excluded=dict(excluded))
