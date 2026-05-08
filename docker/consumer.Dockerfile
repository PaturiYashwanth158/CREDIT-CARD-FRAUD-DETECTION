FROM python:3.11-slim

WORKDIR /workspace
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY . /workspace
CMD ["sh", "-c", "python -m data.generate_dataset && python -m ml.train_model && PYTHONPATH=/workspace python kafka/consumer.py"]
