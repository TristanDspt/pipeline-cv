# Pipeline d'anonymisation de CV (n8n)

Projet de la semaine, formation Dev IA (GRETA). Société fictive : **Fil Rouge Consulting**.

Un consultant dépose son CV (PDF ou DOCX, texte ou scanné). Le pipeline produit **deux sorties** à partir d'une seule entrée :

1. **Un CV anonymisé en PDF**, présentable à un client, sans aucune donnée d'identité.
2. **Une ligne dans un registre interne** (table n8n + export Excel), qui relie un code pseudonyme `CONS-XXXXXX` à l'identité réelle du consultant.

Le code `CONS-XXXXXX` est le seul lien entre les deux. Le client voit le code, l'ESN seule sait à qui il correspond.

**Les modèles tournent en local** (Ollama sur carte graphique) : les CV ne sont plus envoyés à une API cloud. Voir la section [Modèle local](#modèle-local-ollama).

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
Texte ? (plus de 200 caractères extraits)
   ├─ oui ─────────────────────────────────────────┐
   └─ non (CV scanné)                              │
        ▼                                          │
   PDF → images PNG (service pdf-images)           │
        ▼                                          │
   1 page = 1 appel au modèle vision (Ollama)      │
        ▼                                          │
   Pages recollées en un seul texte                │
        ▼◄─────────────────────────────────────────┘
IA ① Extraction des infos (identité + profil)        Ollama, température 0
   ▼
Préparer le dossier (code CONS-XXXXXX, séparation identité / profil)
   ▼
IA ② Rédaction du CV anonymisé (sans identité)       Ollama, température 0
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
| Ollama (hors Docker, sur la machine) | exécute le modèle `ministral-3:14b` sur le GPU : extraction (IA ①), rédaction (IA ②) et lecture des CV scannés (vision) |
| `pdf-images` (service Python, Docker) | convertit un PDF en une image PNG par page, en mémoire, sans rien écrire sur disque |
| Nœuds Code (JavaScript) | contrôle RGPD, mise en page, ligne du registre, colonnes Excel |

---

## Installation

Prérequis : Docker et Docker Compose, **Ollama** installé sur la machine, une carte graphique avec ~12 Go de VRAM libres (testé sur une RX 7800 XT 16 Go).

### 1. Ollama et le modèle

1. Installer Ollama (https://ollama.com/download).
2. Télécharger le modèle (~9 Go) :
   ```bash
   ollama pull ministral-3:14b
   ```
3. Vérifier que le GPU est utilisé : après un prompt, `ollama ps` doit afficher `100% GPU`.
4. Ollama doit être **démarré** avant de lancer le pipeline.

### 2. Le pipeline

1. Cloner le dépôt, puis lancer :
   ```bash
   docker compose up -d --build
   ```
   Le premier démarrage construit l'image du service `pdf-images`.
2. Ouvrir n8n sur `http://localhost:5678` et créer le compte local.
3. Importer le workflow (`pipeline_cv_ollama.json`).
4. Créer l'identifiant **Ollama** dans n8n avec comme Base URL `http://host.docker.internal:11434` (aucune clé nécessaire) et l'associer aux trois nœuds Ollama : IA ①, IA ② et « Transcrire la page ».
5. Sur ces trois nœuds, régler **exactement les mêmes options** : température `0`, contexte `18000`, keep-alive `30m` (voir plus bas pourquoi).
6. Ouvrir le formulaire de test, déposer un CV.

Dans le `docker-compose.yml` : `./sorties` est monté sur `/files` (PDF et Excel y sont écrits, n8n ne peut écrire que là), et `pdf-images` n'a **ni port publié ni volume** : il ne voit ni le registre ni les CV anonymisés. n8n joint Ollama via `host.docker.internal`.

La table `registre_consultants` est **créée automatiquement** au premier passage : rien à faire à la main.

---

## Modèle local (Ollama)

### Configuration retenue

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Modèle | `ministral-3:14b` (quantification Q4_K_M, ~9 Go) | tient dans 16 Go de VRAM, accepte les images |
| Température | `0` | sorties reproductibles |
| Contexte (`num_ctx`) | `18000` | le défaut d'Ollama (4 096) est plus petit que le prompt de l'IA ② : **le début du prompt serait tronqué sans erreur** |
| Keep-alive | `30m` | évite de recharger le modèle (~70 s) entre deux CV |

**À régler à l'identique sur tous les nœuds Ollama.** Si deux nœuds demandent des contextes différents, Ollama décharge puis recharge le modèle entre les deux appels, et chaque rechargement coûte ~70 s.

La limite de sortie (nombre maximal de tokens) est un plafond de génération, pas la taille du contexte : le contexte couvre le prompt **et** la réponse.

### Mesures (machine : RX 7800 XT 16 Go, Windows 10)

| Mesure | Résultat |
|---|---|
| Occupation GPU | 100 % GPU, ~11 Go de VRAM avec un contexte de 18 000 |
| Vitesse de génération | ~45 tokens/s |
| Chargement à froid (première requête) | ~70 s, une seule fois par session |
| CV texte (3 runs) | ~2 min par CV |
| CV scanné, 1 page (3 runs, même CV) | ~2 min 56, soit **environ +55 s** par rapport à la version texte du même CV |

Les runs d'une même série varient de moins de 10 s, et les sorties sont **identiques d'un run à l'autre** (température 0).

### Branche « CV scanné »

Un PDF dont le texte extrait fait moins de 200 caractères est traité comme un scan :

1. le service `pdf-images` rend chaque page en PNG (150 dpi, plus grand côté limité à 1 800 px, 12 pages maximum, 20 Mo maximum) ;
2. le modèle vision transcrit chaque page séparément (prompt : transcription fidèle, sans résumé ni correction) ;
3. les transcriptions sont recollées dans l'ordre, puis le flux rejoint l'extraction (IA ①) comme un CV texte.

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
- **Les CV ne quittent plus la machine** : l'extraction, la rédaction et la lecture des CV scannés passent par Ollama en local.- Techniquement, côté ESN, c'est de la **pseudonymisation** (réidentification possible via le registre) ; côté client, le document est anonymisé.

---

## Limites connues

Ce sont des limites assumées pour un projet de cours. Elles sont documentées pour qu'on sache où le pipeline est fiable et où il demande une relecture.

**Qualité du LLM (ministral 14B, quantifié en 4 bits en local)**
- L'accroche (IA ②), seul texte libre, a tendance à embellir : adjectifs creux, liens de cause, **pourcentages inventés** (un « 75 % » est apparu dans nos PDF de test). Le contrôle **détecte** le pourcentage (alerte « à relire ») mais **ne le retire pas** du PDF. Les champs structurés (compétences, expériences) sont fiables sur nos tests. D'où la relecture humaine de l'accroche et le filet de code.
- Les formes inclusives avec point médian (« Consultant·e confirmé·e ») ne sont **pas neutralisées** par le code.

**Contrôle RGPD**
- Seuls les **pourcentages** inventés sont détectés, pas les années ou autres chiffres.
- Le compteur `alertes_rgpd` **mélange** masquages réels et corrections de style (pronoms, tailles d'entreprise). Il dit « le code est intervenu », pas « il y avait une fuite ».
- La liste des termes à masquer vient de ce que l'extraction a lu. Si une **faute de transcription** touche un nom propre (cas observé une fois : un nom propre transcrit avec une lettre de trop sur un CV scanné), le terme masqué n'est pas le bon. Sur nos tests, aucun nom n'a fuité dans le PDF final, mais **un CV scanné demande une relecture plus attentive**.

**Extraction**
- Un **CV scanné** est lu par le modèle vision : bonne transcription sur nos tests, mais **non garantie**. Testé sur **un seul CV d'une page** ; les scans de mauvaise qualité (photo, penchés) ne sont pas testés. La branche est aussi plus lente (environ +55 s) et limitée à 12 pages.

**Matériel et exploitation**
- Il faut **Ollama lancé** et ~12 Go de VRAM libres. La **première requête** après 30 min d'inactivité paie le chargement du modèle (~70 s).
- ~2 min par CV : plus lent qu'une API cloud, c'est le prix de la confidentialité.

**Registre et mise en page**
- La date de traitement est stockée en **texte** (`dd/MM/yyyy`), pas en type date.
- L'adaptation de la police à la longueur du CV est une heuristique : un CV de 9 expériences ou plus passe sur 2 pages.
- Si `registre_consultants.xlsx` est ouvert dans Excel, l'écriture échoue (verrou Windows). L'erreur est capturée par la sortie erreur du nœud, le reste du pipeline continue.
- **Aucune contrainte d'unicité sur la clé du registre** : la table n'empêche pas deux lignes avec le même code consultant, ni un même CV déposé deux fois (deux lignes). Aucun garde-fou en base, et aucun dédoublonnage dans le workflow.

---

## Pistes d'amélioration

- Ajouter une contrainte d'unicité sur le registre.
- Mesurer le temps par nœud de la branche scannée, la tester sur plus de CV (qualités variées) et comparer à un OCR classique (Tesseract).
- Faire **retirer** par le contrôle les pourcentages inventés au lieu de les signaler, et séparer le compteur d'alertes (fuites évitées / corrections de style).
- Modèle plus gros pour l'IA ② ou second appel IA de vérification de l'accroche.
