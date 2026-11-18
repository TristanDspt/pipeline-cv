// ═══════════════════════════════════════════════════════════════════════
//  Nœud Code « Mise en page HTML » : mode « Run Once for Each Item »
//  Rôle : transformer le CV anonymisé (JSON) en page HTML prête pour Gotenberg.
//  Palette C : bordeaux #8C2F39 + ardoise #334155
//  Densité dynamique : le code ESTIME la hauteur du CV (en lignes) et choisit
//  la plus grande taille de police qui tient sur une page A4.
//  Toute section sans donnée est supprimée (pas de titre orphelin).
// ═══════════════════════════════════════════════════════════════════════
const NOM_SOCIETE = 'Fil Rouge Consulting';

// ── Réglages de la densité (à ajuster après tests) ─────────────────────
const HAUTEUR_MAX = 1050;  // hauteur max estimée (px) pour tenir sur 1 page A4
const NB_PALIERS = 9;      // nombre de tailles possibles entre « compact » et « aéré »

const cv = $json.cv_anonyme;
const code = $json.code_consultant;

// Échappe les caractères HTML (sécurité + affichage correct)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Une liste est « pleine » si elle a au moins un élément
const pleine = (liste) => Array.isArray(liste) && liste.length > 0;

// ── Estimation de la hauteur du CV pour une taille de police donnée ───
// n = { fs: taille en pt, lh: interligne, gap: espace entre blocs en px }
const lignes = (texte, parLigne) => Math.max(1, Math.ceil(String(texte ?? '').length / parLigne));

function estimerHauteur(c, n) {
  const px = (n.fs * 4) / 3;                  // pt → px
  const ligne = px * n.lh;                    // hauteur d'une ligne de texte
  const parLigne = 112 * (10 / n.fs);         // caractères par ligne (plus la police grossit, moins il y en a)
  const titre = n.gap * 2.2 + 5 + 14 * n.lh;  // un titre de section (marges + filet + texte)
  let h = 65;                                 // bandeau + sous-titre

  // Profil
  h += titre + lignes(c.accroche, parLigne - 4) * (((n.fs + 0.5) * 4 / 3) * n.lh) + 33;

  // Bulles de compétences (retour à la ligne estimé selon la largeur)
  const bulles = (liste) => {
    if (!pleine(liste)) return 0;
    let x = 0, rangees = 1;
    for (const b of liste) {
      const w = String(b).length * 5.9 + 28;
      if (x + w > 720) { rangees++; x = 0; }
      x += w;
    }
    return titre + rangees * 28;
  };
  h += bulles(c.competences_techniques) + bulles(c.competences_transverses);

  // Expériences
  h += titre;
  for (const e of c.experiences ?? []) {
    h += ligne + 6;
    for (const m of e.missions ?? []) h += lignes(m, parLigne - 3) * ligne;
    if (e.environnement) h += 3 + 12 * n.lh;
    h += n.gap;
  }

  // Formation
  h += titre + 6 + (c.formations ?? []).length * ligne;

  // Langues | Certifications (côte à côte : on prend la plus haute)
  const colonne = (liste) => (liste ?? []).reduce((s, x) => s + lignes(x, parLigne / 2 - 4), 0);
  const duo = Math.max(colonne(c.langues), colonne(c.certifications));
  if (duo > 0) h += titre + 6 + duo * ligne;

  // Pied de page
  h += n.gap * 1.2 + 8 + 1 + 15;
  return h;
}

// Palier t entre 0 (compact) et 1 (aéré) → taille de police, interligne, espaces
const palier = (t) => ({ fs: 9.25 + t * 1.5, lh: 1.26 + t * 0.26, gap: 6 + t * 10 });

// On prend le plus grand palier qui tient sur une page (sinon le plus petit)
let d = palier(0);
for (let i = NB_PALIERS - 1; i >= 0; i--) {
  const candidat = palier(i / (NB_PALIERS - 1));
  if (estimerHauteur(cv, candidat) <= HAUTEUR_MAX) { d = candidat; break; }
}
const hauteurEstimee = Math.round(estimerHauteur(cv, d));

const bulles = (liste, classe = '') =>
  (liste ?? []).map((x) => `<span class="bulle ${classe}">${esc(x)}</span>`).join('');

const puces = (liste) => (liste ?? []).map((x) => `<li>${esc(x)}</li>`).join('');

// Section standard : titre + contenu (rien si le contenu est vide)
const section = (titre, contenu, classe = '') =>
  contenu ? `<section class="${classe}"><h2>${esc(titre)}</h2>${contenu}</section>` : '';

// Section de bulles : n'existe que si la liste a des éléments
const sectionBulles = (titre, liste, classeBulle = '') =>
  pleine(liste)
    ? section(titre, `<div class="bulles">${bulles(liste, classeBulle)}</div>`, 'comp')
    : '';

// Une colonne (titre + liste), vide si pas de données
const colonne = (titre, liste) =>
  pleine(liste) ? `<div><h2>${esc(titre)}</h2><ul>${puces(liste)}</ul></div>` : '';

const experiences = (cv.experiences ?? []).map((e) => `
  <div class="exp">
    <div class="exp-tete">
      <div><span class="poste">${esc(e.poste)}</span><span class="secteur"> · ${esc(e.secteur)}</span></div>
      <div class="periode">${esc(e.periode)}</div>
    </div>
    <ul>${puces(e.missions)}</ul>
    ${e.environnement ? `<p class="env"><b>Environnement :</b> ${esc(e.environnement)}</p>` : ''}
  </div>`).join('');

// Formation : diplôme, type d'établissement, année
const formations = (cv.formations ?? []).map((f) =>
  `<li><b>${esc(f.diplome)}</b> — ${esc(f.etablissement_type)}, ${esc(f.annee)}</li>`).join('');

// Langues | Certifications côte à côte (pleine largeur si une seule des deux existe)
const duo = [
  colonne('Langues', cv.langues),
  colonne('Certifications', cv.certifications),
].filter(Boolean);

const css = `
@page { size: A4; margin: 14mm 0 8mm; }
@page :first { margin-top: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: ${d.fs}pt; line-height: ${d.lh}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* Bandeau du haut : société (+ sous-titre) à gauche, référence à droite */
.bandeau { background: #8C2F39; color: #fff; padding: 18px 36px; display: flex; justify-content: space-between; align-items: center; }
.bandeau .societe { font-size: 17pt; font-weight: 700; letter-spacing: .5px; }
.bandeau .dossier { font-size: 8pt; text-transform: uppercase; letter-spacing: 1.5px; opacity: .85; margin-top: 3px; }
.bandeau .ref { text-align: right; }
.bandeau .ref-titre { font-size: 8.5pt; opacity: .85; }
.bandeau .ref-code { font-size: 18pt; font-weight: 700; letter-spacing: 1px; }

.sous-titre { background: #E7ECF1; color: #334155; padding: 10px 36px; font-weight: 700; display: flex; justify-content: space-between; }
.contenu { padding: 4px 36px 0; }

section { break-inside: avoid; }
section.longue { break-inside: auto; }
h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .6px; color: #8C2F39; border-bottom: 2px solid #8C2F39; padding-bottom: 3px; margin: ${d.gap * 1.5}px 0 ${d.gap * 0.7}px; break-after: avoid; }

/* Profil : fond bordeaux très clair + liseré à gauche + mention IA en bas à droite */
.profil { background: #F5E6E8; border-left: 4px solid #8C2F39; padding: 10px 14px 6px; }
.accroche { margin: 0; font-size: ${d.fs + 0.5}pt; }
.mention-ia { margin: 4px 0 0; text-align: right; font-size: 7.5pt; font-style: italic; color: #6B2029; }

/* Compétences : fond blanc, bulles centrées, deux sections */
section.comp h2 { text-align: center; }
.bulles { text-align: center; }
.bulle { display: inline-block; background: #F5E6E8; color: #6B2029; border-radius: 12px; padding: 3px 10px; margin: 0 4px 6px; font-size: 9pt; }
.bulle.soft { background: #E7ECF1; color: #334155; }

.exp { margin-bottom: ${d.gap}px; break-inside: avoid; }
.exp-tete { display: flex; justify-content: space-between; }
.poste { font-weight: 700; }
.secteur, .periode { color: #4b5563; }
.periode { white-space: nowrap; }
ul { margin: 3px 0 3px 18px; padding: 0; }
li { break-inside: avoid; }
.env { margin: 3px 0 0; color: #4b5563; font-size: 9pt; }

/* Fin de page : Langues | Certifications + pied de page, jamais séparés */
.fin { break-inside: avoid; }
.duo { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
.duo.seul { grid-template-columns: 1fr; }

/* Pied de page : séparateur + mention officielle, à droite */
.pied { margin: ${d.gap * 1.2}px 0 0; padding-top: 8px; border-top: 1px solid #d1d5db; text-align: right; color: #6b7280; font-size: 8pt; }
`;

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${esc(code)}</title>
<style>${css}</style>
</head>
<body>
  <div class="bandeau">
    <div>
      <div class="societe">${esc(NOM_SOCIETE)}</div>
      <div class="dossier">Dossier de compétences</div>
    </div>
    <div class="ref">
      <div class="ref-titre">Réf. consultant</div>
      <div class="ref-code">${esc(code)}</div>
    </div>
  </div>
  <div class="sous-titre">
    <div>${esc(cv.titre)}</div>
    <div>${cv.annees_experience ? `${esc(cv.annees_experience)} ans d'expérience` : ''}</div>
  </div>
  <div class="contenu">
    ${cv.accroche ? section('Profil', `<div class="profil"><p class="accroche">${esc(cv.accroche)}</p><p class="mention-ia">Synthèse rédigée par IA à partir du CV</p></div>`) : ''}
    ${sectionBulles('Compétences techniques', cv.competences_techniques)}
    ${sectionBulles('Compétences transverses', cv.competences_transverses, 'soft')}
    ${section('Expériences', experiences, 'longue')}
    ${section('Formation', formations ? `<ul>${formations}</ul>` : '')}
    <div class="fin">
      ${duo.length ? `<section class="duo ${duo.length === 1 ? 'seul' : ''}">${duo.join('')}</section>` : ''}
      <p class="pied">Document confidentiel — CV anonymisé conformément au RGPD — ${esc(NOM_SOCIETE)} · Réf. ${esc(code)}</p>
    </div>
  </div>
</body>
</html>`;

return { json: { ...$json, html, mise_en_page: { police_pt: Math.round(d.fs * 100) / 100, hauteur_estimee: hauteurEstimee } } };