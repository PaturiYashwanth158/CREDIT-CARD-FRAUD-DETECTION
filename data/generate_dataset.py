from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from random import Random

import pandas as pd

from shared.config import get_settings


FEATURE_COLUMNS = [
    "amount",
    "hour_of_day",
    "is_foreign",
    "distance_from_home_km",
    "geo_velocity_kmh",
    "new_device",
    "tx_count_last_1h",
    "tx_count_last_5m",
    "avg_amount_deviation",
    "burst_count_last_1m",
    "device_tx_count_24h",
    "merchant_risk_score",
    "card_age_risk",
    "profile_avg_spend",
    "seconds_since_last_tx",
]

VALID_PREFIXES = ["453968", "453212", "453999", "516744", "517805", "552233"]


def _luhn(card_number: str) -> bool:
    digits = [int(digit) for digit in card_number]
    checksum = 0
    parity = len(digits) % 2
    for index, digit in enumerate(digits):
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def _complete_luhn(prefix: str, length: int = 16) -> str:
    base = prefix
    rng = Random(prefix)
    while len(base) < length - 1:
        base += str(rng.randint(0, 9))
    for check_digit in range(10):
        candidate = f"{base}{check_digit}"
        if _luhn(candidate):
            return candidate
    raise RuntimeError(f"Unable to generate Luhn check digit for prefix {prefix}")


def generate_synthetic_training_dataset(rows: int = 4000, seed: int = 42) -> pd.DataFrame:
    rng = Random(seed)
    samples = []
    for _ in range(rows):
        is_fraud = 1 if rng.random() < 0.18 else 0
        avg_spend = rng.uniform(1500, 6000)
        amount = rng.uniform(200, 8000) if not is_fraud else rng.uniform(5000, 180000)
        hour = rng.randint(7, 22) if not is_fraud else rng.choice([0, 1, 2, 3, 4, 23])
        is_foreign = 1 if is_fraud and rng.random() < 0.65 else 0
        distance = rng.uniform(0, 120) if not is_fraud else rng.uniform(600, 9000)
        velocity = rng.uniform(0, 120) if not is_fraud else rng.uniform(450, 1400)
        new_device = 1 if is_fraud and rng.random() < 0.55 else 0
        tx_1h = rng.uniform(1, 6) if not is_fraud else rng.uniform(8, 18)
        tx_5m = rng.uniform(0, 2) if not is_fraud else rng.uniform(3, 8)
        amount_dev = abs(amount - avg_spend) / max(avg_spend, 1)
        burst = rng.uniform(0, 1) if not is_fraud else rng.uniform(3, 6)
        device_24h = rng.uniform(1, 6) if not is_fraud else rng.uniform(6, 16)
        merchant_risk = 0.2 if not is_fraud else rng.uniform(0.7, 0.95)
        card_age_risk = rng.uniform(0.1, 0.4) if not is_fraud else rng.uniform(0.4, 0.9)
        seconds_since_last = rng.uniform(1800, 18000) if not is_fraud else rng.uniform(5, 600)

        samples.append(
            {
                "amount": round(amount, 2),
                "hour_of_day": hour,
                "is_foreign": is_foreign,
                "distance_from_home_km": round(distance, 2),
                "geo_velocity_kmh": round(velocity, 2),
                "new_device": new_device,
                "tx_count_last_1h": round(tx_1h, 2),
                "tx_count_last_5m": round(tx_5m, 2),
                "avg_amount_deviation": round(amount_dev, 4),
                "burst_count_last_1m": round(burst, 2),
                "device_tx_count_24h": round(device_24h, 2),
                "merchant_risk_score": round(merchant_risk, 4),
                "card_age_risk": round(card_age_risk, 4),
                "profile_avg_spend": round(avg_spend, 2),
                "seconds_since_last_tx": round(seconds_since_last, 2),
                "is_fraud": is_fraud,
            }
        )
    return pd.DataFrame(samples)


def generate_batch_sample(seed: int = 7) -> pd.DataFrame:
    rng = Random(seed)
    start = datetime.utcnow()
    rows = []
    users = ["user_001", "user_002", "user_003"]
    merchants = ["m_retail_01", "m_airline_99", "m_electronics_77", "m_grocery_04"]
    countries = ["IN", "US", "IT", "SG", "AE"]
    devices = ["device_aarav_phone", "device_mia_ios", "device_luca_android", "unknown_tablet_1"]

    for index in range(12):
        prefix = VALID_PREFIXES[index % len(VALID_PREFIXES)]
        card_number = _complete_luhn(prefix)
        row = {
            "transaction_id": f"batch_tx_{index+1:03d}",
            "user_id": users[index % len(users)],
            "card_number": card_number if index != 10 else "9999999999999999",
            "expiry_month": 12,
            "expiry_year": 2030,
            "cvv": "123",
            "amount": round(rng.uniform(300, 180000 if index in {7, 8, 9} else 6500), 2),
            "currency": "INR",
            "merchant_id": merchants[index % len(merchants)],
            "merchant_country": countries[index % len(countries)],
            "is_foreign": index in {4, 7, 8, 9},
            "device_id": devices[index % len(devices)],
            "ip_address": f"10.0.0.{index+10}",
            "latitude": 28.61 + rng.uniform(-0.08, 0.08) if index not in {7, 8} else 40.71 + rng.uniform(-0.1, 0.1),
            "longitude": 77.20 + rng.uniform(-0.08, 0.08) if index not in {7, 8} else -74.00 + rng.uniform(-0.1, 0.1),
            "transaction_ts": (start + timedelta(minutes=index)).isoformat(),
        }
        rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    settings = get_settings()
    batch_df = generate_batch_sample()
    if not settings.resolved_training_data_path.exists() and not settings.resolved_external_training_data_path.exists():
        training_df = generate_synthetic_training_dataset()
        training_df.to_csv(settings.resolved_training_data_path, index=False)
    batch_df.to_csv(Path("data/sample_batch_upload.csv"), index=False)


if __name__ == "__main__":
    main()
