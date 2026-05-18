"""Load and normalize the MetaTrader-style M1 TSV into a clean DataFrame.

Input:
    Tab-separated file with columns:
    <DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>

Output:
    pd.DataFrame indexed by tz-aware DatetimeIndex (Europe/Bucharest)
    with columns: open, high, low, close, tickvol, vol, spread.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from .. import config


def load(path: str | Path, *, slice_start: str | None = None,
         slice_end: str | None = None) -> pd.DataFrame:
    """Load M1 CSV and return a DataFrame with tz-aware index.

    Args:
        path: Path to the TSV file.
        slice_start, slice_end: Optional ISO date strings (YYYY-MM-DD) to slice
            the DataFrame inclusively.

    Returns:
        pd.DataFrame indexed by tz-aware DatetimeIndex (Europe/Bucharest)
        with columns: open, high, low, close, tickvol, vol, spread.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")

    df = pd.read_csv(path, sep=config.CSV_DELIMITER)

    # Normalize column names to clean lowercase
    rename_map = {
        config.CSV_COLUMNS["date"]: "date",
        config.CSV_COLUMNS["time"]: "time",
        config.CSV_COLUMNS["open"]: "open",
        config.CSV_COLUMNS["high"]: "high",
        config.CSV_COLUMNS["low"]: "low",
        config.CSV_COLUMNS["close"]: "close",
        config.CSV_COLUMNS["tickvol"]: "tickvol",
        config.CSV_COLUMNS["vol"]: "vol",
        config.CSV_COLUMNS["spread"]: "spread",
    }
    df = df.rename(columns=rename_map)

    # Combine date+time into a tz-aware datetime
    dt_str = df["date"].astype(str) + " " + df["time"].astype(str)
    fmt = f"{config.CSV_DATE_FORMAT} {config.CSV_TIME_FORMAT}"
    dt = pd.to_datetime(dt_str, format=fmt)
    # Localize as Europe/Bucharest. ambiguous='infer' handles DST transitions
    # (the broker server time also follows DST).
    dt = dt.dt.tz_localize(config.TIMEZONE, ambiguous="infer", nonexistent="shift_forward")
    df.index = pd.DatetimeIndex(dt, name="time")

    df = df[["open", "high", "low", "close", "tickvol", "vol", "spread"]].copy()

    # Numeric coercion (defensive — read_csv usually does this for us)
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Sort by index (CSVs usually are, but be safe)
    df = df.sort_index()

    # Drop duplicate timestamps (keep last)
    df = df[~df.index.duplicated(keep="last")]

    # Optional slice
    if slice_start:
        start_ts = pd.Timestamp(slice_start, tz=config.TIMEZONE)
        df = df[df.index >= start_ts]
    if slice_end:
        # Inclusive end: include the entire end date
        end_ts = pd.Timestamp(slice_end, tz=config.TIMEZONE) + pd.Timedelta(days=1)
        df = df[df.index < end_ts]

    return df


def summary(df: pd.DataFrame) -> dict:
    """Return a small dict describing the DataFrame for sanity checks."""
    return {
        "rows": int(len(df)),
        "from": df.index[0].isoformat() if len(df) else None,
        "to": df.index[-1].isoformat() if len(df) else None,
        "columns": list(df.columns),
        "has_volume": bool(df["vol"].sum() > 0) if len(df) else False,
        "first_5_rows": df.head().to_dict("records"),
    }
