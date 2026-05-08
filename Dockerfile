FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENABLE_KAFKA=false \
    ENABLE_LOCAL_MODEL_FALLBACK=true

WORKDIR /app

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app

CMD ["sh", "-c", "python -m data.generate_dataset && python -m ml.train_model && python -m shared.bootstrap && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
