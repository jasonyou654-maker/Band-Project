FROM python:3.10-slim

# This service is the public audio-transcription worker.  Audiveris (Java OMR)
# and Demucs are optional, heavyweight tools; putting them in this free worker
# made an unrelated OMR download capable of preventing Basic Pitch from starting.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY transcription ./transcription
ENV ENABLE_SOURCE_SEPARATION=false
EXPOSE 4318
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-4318}"]
