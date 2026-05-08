import csv
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.hugwand import (
    ACTION_LABELS,
    HugWandActionRequest,
    HugWandActionResponse,
    HugWandConfigResponse,
    HugWandPointerRequest,
    HugWandPointerResponse,
    build_hugwand_config,
    get_desktop_controller,
)
from app.model_client import score_with_model_service
from shared.bootstrap import initialize_database
from shared.config import get_settings
from shared.database import get_db
from shared.fraud_core import FraudOrchestrator
from shared.fraud_core import haversine_km
from shared.kafka_client import publish_event
from shared.models import Alert, CardAccount, Prediction, Transaction, UserProfile
from shared.schemas import (
    AdminCardOptionResponse,
    AdminCustomerOptionResponse,
    AdminOverviewResponse,
    AdminTransactionAnalysisResponse,
    AlertResponse,
    BatchUploadResponse,
    CardAccountResponse,
    MeResponse,
    ModelFeaturesPayload,
    PaymentRequest,
    PredictionResponse,
    RecentTransactionResponse,
    TokenResponse,
    TransactionRequest,
    UserProfileResponse,
)
from shared.security import (
    authenticate_user,
    create_access_token,
    get_current_user,
    require_roles,
)


initialize_database()
settings = get_settings()
router = APIRouter()
orchestrator = FraudOrchestrator()
USER_PAYMENT_EXPORT_FILE = "user_payment_transactions.csv"
USER_PAYMENT_EXPORT_COLUMNS = [
    "transaction_id",
    "created_at",
    "transaction_timestamp",
    "user_id",
    "full_name",
    "card_account_id",
    "card_nickname",
    "masked_card_number",
    "issuer",
    "amount",
    "currency",
    "merchant_id",
    "merchant_country",
    "is_foreign",
    "device_id",
    "ip_address",
    "latitude",
    "longitude",
    "decision",
    "status",
    "risk_score",
    "is_fraud",
    "valid_card",
    "triggered_rules",
    "reasons",
    "explanation",
    "source",
]
UPLOAD_LABEL_ALIASES = ("is_fraud", "fraud", "class", "label", "target")
UPLOAD_FIELD_ALIASES = {
    "transaction_id": ("transaction_id", "trans_num", "transactionid", "id"),
    "user_id": ("user_id", "userid", "customer_id", "client_id"),
    "card_number": ("card_number", "card", "cc_num", "credit_card_number"),
    "expiry_month": ("expiry_month", "exp_month"),
    "expiry_year": ("expiry_year", "exp_year"),
    "cvv": ("cvv", "cvc"),
    "amount": ("amount", "amt"),
    "currency": ("currency", "curr"),
    "merchant_id": ("merchant_id", "merchant", "merchant_name", "category"),
    "merchant_country": ("merchant_country", "merch_country", "country"),
    "is_foreign": ("is_foreign", "foreign_transaction", "is_foreign_transaction"),
    "device_id": ("device_id", "device", "device_info"),
    "ip_address": ("ip_address", "ip", "ip_addr"),
    "latitude": ("latitude", "lat", "merchant_lat", "merch_lat"),
    "longitude": ("longitude", "long", "lon", "merchant_long", "merch_long"),
    "transaction_ts": ("transaction_ts", "timestamp", "trans_date_trans_time", "datetime", "date", "time"),
}
PAYMENT_MERCHANT_CATALOG = [
    {"merchant_id": "m_grocery_04", "merchant_country": "IN", "latitude": 28.6139, "longitude": 77.2090, "bucket": "daily"},
    {"merchant_id": "m_pharmacy_18", "merchant_country": "IN", "latitude": 19.0760, "longitude": 72.8777, "bucket": "daily"},
    {"merchant_id": "m_supermarket_12", "merchant_country": "IN", "latitude": 13.0827, "longitude": 80.2707, "bucket": "daily"},
    {"merchant_id": "m_fuel_27", "merchant_country": "IN", "latitude": 22.5726, "longitude": 88.3639, "bucket": "daily"},
    {"merchant_id": "m_clinic_44", "merchant_country": "IN", "latitude": 18.5204, "longitude": 73.8567, "bucket": "daily"},
    {"merchant_id": "m_lifestyle_22", "merchant_country": "IN", "latitude": 12.9716, "longitude": 77.5946, "bucket": "lifestyle"},
    {"merchant_id": "m_fashion_63", "merchant_country": "IN", "latitude": 26.9124, "longitude": 75.7873, "bucket": "lifestyle"},
    {"merchant_id": "m_restaurant_71", "merchant_country": "IN", "latitude": 17.3850, "longitude": 78.4867, "bucket": "lifestyle"},
    {"merchant_id": "m_electronics_77", "merchant_country": "IN", "latitude": 17.3850, "longitude": 78.4867, "bucket": "electronics"},
    {"merchant_id": "m_appliances_54", "merchant_country": "IN", "latitude": 19.0760, "longitude": 72.8777, "bucket": "electronics"},
    {"merchant_id": "m_mobile_88", "merchant_country": "IN", "latitude": 12.9716, "longitude": 77.5946, "bucket": "electronics"},
    {"merchant_id": "m_airline_99", "merchant_country": "AE", "latitude": 25.2048, "longitude": 55.2708, "bucket": "travel"},
    {"merchant_id": "m_hotel_31", "merchant_country": "SG", "latitude": 1.3521, "longitude": 103.8198, "bucket": "travel"},
    {"merchant_id": "m_booking_67", "merchant_country": "AE", "latitude": 24.4539, "longitude": 54.3773, "bucket": "travel"},
    {"merchant_id": "m_dutyfree_83", "merchant_country": "SG", "latitude": 1.3644, "longitude": 103.9915, "bucket": "travel"},
]


def _normalize_csv_key(value: str) -> str:
    return str(value).strip().lower()


def _pick_csv_value(lookup: dict[str, object], aliases: tuple[str, ...]) -> object | None:
    for alias in aliases:
        key = _normalize_csv_key(alias)
        if key not in lookup:
            continue
        value = lookup[key]
        if pd.isna(value):
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _coerce_bool(value: object | None, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y", "fraud", "blocked"}:
        return True
    if normalized in {"false", "0", "no", "n", "normal", "approved"}:
        return False
    return default


def _coerce_float(value: object | None, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: object | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _derive_payment_coordinates(payment_request: PaymentRequest, profile: UserProfile) -> tuple[float, float]:
    latitude = float(payment_request.latitude) if payment_request.latitude is not None else float(profile.home_latitude)
    longitude = float(payment_request.longitude) if payment_request.longitude is not None else float(profile.home_longitude)
    return latitude, longitude


def _derive_payment_device_id(payment_request: PaymentRequest, profile: UserProfile, http_request: Request) -> str:
    if payment_request.device_id:
        return payment_request.device_id

    user_agent = (http_request.headers.get("user-agent") or "").lower()
    known_devices = list(profile.known_devices or [])
    if known_devices:
        mobile_keywords = ("android", "iphone", "mobile", "ios")
        if any(keyword in user_agent for keyword in mobile_keywords):
            preferred = next((device for device in known_devices if any(tag in device.lower() for tag in ("phone", "ios", "android", "mobile"))), None)
            if preferred:
                return preferred
        return known_devices[0]

    fingerprint = abs(hash(f"{profile.user_id}|{user_agent[:120]}")) % 10000
    suffix = "mobile" if any(keyword in user_agent for keyword in ("android", "iphone", "mobile", "ios")) else "web"
    return f"device_{profile.user_id}_{suffix}_{fingerprint}"


def _get_payment_merchant_by_id(merchant_id: str | None) -> dict[str, object] | None:
    if not merchant_id:
        return None
    normalized = merchant_id.strip().lower()
    for merchant in PAYMENT_MERCHANT_CATALOG:
        if str(merchant["merchant_id"]).lower() == normalized:
            return merchant
    return None


def _enforce_login_device(db: Session, user, device_id: str | None) -> None:
    if user.role != "user" or not user.user_id:
        return

    profile = db.query(UserProfile).filter(UserProfile.user_id == user.user_id).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found")

    normalized_device = str(device_id or "").strip()
    if not normalized_device:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Device verification failed")

    known_devices = list(profile.known_devices or [])
    has_browser_enrollment = any(str(device).startswith("browser_device_") for device in known_devices)

    if normalized_device in known_devices:
        return

    if not has_browser_enrollment and len(known_devices) < 3:
        profile.known_devices = known_devices + [normalized_device]
        db.commit()
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Login rejected: this device is not registered for the account",
    )


def _detect_payment_merchant(profile: UserProfile, amount: float, transaction_ts: datetime, latitude: float, longitude: float) -> dict[str, object]:
    distance_from_home = haversine_km(latitude, longitude, float(profile.home_latitude), float(profile.home_longitude))
    hour = transaction_ts.hour

    if distance_from_home > 1800 or amount >= 90000:
        bucket = "travel"
    elif amount >= 30000:
        bucket = "electronics"
    elif amount <= 2500:
        bucket = "daily"
    elif hour >= 20 or hour <= 6:
        bucket = "lifestyle"
    else:
        bucket = "lifestyle"

    candidates = [merchant for merchant in PAYMENT_MERCHANT_CATALOG if merchant["bucket"] == bucket]
    if bucket != "travel":
        local_candidates = [merchant for merchant in candidates if merchant["merchant_country"] == profile.home_country]
        if local_candidates:
            candidates = local_candidates
    if not candidates:
        candidates = PAYMENT_MERCHANT_CATALOG

    seed = abs(hash(f"{profile.user_id}|{amount:.2f}|{transaction_ts.isoformat()}|{bucket}"))
    return candidates[seed % len(candidates)]


def _coerce_datetime(value: object | None, index: int) -> datetime:
    if value is None:
        return datetime.utcnow() + timedelta(seconds=index)
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.utcnow() - timedelta(seconds=max(float(value), 0.0))
    try:
        parsed = pd.to_datetime(value, utc=False, errors="raise")
        if hasattr(parsed, "to_pydatetime"):
            return parsed.to_pydatetime()
    except Exception:
        pass
    return datetime.utcnow() + timedelta(seconds=index)


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _append_user_payment_csv(
    profile: UserProfile,
    card: CardAccount,
    payment_request: PaymentRequest | TransactionRequest,
    result: PredictionResponse,
    prediction_row: Prediction | None,
) -> Path:
    export_path = settings.resolved_export_dir / USER_PAYMENT_EXPORT_FILE
    export_path.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "transaction_id": result.transaction_id,
        "created_at": (
            prediction_row.created_at.isoformat()
            if prediction_row and prediction_row.created_at
            else datetime.utcnow().isoformat()
        ),
        "transaction_timestamp": payment_request.transaction_ts.isoformat(),
        "user_id": profile.user_id,
        "full_name": profile.full_name,
        "card_account_id": card.id,
        "card_nickname": card.nickname,
        "masked_card_number": result.masked_card_number or card.masked_card_number,
        "issuer": result.issuer or card.issuer,
        "amount": float(payment_request.amount),
        "currency": payment_request.currency,
        "merchant_id": payment_request.merchant_id,
        "merchant_country": payment_request.merchant_country,
        "is_foreign": (
            payment_request.is_foreign
            if payment_request.is_foreign is not None
            else payment_request.merchant_country != profile.home_country
        ),
        "device_id": payment_request.device_id,
        "ip_address": payment_request.ip_address,
        "latitude": float(payment_request.latitude),
        "longitude": float(payment_request.longitude),
        "decision": result.decision,
        "status": result.status,
        "risk_score": float(result.risk_score),
        "is_fraud": bool(result.is_fraud),
        "valid_card": bool(result.valid_card),
        "triggered_rules": json.dumps(result.triggered_rules, default=str),
        "reasons": json.dumps(result.reasons, default=str),
        "explanation": json.dumps(result.explanation, default=str),
        "source": prediction_row.source if prediction_row is not None else "payment:user",
    }
    file_exists = export_path.exists()
    with export_path.open("a", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=USER_PAYMENT_EXPORT_COLUMNS)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)
    return export_path


def _normalize_uploaded_row(
    row: dict[str, object],
    index: int,
    batch_id: str,
    profiles: list[UserProfile],
    cards: list[CardAccount],
) -> tuple[TransactionRequest, dict[str, object]]:
    if not profiles:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No user profiles available for batch normalization")
    if not cards:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No card accounts available for batch normalization")

    lookup = {_normalize_csv_key(key): value for key, value in row.items()}
    label_value = _pick_csv_value(lookup, UPLOAD_LABEL_ALIASES)
    known_fraud = _coerce_bool(label_value, default=False) if label_value is not None else None

    requested_user_id = _pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["user_id"])
    fallback_profile = next((profile for profile in profiles if profile.user_id == requested_user_id), None)
    if fallback_profile is None:
        fallback_profile = profiles[index % len(profiles)]

    explicit_card_number = _pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["card_number"])
    matching_card = None
    if explicit_card_number is not None:
        stripped = str(explicit_card_number).replace(" ", "")
        matching_card = next((card for card in cards if card.card_number == stripped), None)

    if matching_card is None:
        matching_card = next((card for card in cards if card.user_id == fallback_profile.user_id), cards[index % len(cards)])

    amount = _coerce_float(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["amount"]), default=0.0)
    if amount <= 0:
        amount = round(2500.0 + (index * 137.0), 2)

    merchant_country_value = _pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["merchant_country"])
    merchant_country = str(merchant_country_value).upper() if merchant_country_value is not None else fallback_profile.home_country
    if merchant_country == fallback_profile.home_country and known_fraud is True:
        merchant_country = "SG" if fallback_profile.home_country != "SG" else "AE"

    explicit_latitude = _pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["latitude"])
    explicit_longitude = _pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["longitude"])
    latitude = _coerce_float(explicit_latitude, fallback_profile.home_latitude)
    longitude = _coerce_float(explicit_longitude, fallback_profile.home_longitude)
    if explicit_latitude is None and known_fraud is True:
        latitude = _clamp(fallback_profile.home_latitude + 18.0, -89.0, 89.0)
    if explicit_longitude is None and known_fraud is True:
        longitude = _clamp(fallback_profile.home_longitude + 32.0, -179.0, 179.0)

    is_foreign_raw = _pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["is_foreign"])
    is_foreign = _coerce_bool(
        is_foreign_raw,
        default=(merchant_country != fallback_profile.home_country if is_foreign_raw is None else False),
    )
    if known_fraud is True and is_foreign_raw is None:
        is_foreign = True

    device_id_value = _pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["device_id"])
    if device_id_value is None:
        device_id = f"dataset_device_{fallback_profile.user_id}_{index + 1}"
        if known_fraud is True:
            device_id = f"unknown_dataset_device_{index + 1}"
    else:
        device_id = str(device_id_value)

    transaction_payload = {
        "transaction_id": str(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["transaction_id"]) or f"{batch_id}_row_{index + 1}"),
        "user_id": str(requested_user_id or fallback_profile.user_id),
        "card_number": str(explicit_card_number or matching_card.card_number).replace(" ", ""),
        "expiry_month": _coerce_int(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["expiry_month"]), matching_card.expiry_month),
        "expiry_year": _coerce_int(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["expiry_year"]), matching_card.expiry_year),
        "cvv": str(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["cvv"]) or matching_card.cvv).zfill(3),
        "amount": amount,
        "currency": str(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["currency"]) or "INR").upper(),
        "merchant_id": str(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["merchant_id"]) or f"dataset_merchant_{index + 1}"),
        "merchant_country": merchant_country,
        "is_foreign": is_foreign,
        "device_id": device_id,
        "ip_address": str(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["ip_address"]) or "10.0.0.50"),
        "latitude": latitude,
        "longitude": longitude,
        "transaction_ts": _coerce_datetime(_pick_csv_value(lookup, UPLOAD_FIELD_ALIASES["transaction_ts"]), index),
    }
    return TransactionRequest(**transaction_payload), {
        "known_fraud_label": known_fraud,
        "input_columns": sorted(lookup.keys()),
        "normalized_user_id": fallback_profile.user_id,
        "normalized_card_last4": matching_card.masked_card_number[-4:],
    }


def _serialize_recent_transactions(db: Session, user_id: str, limit: int = 8) -> list[RecentTransactionResponse]:
    rows = (
        db.query(Transaction, Prediction)
        .join(Prediction, Prediction.transaction_id == Transaction.id)
        .filter(Transaction.user_id == user_id)
        .order_by(Prediction.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        RecentTransactionResponse(
            transaction_id=transaction.id,
            created_at=prediction.created_at,
            amount=float(transaction.amount),
            merchant_id=transaction.merchant_id,
            merchant_country=transaction.merchant_country,
            decision=prediction.decision,
            risk_score=float(prediction.risk_score),
            is_fraud=prediction.is_fraud,
            masked_card_number=transaction.masked_card_number,
        )
        for transaction, prediction in rows
    ]


def _build_me_response(db: Session, user) -> MeResponse:
    if user.role == "admin":
        average_risk = db.query(func.avg(Prediction.risk_score)).scalar() or 0.0
        overview = AdminOverviewResponse(
            transactions=db.query(func.count(Transaction.id)).scalar() or 0,
            predictions=db.query(func.count(Prediction.id)).scalar() or 0,
            alerts=db.query(func.count(Alert.id)).scalar() or 0,
            fraud_cases=db.query(func.count(Prediction.id)).filter(Prediction.is_fraud.is_(True)).scalar() or 0,
            average_risk_score=float(average_risk),
        )
        return MeResponse(
            username=user.username,
            role=user.role,
            full_name=user.full_name,
            admin_overview=overview,
        )

    if not user.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User account is not linked to a profile")

    profile = db.query(UserProfile).filter(UserProfile.user_id == user.user_id).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found")

    cards = (
        db.query(CardAccount)
        .filter(CardAccount.user_id == user.user_id)
        .order_by(CardAccount.id.asc())
        .all()
    )
    card_payload = [
        CardAccountResponse(
            id=card.id,
            nickname=card.nickname,
            issuer=card.issuer,
            masked_card_number=card.masked_card_number,
            expiry_month=card.expiry_month,
            expiry_year=card.expiry_year,
            available_limit=card.available_limit,
            outstanding_balance=card.outstanding_balance,
            card_status=card.card_status,
            billing_cycle_day=card.billing_cycle_day,
            network=card.network,
        )
        for card in cards
    ]
    return MeResponse(
        username=user.username,
        role=user.role,
        full_name=user.full_name or profile.full_name,
        user_profile=UserProfileResponse(
            user_id=profile.user_id,
            full_name=profile.full_name,
            email=profile.email,
            home_country=profile.home_country,
            home_latitude=profile.home_latitude,
            home_longitude=profile.home_longitude,
            avg_spend=profile.avg_spend,
            typical_tx_per_day=profile.typical_tx_per_day,
            known_devices=list(profile.known_devices),
            cards=card_payload,
            recent_transactions=_serialize_recent_transactions(db, profile.user_id),
        ),
    )


def _serialize_admin_customer_options(db: Session) -> list[AdminCustomerOptionResponse]:
    profiles = db.query(UserProfile).order_by(UserProfile.full_name.asc()).all()
    cards = db.query(CardAccount).order_by(CardAccount.user_id.asc(), CardAccount.id.asc()).all()
    cards_by_user: dict[str, list[CardAccount]] = {}
    for card in cards:
        cards_by_user.setdefault(card.user_id, []).append(card)

    return [
        AdminCustomerOptionResponse(
            user_id=profile.user_id,
            full_name=profile.full_name,
            home_country=profile.home_country,
            home_latitude=float(profile.home_latitude),
            home_longitude=float(profile.home_longitude),
            known_devices=list(profile.known_devices),
            cards=[
                AdminCardOptionResponse(
                    id=card.id,
                    nickname=card.nickname,
                    issuer=card.issuer,
                    card_number=card.card_number,
                    masked_card_number=card.masked_card_number,
                    expiry_month=card.expiry_month,
                    expiry_year=card.expiry_year,
                    cvv=card.cvv,
                    available_limit=float(card.available_limit),
                    card_status=card.card_status,
                )
                for card in cards_by_user.get(profile.user_id, [])
            ],
        )
        for profile in profiles
    ]


def _serialize_admin_payment_analyses(db: Session, limit: int = 12) -> list[AdminTransactionAnalysisResponse]:
    rows = (
        db.query(Transaction, Prediction, UserProfile)
        .join(Prediction, Prediction.transaction_id == Transaction.id)
        .join(UserProfile, UserProfile.user_id == Transaction.user_id)
        .filter(Prediction.source == "payment:user")
        .order_by(Prediction.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        AdminTransactionAnalysisResponse(
            transaction_id=transaction.id,
            created_at=prediction.created_at,
            user_id=transaction.user_id,
            full_name=profile.full_name,
            amount=float(transaction.amount),
            merchant_id=transaction.merchant_id,
            merchant_country=transaction.merchant_country,
            decision=prediction.decision,
            risk_score=float(prediction.risk_score),
            is_fraud=prediction.is_fraud,
            issuer=transaction.card_issuer,
            masked_card_number=transaction.masked_card_number,
            source=prediction.source,
            valid_card=transaction.is_valid_card,
            triggered_rules=prediction.triggered_rules or [],
            summary=prediction.explanation.get("summary", []),
            explanation=prediction.explanation or {},
        )
        for transaction, prediction, profile in rows
    ]


def _serialize_admin_recent_transactions(db: Session, limit: int = 16) -> list[AdminTransactionAnalysisResponse]:
    rows = (
        db.query(Transaction, Prediction, UserProfile)
        .join(Prediction, Prediction.transaction_id == Transaction.id)
        .join(UserProfile, UserProfile.user_id == Transaction.user_id)
        .order_by(Prediction.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        AdminTransactionAnalysisResponse(
            transaction_id=transaction.id,
            created_at=prediction.created_at,
            user_id=transaction.user_id,
            full_name=profile.full_name,
            amount=float(transaction.amount),
            merchant_id=transaction.merchant_id,
            merchant_country=transaction.merchant_country,
            decision=prediction.decision,
            risk_score=float(prediction.risk_score),
            is_fraud=prediction.is_fraud,
            issuer=transaction.card_issuer,
            masked_card_number=transaction.masked_card_number,
            source=prediction.source,
            valid_card=transaction.is_valid_card,
            triggered_rules=prediction.triggered_rules or [],
            summary=prediction.explanation.get("summary", []),
            explanation=prediction.explanation or {},
        )
        for transaction, prediction, profile in rows
    ]


@router.post("/auth/token", response_model=TokenResponse)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> TokenResponse:
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    submitted_form = await request.form()
    _enforce_login_device(db, user, submitted_form.get("device_id"))
    token = create_access_token(user.username, user.role, user.user_id, user.full_name)
    return TokenResponse(access_token=token, role=user.role)


@router.get("/me", response_model=MeResponse)
def me(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> MeResponse:
    return _build_me_response(db, user)


@router.get("/admin/customer-options", response_model=list[AdminCustomerOptionResponse])
def get_admin_customer_options(
    db: Session = Depends(get_db),
    user=Depends(require_roles("admin")),
) -> list[AdminCustomerOptionResponse]:
    return _serialize_admin_customer_options(db)


@router.post("/predict", response_model=PredictionResponse)
def predict(
    request: TransactionRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> PredictionResponse:
    validation = orchestrator.validate_card(request)

    if not validation.is_valid:
        blocked = orchestrator.persist_invalid_transaction(db, request, validation, source=f"api:{user.role}")
        if settings.enable_kafka:
            try:
                publish_event(settings.processed_topic, request.transaction_id, blocked.response.model_dump(mode="json"))
                publish_event(
                    settings.alerts_topic,
                    request.transaction_id,
                    {
                        "transaction_id": request.transaction_id,
                        "risk_score": blocked.response.risk_score,
                        "decision": blocked.response.decision,
                        "message": blocked.alert_row.message if blocked.alert_row else "Invalid card blocked",
                        "explanation": blocked.response.explanation,
                    },
                )
            except Exception:
                pass
        return blocked.response

    orchestrator.queue_transaction(db, request, validation)
    if settings.enable_kafka:
        try:
            publish_event(
                settings.transactions_topic,
                request.transaction_id,
                request.model_dump(mode="json"),
            )
            deadline = time.time() + settings.predict_wait_seconds
            while time.time() < deadline:
                result = orchestrator.fetch_prediction_response(db, request.transaction_id)
                if result:
                    return result
                time.sleep(0.5)
        except Exception:
            pass

    features, _ = orchestrator.build_feature_vector(db, request)
    model_prediction = score_with_model_service(
        ModelFeaturesPayload(transaction_id=request.transaction_id, feature_vector=features)
    )
    finalized = orchestrator.finalize_transaction(
        db,
        request,
        validation,
        model_prediction,
        source=f"api:{user.role}",
    )
    if settings.enable_kafka:
        try:
            publish_event(settings.processed_topic, request.transaction_id, finalized.response.model_dump(mode="json"))
        except Exception:
            pass
    return finalized.response


@router.post("/payments", response_model=PredictionResponse)
def create_payment(
    payment_request: PaymentRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_roles("user")),
) -> PredictionResponse:
    if not user.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User account is not linked to a profile")

    card = (
        db.query(CardAccount)
        .filter(CardAccount.id == payment_request.card_account_id, CardAccount.user_id == user.user_id)
        .first()
    )
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card account not found for this user")
    if card.card_status.lower() != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected card is not active")
    if payment_request.cvv != card.cvv:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CVV verification failed")
    if payment_request.amount > card.available_limit:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Amount exceeds available credit limit")

    profile = db.query(UserProfile).filter(UserProfile.user_id == user.user_id).first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User profile not found")

    latitude, longitude = _derive_payment_coordinates(payment_request, profile)
    selected_merchant = _get_payment_merchant_by_id(payment_request.merchant_id)
    if payment_request.merchant_id and selected_merchant is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected merchant is not supported")

    if selected_merchant is None:
        selected_merchant = _detect_payment_merchant(
            profile,
            float(payment_request.amount),
            payment_request.transaction_ts,
            latitude,
            longitude,
        )

    merchant_id = str(selected_merchant["merchant_id"])
    merchant_country = str(selected_merchant["merchant_country"]).upper()
    device_id = _derive_payment_device_id(payment_request, profile, http_request)
    ip_address = payment_request.ip_address or (http_request.client.host if http_request.client else "127.0.0.1")
    is_foreign = (
        payment_request.is_foreign
        if payment_request.is_foreign is not None
        else merchant_country != profile.home_country
    )

    transaction = TransactionRequest(
        user_id=user.user_id,
        card_number=card.card_number,
        expiry_month=card.expiry_month,
        expiry_year=card.expiry_year,
        cvv=payment_request.cvv,
        amount=payment_request.amount,
        currency=payment_request.currency,
        merchant_id=merchant_id,
        merchant_country=merchant_country,
        is_foreign=is_foreign,
        device_id=device_id,
        ip_address=ip_address,
        latitude=latitude,
        longitude=longitude,
        transaction_ts=payment_request.transaction_ts,
    )
    result = predict(transaction, db, user)
    prediction = db.query(Prediction).filter(Prediction.transaction_id == result.transaction_id).first()
    if prediction is not None:
        prediction.source = "payment:user"
    if result.decision == "approved":
        card.available_limit = max(0.0, float(card.available_limit) - payment_request.amount)
        card.outstanding_balance = float(card.outstanding_balance) + payment_request.amount
    db.commit()
    _append_user_payment_csv(profile, card, transaction, result, prediction)
    return result


@router.post("/upload-csv", response_model=BatchUploadResponse)
def upload_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_roles("admin", "analyst")),
) -> BatchUploadResponse:
    batch_id = str(uuid4())
    dataframe = pd.read_csv(file.file)
    results: list[PredictionResponse] = []
    fraud_count = 0
    blocked_count = 0
    profiles = db.query(UserProfile).order_by(UserProfile.user_id.asc()).all()
    cards = db.query(CardAccount).filter(CardAccount.card_status == "active").order_by(CardAccount.id.asc()).all()
    normalization_metadata: dict[str, dict[str, object]] = {}

    for index, row in enumerate(dataframe.to_dict(orient="records")):
        payload, row_metadata = _normalize_uploaded_row(row, index, batch_id, profiles, cards)
        normalization_metadata[payload.transaction_id] = row_metadata
        validation = orchestrator.validate_card(payload)
        if not validation.is_valid:
            result = orchestrator.persist_invalid_transaction(db, payload, validation, source=f"batch:{user.role}")
        else:
            features, _ = orchestrator.build_feature_vector(db, payload)
            model_prediction = score_with_model_service(
                ModelFeaturesPayload(transaction_id=payload.transaction_id, feature_vector=features)
            )
            result = orchestrator.finalize_transaction(
                db,
                payload,
                validation,
                model_prediction,
                source=f"batch:{user.role}",
            )
        results.append(result.response)
        fraud_count += int(result.response.is_fraud)
        blocked_count += int(result.response.status == "blocked")

    export_rows = []
    for result in results:
        export_rows.append(
            {
                "transaction_id": result.transaction_id,
                "decision": result.decision,
                "risk_score": result.risk_score,
                "is_fraud": result.is_fraud,
                "valid_card": result.valid_card,
                "issuer": result.issuer,
                "masked_card_number": result.masked_card_number,
                "known_fraud_label": normalization_metadata.get(result.transaction_id, {}).get("known_fraud_label"),
                "normalized_user_id": normalization_metadata.get(result.transaction_id, {}).get("normalized_user_id"),
                "reasons": " | ".join(result.reasons),
            }
        )

    export_path = Path(settings.resolved_export_dir) / f"batch_results_{batch_id}.csv"
    pd.DataFrame(export_rows).to_csv(export_path, index=False)

    return BatchUploadResponse(
        batch_id=batch_id,
        processed_count=len(results),
        fraud_count=fraud_count,
        blocked_count=blocked_count,
        export_file=str(export_path),
        results=results,
    )


@router.get("/alerts", response_model=list[AlertResponse])
def get_alerts(
    limit: int = 50,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[AlertResponse]:
    query = db.query(Alert)
    if user.role == "user":
        if not user.user_id:
            return []
        user_transaction_ids = db.query(Transaction.id).filter(Transaction.user_id == user.user_id).subquery()
        query = query.filter(Alert.transaction_id.in_(user_transaction_ids))
    elif user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admin or user roles can access alerts")

    rows = query.order_by(Alert.created_at.desc()).limit(limit).all()
    return [
        AlertResponse(
            transaction_id=row.transaction_id,
            severity=row.severity,
            alert_type=row.alert_type,
            risk_score=row.risk_score,
            message=row.message,
            explanation=row.explanation,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.get("/admin/payment-analyses", response_model=list[AdminTransactionAnalysisResponse])
def get_admin_payment_analyses(
    limit: int = 12,
    db: Session = Depends(get_db),
    user=Depends(require_roles("admin")),
) -> list[AdminTransactionAnalysisResponse]:
    return _serialize_admin_payment_analyses(db, limit=limit)


@router.get("/admin/recent-transactions", response_model=list[AdminTransactionAnalysisResponse])
def get_admin_recent_transactions(
    limit: int = 16,
    db: Session = Depends(get_db),
    user=Depends(require_roles("admin")),
) -> list[AdminTransactionAnalysisResponse]:
    return _serialize_admin_recent_transactions(db, limit=limit)


@router.get("/hugwand/config", response_model=HugWandConfigResponse)
def get_hugwand_config() -> HugWandConfigResponse:
    return build_hugwand_config()


@router.post("/hugwand/action", response_model=HugWandActionResponse)
def trigger_hugwand_action(request: HugWandActionRequest) -> HugWandActionResponse:
    controller = get_desktop_controller()
    detail = controller.perform(request.action)
    return HugWandActionResponse(
        ok=controller.pointer_enabled,
        action=request.action,
        label=ACTION_LABELS[request.action],
        detail=detail,
        platform=controller.platform,
    )


@router.post("/hugwand/pointer", response_model=HugWandPointerResponse)
def move_hugwand_pointer(request: HugWandPointerRequest) -> HugWandPointerResponse:
    controller = get_desktop_controller()
    detail = controller.move_pointer(request.x, request.y)
    return HugWandPointerResponse(
        ok=controller.pointer_enabled,
        detail=detail,
        platform=controller.platform,
    )
