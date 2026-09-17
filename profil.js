/* ============================================================
   OuiMap Dropper — Gestion des profils joueurs & utilitaires
   Clés localStorage :
     - geoScores      : historique des parties (inchangé, rétro-compatible)
     - geoLastPseudo  : dernier pseudo utilisé (reconnaissance auto)
   ============================================================ */

const LS_SCORES = 'geoScores';
const LS_LAST_PSEUDO = 'geoLastPseudo';

function getScores() {
  try {
    return JSON.parse(localStorage.getItem(LS_SCORES)) || [];
  } catch (e) {
    console.error('Erreur de lecture des scores', e);
    return [];
  }
}

function getLastPseudo() {
  return localStorage.getItem(LS_LAST_PSEUDO) || '';
}

function setLastPseudo(nom) {
  if (nom) localStorage.setItem(LS_LAST_PSEUDO, nom);
}

/* Construit la liste des profils connus à partir de l'historique des parties.
   Un "profil" regroupe : nombre de parties, meilleur score, score moyen, dernière partie. */
function getProfils() {
  const scores = getScores();
  const map = new Map();

  scores.forEach(partie => {
    const nom = partie.nom || 'Anonyme';
    if (!map.has(nom)) {
      map.set(nom, { nom, parties: 0, meilleurScore: 0, cumul: 0, derniereDate: null });
    }
    const p = map.get(nom);
    p.parties += 1;
    p.cumul += (partie.score || 0);
    p.meilleurScore = Math.max(p.meilleurScore, partie.score || 0);
    if (!p.derniereDate || new Date(partie.date) > new Date(p.derniereDate)) {
      p.derniereDate = partie.date;
    }
  });

  return Array.from(map.values())
    .map(p => ({ ...p, scoreMoyen: Math.round(p.cumul / p.parties) }))
    .sort((a, b) => b.meilleurScore - a.meilleurScore);
}

function getInitiales(nom) {
  if (!nom) return '?';
  const mots = nom.trim().split(/\s+/);
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[1][0]).toUpperCase();
}

/* Injecte la barre de navigation partagée dans un élément #top-nav-slot.
   `page` = 'accueil' | 'jeu' | 'scores' pour surligner le lien actif. */
function injecterNav(page) {
  const slot = document.getElementById('top-nav-slot');
  if (!slot) return;

  const pseudo = getLastPseudo();
  const chip = pseudo
    ? `<div class="player-chip"><span class="avatar">${getInitiales(pseudo)}</span> ${pseudo}</div>`
    : '';

  slot.innerHTML = `
    <nav class="top-nav">
      <a href="index.html" class="brand"><span class="o-mark">O</span> OuiMap Dropper</a>
      <div class="nav-links">
        <a href="index.html" class="${page === 'accueil' ? 'active' : ''}"><i class="fa-solid fa-house"></i> Accueil</a>
        <a href="jeu.html" class="${page === 'jeu' ? 'active' : ''}"><i class="fa-solid fa-play"></i> Jouer</a>
        <a href="scores.html" class="${page === 'scores' ? 'active' : ''}"><i class="fa-solid fa-chart-column"></i> Stats</a>
      </div>
      ${chip}
    </nav>
  `;
}
