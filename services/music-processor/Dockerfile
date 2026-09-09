FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless ffmpeg libsndfile1 tesseract-ocr curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Production images should install the current Audiveris Linux release here
# and expose its launcher as /usr/local/bin/audiveris.
COPY app.py .
ENV AUDIVERIS_COMMAND=/usr/local/bin/audiveris
EXPOSE 4318
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4318"]
