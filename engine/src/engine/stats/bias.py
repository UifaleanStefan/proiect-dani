"""Daily bias from EMA(200) on daily close + slope check."""

from __future__ import annotations

import pandas as pd

from .. import config


def annotate_daily_bias(df: pd.DataFrame) -> pd.DataFrame:
    """Add a 'daily_bias' column: 'positive' / 'negative' / 'neutral' for each candle."""
    out = df.copy()

    # Resample to daily bars
    daily = df.resample("1D").agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
    ).dropna()

    if len(daily) < config.BIAS_EMA_PERIOD + config.BIAS_SLOPE_LOOKBACK_DAYS:
        # Not enough history → all neutral
        out["daily_bias"] = "neutral"
        return out

    ema = daily["close"].ewm(span=config.BIAS_EMA_PERIOD, adjust=False).mean()
    slope = ema.diff(config.BIAS_SLOPE_LOOKBACK_DAYS)

    bias_per_day = pd.Series(index=daily.index, dtype=object)
    bias_per_day[:] = "neutral"
    bias_per_day[(daily["close"] > ema) & (slope > 0)] = "positive"
    bias_per_day[(daily["close"] < ema) & (slope < 0)] = "negative"

    # Map daily bias back to per-minute candles
    bias_minute = bias_per_day.reindex(df.index.normalize().unique(), method="ffill")
    out["daily_bias"] = "neutral"
    for d, b in bias_minute.items():
        if pd.isna(b):
            continue
        mask = (out.index >= d) & (out.index < d + pd.Timedelta(days=1))
        out.loc[mask, "daily_bias"] = b
    return out


def lookup(df: pd.DataFrame, entry_time: pd.Timestamp) -> str:
    """Return the daily_bias label for the given entry time."""
    if "daily_bias" not in df.columns:
        return "neutral"
    try:
        return str(df.loc[entry_time, "daily_bias"])
    except KeyError:
        # If exact timestamp not found, look up nearest
        idx = df.index.get_indexer([entry_time], method="nearest")[0]
        return str(df["daily_bias"].iloc[idx])
