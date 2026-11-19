"""
Interface Streamlit du pipeline d'anonymisation de CV.

Lancer (depuis le dossier interface/) :
    streamlit run app.py

Ce que fait l'appli :
  1. Onglet « Anonymiser » : upload d'un CV -> POST vers le webhook n8n ->
     affichage du résultat (statut, code consultant, alertes RGPD, PDF anonymisé).
  2. Onglet « Registre » : lecture du fichier Excel du registre (sorties/).

Contrat attendu avec n8n (à respecter côté workflow `pipeline_cv_api`) :
  - Requête  : POST multipart/form-data, un champ fichier nommé FIELD_NAME.
  - Réponse  : JSON avec les clés
        statut           : "ok" ou "excel_non_mis_a_jour" (ou autre texte)
        code_consultant  : "CONS-XXXXXX"
        lien_pdf         : URL qui renvoie le PDF anonymisé (workflow « lien »)
        alertes_rgpd     : liste (textes) ou nombre
        message          : texte libre optionnel
  - Code HTTP 2xx si le CV anonymisé est produit, 4xx/5xx sinon.
Aucun secret ici : tout est local, les réglages passent par des variables d'environnement.
"""

import base64
import os
from pathlib import Path

import pandas as pd
import requests
import streamlit as st

# --------------------------------------------------------------------------
# Réglages (surchargeables par variables d'environnement)
# --------------------------------------------------------------------------
N8N_BASE_URL = os.getenv("N8N_BASE_URL", "http://localhost:5678")
# Chemin du webhook POST : à adapter à celui que tu crées dans n8n.
# /webhook/... = URL de production (workflow publié) ; /webhook-test/... = URL de test.
WEBHOOK_PATH = os.getenv("N8N_WEBHOOK_PATH", "/webhook/anonymiser-cv")
FIELD_NAME = "cv"  # nom du champ fichier envoyé à n8n

# Le pipeline peut prendre 1 à 2 min (chargement du modèle à froid) : timeout large.
CONNECT_TIMEOUT_S = 5
READ_TIMEOUT_S = int(os.getenv("N8N_READ_TIMEOUT_S", "300"))

# Le registre est lu directement sur le disque (Streamlit tourne sur la même machine).
REGISTRE_XLSX = Path(
    os.getenv(
        "REGISTRE_XLSX",
        Path(__file__).resolve().parent.parent / "sorties" / "registre_consultants.xlsx",
    )
)
# Colonnes qui contiennent de l'identité réelle : masquées par défaut.
COLONNES_IDENTITE = [
    "Prénom", "Nom", "E-mail", "Téléphone", "Adresse",
    "Liens (LinkedIn, GitHub…)", "Fichier source",
]

MIME_PAR_EXTENSION = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


# --------------------------------------------------------------------------
# Appels réseau
# --------------------------------------------------------------------------
def envoyer_cv(nom: str, contenu: bytes) -> requests.Response:
    """Envoie le CV au webhook n8n et renvoie la réponse HTTP brute."""
    mime = MIME_PAR_EXTENSION.get(Path(nom).suffix.lower(), "application/octet-stream")
    return requests.post(
        N8N_BASE_URL + WEBHOOK_PATH,
        files={FIELD_NAME: (nom, contenu, mime)},
        timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
    )


def telecharger_pdf(url: str) -> bytes | None:
    """Récupère le PDF anonymisé via le lien renvoyé par n8n (None si échec)."""
    try:
        r = requests.get(url, timeout=(CONNECT_TIMEOUT_S, 30))
        if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("application/pdf"):
            return r.content
    except requests.RequestException:
        pass
    return None


def afficher_pdf(pdf: bytes) -> None:
    """Affiche le PDF dans la page (iframe base64). Le bouton de téléchargement reste le plan B."""
    b64 = base64.b64encode(pdf).decode()
    st.markdown(
        f'<iframe src="data:application/pdf;base64,{b64}" width="100%" height="800" '
        'type="application/pdf"></iframe>',
        unsafe_allow_html=True,
    )


# --------------------------------------------------------------------------
# Onglet 1 : anonymiser un CV
# --------------------------------------------------------------------------
def onglet_anonymiser() -> None:
    st.caption(
        "Le CV est traité par un modèle local (Ollama) : rien ne part sur Internet. "
        "Première requête après une pause : jusqu'à ~2 min (chargement du modèle)."
    )
    fichier = st.file_uploader("CV à anonymiser", type=["pdf", "docx"])

    if fichier is None:
        # On garde le dernier résultat affiché tant qu'on n'a pas relancé un traitement.
        resultat = st.session_state.get("resultat")
        if resultat:
            afficher_resultat(resultat)
        return

    if st.button("Anonymiser", type="primary"):
        st.session_state.pop("resultat", None)
        try:
            with st.spinner("Traitement en cours (extraction, rédaction, contrôle RGPD)…"):
                rep = envoyer_cv(fichier.name, fichier.getvalue())
        except requests.exceptions.ConnectionError:
            st.error(
                f"Impossible de joindre n8n sur {N8N_BASE_URL}. "
                "Le conteneur tourne-t-il ? Le workflow est-il publié (URL de production) ?"
            )
            return
        except requests.exceptions.ReadTimeout:
            st.error(
                f"Pas de réponse après {READ_TIMEOUT_S} s. Regarde l'onglet Executions de n8n : "
                "le traitement a peut-être abouti sans que la réponse revienne."
            )
            return

        st.session_state["resultat"] = construire_resultat(rep)

    resultat = st.session_state.get("resultat")
    if resultat:
        afficher_resultat(resultat)


def construire_resultat(rep: requests.Response) -> dict:
    """Transforme la réponse HTTP en dictionnaire prêt à afficher."""
    res = {"http": rep.status_code, "json": None, "texte": rep.text[:500], "pdf": None}
    try:
        res["json"] = rep.json()
    except ValueError:
        return res  # pas du JSON (ex. page d'erreur HTML de n8n) : on affichera le texte brut

    if 200 <= rep.status_code < 300 and isinstance(res["json"], dict):
        lien = res["json"].get("lien_pdf")
        if lien:
            res["pdf"] = telecharger_pdf(lien)
    return res


def afficher_resultat(res: dict) -> None:
    data = res["json"]

    # Réponse inexploitable (pas de JSON) ou erreur HTTP
    if data is None or not isinstance(data, dict):
        st.error(f"Réponse inattendue de n8n (HTTP {res['http']}).")
        st.code(res["texte"] or "(vide)")
        return
    if not 200 <= res["http"] < 300:
        st.error(f"n8n a répondu HTTP {res['http']} : {data.get('message', 'pas de détail')}")
        with st.expander("Réponse brute"):
            st.json(data)
        return

    statut = data.get("statut", "inconnu")
    code = data.get("code_consultant", "?")

    if statut == "ok":
        st.success(f"CV anonymisé : {code}")
    else:
        st.warning(f"CV anonymisé : {code}, mais statut « {statut} ». {data.get('message', '')}")

    # Alertes RGPD : liste de textes ou simple compteur selon ce que n8n renvoie
    alertes = data.get("alertes_rgpd", [])
    nb = alertes if isinstance(alertes, int) else len(alertes)
    if nb:
        st.warning(f"{nb} correction(s) automatique(s) du contrôle RGPD : à relire.")
        if isinstance(alertes, list):
            with st.expander("Détail des alertes"):
                for a in alertes:
                    st.write("• " + (a if isinstance(a, str) else str(a)))
    else:
        st.info("Aucune correction automatique du contrôle RGPD.")

    # PDF anonymisé
    if res["pdf"]:
        st.download_button(
            "Télécharger le PDF anonymisé",
            data=res["pdf"],
            file_name=f"{code}.pdf",
            mime="application/pdf",
        )
        afficher_pdf(res["pdf"])
    else:
        st.error("Le PDF n'a pas pu être récupéré via le lien renvoyé par n8n.")
        if data.get("lien_pdf"):
            st.write(f"Lien : {data['lien_pdf']}")


# --------------------------------------------------------------------------
# Onglet 2 : registre interne
# --------------------------------------------------------------------------
def onglet_registre() -> None:
    st.warning(
        "Registre interne : contient les identités réelles. "
        "Usage ESN uniquement, ne jamais le partager ni le commiter."
    )
    if not REGISTRE_XLSX.exists():
        st.info(f"Pas encore de registre ({REGISTRE_XLSX}). Traite un CV d'abord.")
        return
    try:
        df = pd.read_excel(REGISTRE_XLSX)
    except PermissionError:
        st.error("Le fichier Excel est ouvert dans Excel : ferme-le puis recharge.")
        return

    voir_identites = st.toggle("Afficher les identités", value=False)
    if not voir_identites:
        df = df.drop(columns=[c for c in COLONNES_IDENTITE if c in df.columns])
    st.caption(f"{len(df)} CV traité(s)")
    # Colonne de liens : LinkColumn rend l'URL cliquable (ouverture dans un nouvel onglet).
    # display_text (regex) n'affiche que le code consultant au lieu de l'URL complète.
    st.dataframe(
        df,
        width='stretch',
        hide_index=True,
        column_config={
            "Lien CV anonymisé": st.column_config.LinkColumn(
                "CV anonymisé", display_text=r"code=(.*)"
            )
        },
    )


# --------------------------------------------------------------------------
# Page
# --------------------------------------------------------------------------
st.set_page_config(page_title="Anonymisation de CV", page_icon="📄", layout="wide")
st.title("Anonymisation de CV")
tab1, tab2 = st.tabs(["Anonymiser", "Registre"])
with tab1:
    onglet_anonymiser()
with tab2:
    onglet_registre()
