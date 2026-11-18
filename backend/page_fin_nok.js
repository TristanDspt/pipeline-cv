const d = $('Mise en page HTML').first().json;
const e = $json.error;
const raison = typeof e === 'string' ? e : (e?.message ?? 'raison inconnue');

return {
  json: {
    titre: `CV anonymisé : ${d.code_consultant} (Excel non mis à jour)`,
    message: [
      `Le CV anonymisé est enregistré : ${d.code_consultant}.pdf`,
      'La ligne est bien dans la table du registre.',
      "Mais le fichier Excel n'a pas pu être écrit (est-il ouvert dans Excel ?).",
      'Ferme-le : le prochain CV déposé le régénérera en entier.',
      `Détail technique : ${raison}`,
    ].join('<br>'),
  },
};