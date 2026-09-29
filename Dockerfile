# Optional single-container build for local production-like testing.
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --upgrade pip && pip install -r backend/requirements.txt
COPY backend ./backend
COPY --from=frontend /app/dist ./frontend/dist
EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
