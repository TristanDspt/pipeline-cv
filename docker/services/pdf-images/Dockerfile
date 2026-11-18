FROM python:3.12-slim

# Pas de fichiers .pyc, logs affichés tout de suite
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Les dépendances d'abord : Docker réutilise cette couche tant que
# requirements.txt ne change pas (reconstruction rapide).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Le service tourne avec un utilisateur sans droits, pas en root
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
