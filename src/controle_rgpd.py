# controle_rgpd.py

import re

# ───────────────────────────────────────────────────────────────────────────────

def masquer(texte, termes):
    trouves = []
    for terme in termes:
        motif = re.compile(rf"(?<!\w){re.escape(terme)}(?!\w)", re.IGNORECASE)
        if motif.search(texte):
            trouves.append(terme)
            texte = motif.sub("[confidentiel]", texte)
    return texte, trouves


def parcourir(valeur, termes, alertes):
    if isinstance(valeur, str):
        texte_masque, mot = masquer(valeur, termes)
        alertes.extend(mot)
        return texte_masque
    elif isinstance(valeur, list):
        return [parcourir(x, termes, alertes) for x in valeur]
    elif isinstance(valeur, dict):
        return {k: parcourir(v, termes, alertes) for k, v in valeur.items()}
    else:
        return valeur


def ajouter_si_valide(termes, valeur):
    if isinstance(valeur, str):
        valeur = valeur.strip()
        if len(valeur) >= 3 and valeur not in termes:
            termes.append(valeur)


def construire_termes(identite, profil):
    termes = []
    for v in identite.values():
        ajouter_si_valide(termes, v)
    for exp in profil.get("experiences", []):
        for champ in ("entreprise", "lieu"):
            ajouter_si_valide(termes, exp.get(champ, ""))
    for f in profil.get("formations", []):
        ajouter_si_valide(termes, f.get("etablissement", ""))
    return termes

# ───────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    identite = {"prenom": "Camille", "nom": "ROUSSEAU", "email": "camille.rousseau@example.com",
            "telephone": "06 39 98 41 27", "adresse": "12 rue des Tilleuls",
            "ville": "Besançon", "code_postal": "25000"}
    profil = {"experiences": [{"entreprise": "Banque Comtoise de Crédit", "lieu": "Besançon"},
                            {"entreprise": "Horlogerie Vauclair Industries", "lieu": "Morteau"}],
            "formations": [{"etablissement": "Université de Franche-Comté"}]}

    print(construire_termes(identite, profil))
    