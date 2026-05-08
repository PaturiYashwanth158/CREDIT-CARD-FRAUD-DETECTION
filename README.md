# Credit Card Fraud Detection Platform

Production-style fraud detection system with:

- FastAPI backend APIs
- FastAPI model microservice
- Kafka streaming pipeline
- PostgreSQL persistence
- Streamlit monitoring dashboard
- Batch CSV scoring and export
- Card validation, rules engine, SHAP explainability, and alerting

## Simple Live Website Deployment

This repository now supports a simpler live deployment mode for platforms like Railway:

- one public web service
- one PostgreSQL database
- no Kafka required for the live website
- no separate ML service required for the live website

In this mode:

- the FastAPI app serves the portal website at `/portal`
- fraud scoring falls back to the local model automatically
- Kafka publishing is disabled with `ENABLE_KAFKA=false`

### Railway Deployment

1. Push this repository to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Add a PostgreSQL service in the same Railway project.
4. Set these environment variables in the web service:

```text
DATABASE_URL=<Railway Postgres DATABASE_URL>
JWT_SECRET_KEY=<your-strong-secret>
ENABLE_KAFKA=false
ENABLE_LOCAL_MODEL_FALLBACK=true
```

5. Railway will build using the root `Dockerfile` and config from `railway.json`.
6. Open the deployed site and visit `/portal`.

### Public Website URL

After deployment, your main public routes are:

- `/portal`
- `/docs`
- `/health`

## Architecture

### Services

- `app/`: API service exposing `/predict`, `/upload-csv`, `/alerts`, `/auth/token`
- `ml/`: model service exposing `/score`
- `kafka/`: streaming consumer and replay producer
- `dashboard/`: Streamlit monitoring UI
- `shared/`: shared config, database models, fraud logic, validation, auth
- `data/`: synthetic dataset generator, sample CSV, rules, blacklist
- `docker/`: Dockerfiles for each service

### Kafka Topics

- `transactions_stream`
- `processed_transactions`
- `fraud_alerts`

### PostgreSQL Tables

- `transactions`
- `predictions`
- `alerts`
- `user_profiles`

## Project Structure

```text
.
|-- app/
|-- dashboard/
|-- data/
|-- docker/
|-- kafka/
|-- ml/
|-- shared/
|-- docker-compose.yml
|-- requirements.txt
|-- .env.example
`-- README.md
```

## Features

- Card validation layer:
  - Luhn check
  - BIN validation
  - expiry check
  - CVV validation
  - blacklist simulation
  - issuer detection
- Fraud detection:
  - RandomForest model
  - behavioral features
  - geo distance and geo-velocity
  - device intelligence
  - burst velocity checks
  - configurable rule engine
  - final 0-1 risk score
- Explainability:
  - SHAP feature impact returned by API and alerts
- Security:
  - masked PAN storage
  - JWT auth
  - role-based route protection

## Default Users

- `admin / admin123`
- `analyst / analyst123`
- `viewer / viewer123`

## Local Setup

1. Create a virtual environment and install dependencies.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Copy `.env.example` to `.env` if you want to override defaults.

3. Start PostgreSQL and Kafka locally, then bootstrap data and train the model.

```powershell
python -m data.generate_dataset
python -m ml.train_model
python -m shared.bootstrap
```

4. Start the model service.

```powershell
uvicorn ml.model_service:app --host 0.0.0.0 --port 8001
```

5. Start the backend API.

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

6. Start the Kafka consumer.

```powershell
python kafka/consumer.py
```

7. Start the dashboard.

```powershell
streamlit run dashboard/app.py
```

## Docker Run

```powershell
docker compose up --build
```

### Service URLs

- API: [http://localhost:8000](http://localhost:8000)
- API docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Model service: [http://localhost:8001](http://localhost:8001)
- Dashboard: [http://localhost:8501](http://localhost:8501)
- HugWand prototype: [http://localhost:8000/hugwand](http://localhost:8000/hugwand)

## Kafka Setup Notes

- `docker compose` provisions Zookeeper and Kafka automatically.
- Topics are auto-created by the broker configuration.
- To simulate real-time replay from the sample CSV:

```powershell
python kafka/replay_producer.py
```

## API Flow

### 1. Get token

```bash
curl -X POST "http://localhost:8000/auth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"
```

### 2. Real-time prediction

```bash
curl -X POST "http://localhost:8000/predict" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_001",
    "card_number": "4539687543209403",
    "expiry_month": 12,
    "expiry_year": 2030,
    "cvv": "123",
    "amount": 145000,
    "currency": "INR",
    "merchant_id": "m_electronics_77",
    "merchant_country": "SG",
    "is_foreign": true,
    "device_id": "new_device_xyz",
    "ip_address": "10.1.1.10",
    "latitude": 1.2902,
    "longitude": 103.8519
  }'
```

### 3. Batch CSV upload

```bash
curl -X POST "http://localhost:8000/upload-csv" \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@data/sample_batch_upload.csv"
```

### 4. Fetch alerts

```bash
curl -X GET "http://localhost:8000/alerts" \
  -H "Authorization: Bearer <TOKEN>"
```

## Batch Output

- Uploaded CSV is scored row by row.
- Results are written to `data/exports/batch_results_<batch_id>.csv`.
- Summary plus row-level fraud decisions are returned in the API response.

## Sample CSV

- Input sample: [data/sample_batch_upload.csv](data/sample_batch_upload.csv)
- Training dataset is generated to `data/synthetic_transactions.csv`
- Model artifact is generated to `ml/artifacts/model.pkl`

## Notes

- Invalid cards are blocked immediately before stream scoring.
- Valid cards go through Kafka-backed real-time flow and also have synchronous fallback processing if Kafka is unavailable.
- Alerts are stored in PostgreSQL and also published to `fraud_alerts`.

## HugWand Prototype

The repo now includes a local-first `HugWand` gesture control prototype at `/hugwand`.

- Webcam hand tracking runs in the browser with MediaPipe.
- Desktop actions are executed locally through the FastAPI backend on Windows.
- Open palm arms the system, fist disarms it, point moves the cursor, pinch clicks, peace toggles media playback, thumbs adjust volume, and palm swipes drive track and desktop actions.
- This prototype is intentionally scoped to a small, visible command set so the machine never starts taking actions without an explicit arm gesture.
