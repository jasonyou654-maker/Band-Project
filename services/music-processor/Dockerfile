FROM python:3.10-slim

ARG AUDIVERIS_VERSION=5.10.2

# Install Audiveris together with its native dependencies so score-image and
# PDF recognition is available from the same public processing service.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ffmpeg libsndfile1 libxtst6 tesseract-ocr tesseract-ocr-eng \
    && curl -fsSL \
      "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/Audiveris-${AUDIVERIS_VERSION}-ubuntu22.04-x86_64.deb" \
      -o /tmp/audiveris.deb \
    && dpkg-deb -x /tmp/audiveris.deb / \
    && audiveris_launcher="$(find /opt -maxdepth 3 -type f -name Audiveris | head -n 1)" \
    && test -x "$audiveris_launcher" \
    && ln -s "$audiveris_launcher" /usr/local/bin/audiveris \
    && rm /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY requirements.txt requirements-separation.txt ./
RUN pip install --no-cache-dir -r requirements-separation.txt
COPY app.py .
COPY transcription ./transcription
COPY models ./models
ENV AUDIVERIS_COMMAND=/usr/local/bin/audiveris
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
ENV ENABLE_SOURCE_SEPARATION=true
EXPOSE 4318
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-4318}"]
