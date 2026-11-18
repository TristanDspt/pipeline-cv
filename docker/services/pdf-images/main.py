"""Service interne : PDF -> une image PNG par page.

- Aucun fichier n'est écrit sur le disque : tout se passe en mémoire.
- Aucun port publié : seul n8n le joint, à http://pdf-images:8000
"""
import base64
import os

import pymupdf  # PyMuPDF
from fastapi import FastAPI, File, HTTPException, UploadFile

# Réglages lus depuis le docker-compose (valeurs par défaut si absents)
MAX_PAGES = int(os.getenv("MAX_PAGES", "12"))
RENDER_DPI = int(os.getenv("RENDER_DPI", "150"))
MAX_SIDE_PX = int(os.getenv("MAX_SIDE_PX", "1800"))  # plus grand côté d'une image
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))

app = FastAPI(title="pdf-images")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/convert")
def convert(file: UploadFile = File(...)):
    """Reçoit un PDF, renvoie un JSON avec une image PNG (base64) par page."""
    data = file.file.read()

    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Fichier trop gros (max {MAX_UPLOAD_MB} Mo)")
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "Ce fichier n'est pas un PDF")

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise HTTPException(400, "PDF illisible ou corrompu")

    if doc.needs_pass:
        raise HTTPException(400, "PDF protégé par mot de passe")

    total = len(doc)
    pages = []
    for i in range(min(total, MAX_PAGES)):
        page = doc[i]

        # Zoom pour atteindre le DPI voulu (72 points par pouce = zoom 1)
        zoom = RENDER_DPI / 72
        # ... sans dépasser MAX_SIDE_PX : une image géante ne rend pas
        # la lecture meilleure, elle ralentit juste le modèle.
        plus_grand_cote = max(page.rect.width, page.rect.height) * zoom
        if plus_grand_cote > MAX_SIDE_PX:
            zoom *= MAX_SIDE_PX / plus_grand_cote

        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        pages.append(
            {
                "page": i + 1,
                "mime": "image/png",
                "width": pix.width,
                "height": pix.height,
                "data": base64.b64encode(pix.tobytes("png")).decode("ascii"),
            }
        )
    doc.close()

    return {
        "page_count": total,
        "pages_returned": len(pages),
        "truncated": total > MAX_PAGES,
        "pages": pages,
    }
