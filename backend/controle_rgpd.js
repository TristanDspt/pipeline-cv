// ═══════════════════════════════════════════════════════════════════════
//  Nœud Code « Contrôle RGPD » : mode « Run Once for Each Item »
//  Rôle : filet de sécurité SANS IA, après la rédaction par l'IA ②.
//   1. masque les termes identifiants connus (nom, ville, employeurs, écoles…)
//   2. remplace les pronoms genrés par « ce profil »
//   3. calcule les tailles d'entreprise (l'IA ne les décide pas)
//   4. signale les pourcentages absents du CV
//   5. liste tout ce qui a été corrigé dans alertes_rgpd
// ═══════════════════════════════════════════════════════════════════════

// ─── Outil : échapper les caractères spéciaux d'un terme avant de le mettre
//     dans un regex (équivalent de re.escape en Python).
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── 1. MASQUER : remplace chaque terme interdit par [confidentiel] ─────
// Renvoie [texte nettoyé, liste des termes trouvés]
function masquer(texte, termes) {
  const trouves = [];
  for (const terme of termes) {
    // Mot entier uniquement : « Tours » ne doit pas matcher dans « retours ».
    // \p{L}\p{N} + flag u : lettres et chiffres accents compris.
    // Flags : g = remplacer partout, i = insensible à la casse, u = unicode.
    const motif = new RegExp(
      `(?<![\\p{L}\\p{N}_])${echapper(terme)}(?![\\p{L}\\p{N}_])`,
      'giu'
    );
    if (texte.search(motif) !== -1) {            // -1 = pas trouvé
      trouves.push(terme);
      texte = texte.replace(motif, '[confidentiel]');
    }
  }
  return [texte, trouves];
}

// ─── 2. NEUTRALISER : pronoms genrés → « ce profil » ────────────────────
function neutraliser(texte) {
  return texte
    // « il·elle », « il/elle », « elle/il » → « ce profil »
    .replace(/(?<![\p{L}])(il\s*[·\/.]\s*elle|elle\s*[·\/.]\s*il)(?![\p{L}])/giu, 'ce profil')
    // « Il a conçu… » en début de phrase → « Ce profil a conçu… »
    .replace(/(^|[.!?]\s+)(Il|Elle)\s/gu, (_, debut) => `${debut}Ce profil `)
    // « …, il maîtrise » après une virgule ou un point-virgule
    .replace(/([,;]\s+)(il|elle)\s/gu, (_, debut) => `${debut}ce profil `);
}

// ─── 3. PARCOURIR : applique le contrôle à TOUT le JSON de l'IA ─────────
// Récursif : texte → on nettoie ; liste ou objet → on redescend ; reste → inchangé.
// `alertes` est une liste partagée : chaque appel y ajoute ses trouvailles.
function parcourir(valeur, termes, alertes) {
  if (typeof valeur === 'string') {
    const [texteMasque, mots] = masquer(valeur, termes);
    alertes.push(...mots);
    const texteNeutre = neutraliser(texteMasque);
    if (texteNeutre !== texteMasque) alertes.push('pronom genré → « ce profil »');
    return texteNeutre;
  } else if (Array.isArray(valeur)) {
    return valeur.map((x) => parcourir(x, termes, alertes));
  } else if (valeur !== null && typeof valeur === 'object') {
    return Object.fromEntries(
      Object.entries(valeur).map(([k, v]) => [k, parcourir(v, termes, alertes)])
    );
  } else {
    return valeur;
  }
}

// ─── 4. LISTE DES TERMES INTERDITS ──────────────────────────────────────
// Ajoute un terme s'il est assez long (≥ 3 lettres) et pas déjà présent.
function ajouterSiValide(termes, valeur) {
  if (typeof valeur === 'string') {
    valeur = valeur.trim();
    if (valeur.length >= 3 && !termes.includes(valeur)) termes.push(valeur);
  }
}

// Les termes viennent de « Préparer le dossier » :
// toute l'identité + employeurs, lieux et écoles du profil.
function construireTermes(identite, profil) {
  const termes = [];
  for (const v of Object.values(identite).flat()) ajouterSiValide(termes, v);

  for (const exp of profil.experiences ?? []) {
    for (const champ of ['entreprise', 'lieu']) {
      ajouterSiValide(termes, exp[champ] ?? '');
    }
    // « Nom (SIGLE) » → on protège aussi « Nom » et « SIGLE » séparément.
    const m = (exp.entreprise ?? '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (m) { ajouterSiValide(termes, m[1]); ajouterSiValide(termes, m[2]); }
  }

  for (const f of profil.formations ?? []) {
    ajouterSiValide(termes, f.etablissement ?? '');
  }
  return termes;
}

// ─── 5. TAILLE D'ENTREPRISE : calculée par le code, jamais par l'IA ─────
const TRANCHES = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const millier = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Lit un effectif (« 2 300 collaborateurs », « 180 salariés ») → tranche, ou null
function tailleOfficielle(description) {
  const m = String(description ?? '').match(/(\d[\d\s\u00a0\u202f]*)\s*(salariés|collaborateurs|employés)/i);
  if (!m) return null;                                        // pas d'effectif → pas de taille
  const n = Number(m[1].replace(/\D/g, ''));
  const t = [...TRANCHES].reverse().find((x) => x <= n);      // plus haute tranche ≤ n
  return t ? `${millier(t)}+ collaborateurs` : null;
}

// ─── 6. POURCENTAGES INVENTÉS : tout « N % » de l'accroche absent du CV est signalé ───
function signalerPourcentages(accroche, profil, alertes) {
  const source = JSON.stringify(profil ?? {}).replace(/[\s\u00a0\u202f]/g, '');
  for (const p of String(accroche ?? '').match(/\d+(?:[.,]\d+)?\s*%/g) ?? []) {
    if (!source.includes(p.replace(/[\s\u00a0\u202f]/g, ''))) {
      alertes.push(`pourcentage absent du CV : ${p} (à relire)`);
    }
  }
}

// ─── 7. PROGRAMME PRINCIPAL ─────────────────────────────────────────────
// Le dossier (code CONS, identité, profil) vient de « Préparer le dossier »,
// lu par son nom. La sortie de l'IA ② arrive par le fil : $json.output.
const dossier = $('Préparer le dossier').first().json;
const brouillon = $json.output;
const sources = dossier.profil?.experiences ?? [];

const termes = construireTermes(dossier.identite ?? {}, dossier.profil ?? {});
const alertes = [];
const propre = parcourir(brouillon, termes, alertes);

// Secteur : on garde le mot choisi par l'IA, la taille vient du code.
// Les expériences gardent leur ordre : on vérifie que le nombre colle.
if ((propre.experiences ?? []).length === sources.length) {
  propre.experiences.forEach((e, i) => {
    if (typeof e.secteur !== 'string') return;
    const secteurSeul = e.secteur.replace(/\s*[(,].*$/, '').trim();   // avant « ( » ou « , »
    const taille = tailleOfficielle(sources[i].description_entreprise);
    const nouveau = taille ? `${secteurSeul} (${taille})` : secteurSeul;
    if (nouveau !== e.secteur) alertes.push(`secteur corrigé : « ${e.secteur} » → « ${nouveau} »`);
    e.secteur = nouveau;
  });
}

// Pourcentages de l'accroche absents du CV d'origine
signalerPourcentages(propre.accroche, dossier.profil, alertes);

return {
  json: {
    ...dossier,                              // on garde code_consultant, identite, profil
    cv_anonyme: propre,                      // le CV nettoyé, prêt pour la mise en page
    alertes_rgpd: [...new Set(alertes)],     // tout ce qui a été corrigé, sans doublons
  },
};