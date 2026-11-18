// Adresse n8n
const URL_N8N = 'http://localhost:5678';

const d = $('Mise en page HTML').first().json;
const identite = d.identite ?? {};
const cv = d.cv_anonyme ?? {};
const alertes = d.alertes_rgpd ?? [];

// "jean-pierre" -> "Jean-Pierre" ; "d'artagnan" -> "D'Artagnan"
const capitaliser = (s) =>
  (s ?? '').trim().toLocaleLowerCase('fr')
    .replace(/(^|[\s'’-])(\p{L})/gu, (m, sep, lettre) => sep + lettre.toLocaleUpperCase('fr'));

// Une alerte peut être un texte ou un objet : on gère les deux
const alerteEnTexte = (a) => (typeof a === 'string' ? a : JSON.stringify(a));

return {
  json: {
    code_consultant: d.code_consultant,
    date_traitement: $now.toFormat('dd/MM/yyyy'),
    prenom: capitaliser(identite.prenom),
    nom: (identite.nom ?? '').trim().toLocaleUpperCase('fr'),
    email: (identite.email ?? '').trim().toLowerCase(),
    telephone: identite.telephone ?? '',
    adresse: identite.adresse || identite.ville || '',
    liens: [identite.linkedin, ...(identite.autres_liens ?? [])].filter(Boolean).join(', '),
    titre: cv.titre ?? '',
    annees_experience: Number(cv.annees_experience) || 0,
    competences: (cv.competences_techniques ?? []).join(', '),
    lien_cv_anonyme: `${URL_N8N}/webhook/cv-anonyme?code=${d.code_consultant}`,
    fichier_source: $('Formulaire dépose CV').first().json.cv?.filename ?? '',
    alertes_rgpd: alertes.length,
    alertes_detail: alertes.map(alerteEnTexte).join(' ; '),
  },
};