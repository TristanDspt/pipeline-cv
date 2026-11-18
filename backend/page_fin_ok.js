const d = $('Mise en page HTML').first().json;
const n = (d.alertes_rgpd ?? []).length;

const alertes = n === 0
  ? 'Aucune correction automatique du contrôle RGPD.'
  : `${n} correction(s) automatique(s) du contrôle RGPD : à relire.`;

return {
  json: {
    titre: `CV anonymisé : ${d.code_consultant}`,
    message: [
      `Le CV anonymisé est enregistré : ${d.code_consultant}.pdf`,
      'Le registre interne est à jour (table et fichier Excel).',
      alertes,
    ].join('<br>'),
  },
};