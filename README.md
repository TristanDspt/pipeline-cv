# Pipeline d'anonymisation de CV (n8n)

Projet de la semaine, formation Dev IA (GRETA). Société fictive : **Fil Rouge Consulting**.

Un consultant dépose son CV (PDF ou DOCX). Le pipeline produit **deux sorties** à partir d'une seule entrée :

1. **Un CV anonymisé en PDF**, présentable à un client, sans aucune donnée d'identité.
2. **Une ligne dans un registre interne** (table n8n + export Excel), qui relie un code pseudonyme `CONS-XXXXXX` à l'identité réelle du consultant.

Le code `CONS-XXXXXX` est le seul lien entre les deux. Le client voit le code, l'ESN seule sait à qui il correspond.

---

## Principe : « l'IA propose, le code garantit »

Un LLM est utile pour lire un CV non structuré et rédiger une synthèse, mais il est non déterministe et il se trompe. On ne lui fait donc jamais confiance sur ce qui touche au RGPD :

- l'IA extrait et rédige ;
- un **nœud Code déterministe** (`Contrôle RGPD`) vérifie et corrige le résultat : masquage des termes d'identité, neutralisation des pronoms genrés, tailles d'entreprise remplacées par des fourchettes calculées, détection des pourcentages absents du CV d'origine ;
- tout ce que le code a dû rattraper est compté dans `alertes_rgpd`, pour relecture humaine.

---

## Architecture

```
Formulaire (dépôt du CV)
   │
   ├─ PDF ? ── non ──► DOCX → PDF (Gotenberg, LibreOffice)
   │                          │
   ▼◄─────────────────────────┘
Extract from PDF (texte brut)
   ▼
IA ① Extraction des infos (identité + profil)        Mistral, température 0
   ▼
Préparer le dossier (code CONS-XXXXXX, séparation identité / profil)
   ▼
IA ② Rédaction du CV anonymisé (sans identité)       Mistral, température 0
   ▼
Contrôle RGPD (Code)  ──►  alertes_rgpd
   ▼
Mise en page HTML (Code, densité adaptative)
   ├──► HTML → fichier → Gotenberg (Chromium) → PDF → sorties/CONS-XXXXXX.pdf
   └──► Crée la table (si absente) → Ligne du registre → Insérer la ligne
                                        → Lire le registre → Colonnes Excel
                                        → Convert to File → sorties/registre_consultants.xlsx
```

Séparation importante : l'IA ② ne reçoit **jamais** l'identité. Elle ne voit que le profil. L'identité reste dans un champ à part, utilisée uniquement par le registre et par la liste des termes à masquer.

### Briques

| Brique | Rôle |
|---|---|
| n8n 2.x (Docker) | orchestration, formulaire, Data table |
| Gotenberg | conversion DOCX → PDF (LibreOffice) et HTML → PDF (Chromium) |
| Mistral (`ministral-14b-2512`) | extraction (IA ①) et rédaction (IA ②) |
| Nœuds Code (JavaScript) | contrôle RGPD, mise en page, ligne du registre, colonnes Excel |

---

## Installation

Prérequis : Docker et Docker Compose.

1. Cloner le dépôt, puis lancer :
   ```bash
   docker compose up -d
   ```
2. Ouvrir n8n sur `http://localhost:5678` et créer le compte local.
3. Importer le workflow (`pipeline_cv.json`).
4. Créer l'identifiant **Mistral Cloud** dans n8n avec **ta propre clé API** et l'associer aux deux modèles (IA ① et IA ②). La clé n'est jamais dans le dépôt.
5. Ouvrir le formulaire de test, déposer un CV.

Points à connaître dans le `docker-compose.yml` :

- `./sorties` est monté dans le conteneur sur `/files` : c'est là que sont écrits les PDF et le fichier Excel ;
- `N8N_RESTRICT_FILE_ACCESS_TO=/files` limite les écritures de n8n à ce dossier ;
- Gotenberg est joignable depuis n8n sur `http://gotenberg:3000`.

La table `registre_consultants` est **créée automatiquement** au premier passage (nœud « Crée la table », option *Reuse existing table* activée). Rien à faire à la main, ce qui permet de tester le pipeline de bout en bout sur une installation vierge.

---

## Sorties

### CV anonymisé (`sorties/CONS-XXXXXX.pdf`)

- 1 page A4, bandeau société + référence consultant, synthèse, compétences, expériences, formations ;
- mention « Synthèse rédigée par IA » sous le profil ;
- pas de date sur le document ;
- la **densité s'adapte au contenu** : un CV court est aéré (police plus grande, plus d'espace), un CV dense est resserré (jusqu'à 9,25 pt). L'estimation de hauteur est une heuristique, voir limites.

### Registre interne (table n8n + `sorties/registre_consultants.xlsx`)

Une ligne par CV traité. Colonnes : code consultant, date de traitement, prénom, nom, e-mail, téléphone, adresse, liens, poste, années d'expérience, compétences, lien du CV anonymisé, fichier source, alertes RGPD.

Normalisation faite **par le code** (pas par l'IA) : prénom capitalisé, NOM en majuscules, e-mail en minuscules.

Le fichier Excel est régénéré à chaque passage à partir de **toute** la table, il contient donc tous les CV déjà traités.

---

## RGPD

- Le **CV client** ne contient aucune donnée d'identité : nom, prénom, e-mail, téléphone, adresse et liens sont masqués par le code, pas seulement par l'IA.
- Le **registre** contient les identités réelles. C'est volontaire (il faut pouvoir retrouver le consultant), mais il reste **local** : il ne doit jamais être publié ni commité.
- Le code consultant est aléatoire. Un même CV déposé deux fois donne deux codes et deux lignes.
- Techniquement, côté ESN, c'est de la **pseudonymisation** (réidentification possible via le registre) ; côté client, le document est anonymisé.
- La date de traitement est conservée dans le registre pour la traçabilité et la durée de conservation.

### Avant de partager le projet (dépôt, démo, soutenance)

- [ ] `sorties/` est dans le `.gitignore`
- [ ] aucune donnée **épinglée** (Pin) dans le workflow avant export
- [ ] historique des exécutions n8n vidé (il contient les CV réels en clair)
- [ ] table `registre_consultants` vidée ou supprimée
- [ ] aucune clé API dans le JSON exporté ni dans le dépôt

---

## Limites connues

Ce sont des limites assumées pour un projet de cours. Elles sont documentées pour qu'on sache où le pipeline est fiable et où il demande une relecture.

**Qualité du LLM (ministral 14B)**
- L'accroche (IA ②), seul texte libre, a tendance à embellir : adjectifs creux, liens de cause, **pourcentages inventés** (« 75 % », « 80 % »). Les champs structurés (compétences, expériences) sont fiables sur nos tests. D'où la relecture humaine de l'accroche et le filet de code.
- Les **formations peuvent être brodées** : dates inventées, diplôme omis (un BTS a disparu sur un de nos CV de test).
- Le **secteur peut être mal classé** (« Industrie » pour du bâtiment).
- Un CV qui place une **reconversion dans les expériences** perd l'IA, qui peut classer le profil dans un mauvais secteur (cas observé : « Transport / logistique »).
- Les formes inclusives avec point médian (« Consultant·e confirmé·e ») ne sont **pas neutralisées** par le code.

**Contrôle RGPD**
- Seuls les **pourcentages** inventés sont détectés, pas les années ou autres chiffres.
- Les variantes typographiques (apostrophes droites / courbes) ne sont pas toutes couvertes.
- Le compteur `alertes_rgpd` **mélange** masquages réels et corrections de style (pronoms, tailles d'entreprise). Il dit « le code est intervenu », pas « il y avait une fuite ».

**Extraction**
- Les **liens LinkedIn / GitHub sortent vides** si le CV affiche juste un mot cliquable : l'URL est dans l'annotation du lien, pas dans le texte extrait du PDF. Ça ne marche que si l'URL est écrite en clair. Ils sont aussi absents du schéma d'exemple de l'IA ① tant qu'on ne les y ajoute pas.
- Un **CV scanné** (image) n'a pas de texte extractible : cas à traiter, pas de rendu fiable aujourd'hui.

**Mise en page**
- L'estimation de hauteur (adaptation de la police) est une heuristique, précision d'environ ±3 %. Un CV de 9 expériences ou plus passe sur 2 pages.

**Registre et fichiers**
- La date de traitement est stockée en **texte** (`dd/MM/yyyy`), pas en type date.
- Si `registre_consultants.xlsx` est ouvert dans Excel, l'écriture échoue (verrou Windows). L'erreur est capturée par la sortie erreur du nœud, le reste du pipeline continue.
- Pas de dédoublonnage : un même CV déposé deux fois crée deux lignes.

---

## Pistes d'amélioration

- Modèle plus gros pour l'IA ② ou second appel IA de vérification de l'accroche.
- Mesurer la stabilité : lancer 5 fois chaque CV de test et comparer.
- Modèle local (Ollama, ministral sur GPU) pour que les CV réels ne quittent jamais la machine.
- Étendre la détection d'invention aux années, neutraliser les formes inclusives, séparer le compteur d'alertes (fuites évitées / corrections de style).
