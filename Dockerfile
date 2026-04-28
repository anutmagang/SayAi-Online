# Worker image: Python deps + ffmpeg/ffprobe (no manual install on host).
FROM python:3.11-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY clipper ./clipper

ENV PYTHONUNBUFFERED=1

ENTRYPOINT ["python", "-m", "clipper"]
