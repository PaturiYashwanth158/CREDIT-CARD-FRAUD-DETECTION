import httpx

from ml.model_manager import get_model_manager
from shared.config import get_settings
from shared.schemas import ModelFeaturesPayload, ModelPrediction


settings = get_settings()


def score_with_model_service(payload: ModelFeaturesPayload) -> ModelPrediction:
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(f"{settings.model_service_url}/score", json=payload.model_dump())
            response.raise_for_status()
            return ModelPrediction(**response.json())
    except Exception:
        if not settings.enable_local_model_fallback:
            raise
        manager = get_model_manager()
        return manager.score(payload.transaction_id, payload.feature_vector)
