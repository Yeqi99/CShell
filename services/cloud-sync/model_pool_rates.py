"""DeepSeek CNY per million tokens, stored as integer micro-yuan."""
from datetime import datetime, timedelta, timezone


BEIJING = timezone(timedelta(hours=8))
PEAK = {
    "deepseek-flash": (2_000_000, 40_000, 8_000_000),
    "deepseek-v4-flash": (2_000_000, 40_000, 8_000_000),
    "deepseek-v4-pro": (9_000_000, 300_000, 27_000_000),
}
# Annual State Council holiday notices. Weekend make-up workdays remain off-peak.
HOLIDAYS = {
    2026: ((101, 103), (215, 223), (404, 406), (501, 505),
           (619, 621), (925, 927), (1001, 1007)),
    2027: ((101, 103), (205, 213), (403, 405), (501, 505),
           (609, 609), (915, 915), (1001, 1007)),
}


def effective_prices(provider, model, prices, at):
    if provider != "deepseek" or tuple(prices) != PEAK.get(model):
        return prices
    local = datetime.fromtimestamp(at, BEIJING)
    day = local.month * 100 + local.day
    calendar = HOLIDAYS.get(local.year)
    if (calendar is not None and local.weekday() < 5
            and (9 <= local.hour < 12 or 14 <= local.hour < 18)
            and not any(start <= day <= end for start, end in calendar)):
        return prices
    # If next year's calendar is missing, never bill a member peak by assumption.
    return tuple(rate // 2 for rate in prices)
