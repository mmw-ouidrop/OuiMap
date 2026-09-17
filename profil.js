/* ============================================================
   OuiMap Dropper — Gestion des profils joueurs, navigation & sync
   Clés localStorage :
     - geoScores      : historique des parties (source locale)
     - geoLastPseudo  : dernier pseudo utilisé (reconnaissance auto)
     - geoLastSync    : horodatage (ms) de la dernière synchro réussie
   ============================================================ */

const LS_SCORES = 'geoScores';
const LS_LAST_PSEUDO = 'geoLastPseudo';
const LS_LAST_SYNC = 'geoLastSync';

// --- CONFIGURATION GOOGLE SHEET (partagée par toutes les pages) ---
// Colle ici l'URL de ta Web App Google Apps Script (doGet + doPost).
// Laisse la chaîne vide pour désactiver l'envoi ET la synchronisation.
const URL_GOOGLE_SHEET = "https://script.google.com/macros/s/AKfycbzh9d3pIdO8gy-s-Zk7HsiQQAhi4KkFPQ0sOMtFt4kbOf84ve9c4c-aSM__0stbsS200g/exec";

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 heure
const SYNC_CHECK_MS = 5 * 60 * 1000;     // vérifie toutes les 5 min si l'onglet reste ouvert

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

function genererIdPartie() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
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

/* ============================================================
   SYNCHRONISATION GOOGLE SHEET
   Le Sheet fait office de "serveur" léger : chaque partie postée
   (voir jeu.html) y est stockée avec un id unique. On la relit
   régulièrement pour que chaque appareil voie les parties des autres.
   ============================================================ */

let syncEnCours = false;

function fusionnerScores(locaux, distants) {
  const map = new Map();
  locaux.forEach(p => map.set(p.id || ('local-' + p.date + '-' + p.nom + '-' + p.score), p));
  // Les parties distantes font foi : elles remplacent toute copie locale du même id
  distants.forEach(p => { if (p.id) map.set(p.id, p); });
  return Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function formaterHeure(date) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function majBoutonSync(etat, dernierSyncMs) {
  const btn = document.getElementById('sync-btn');
  if (!btn) return;
  btn.classList.toggle('syncing', etat === 'en-cours');

  if (etat === 'en-cours') {
    btn.title = 'Synchronisation en cours...';
  } else if (etat === 'erreur') {
    btn.title = 'Échec de la synchronisation — nouvelle tentative au prochain chargement';
  } else {
    const ms = dernierSyncMs || parseInt(localStorage.getItem(LS_LAST_SYNC), 10);
    btn.title = ms ? `Dernière synchro : ${formaterHeure(new Date(ms))} (cliquer pour rafraîchir)` : 'Synchroniser les scores';
  }
}

/* Récupère toutes les parties enregistrées sur le Google Sheet, les fusionne
   avec les données locales, et prévient les pages ouvertes du rafraîchissement. */
async function synchroniserDepuisGoogleSheet(manuel) {
  if (!URL_GOOGLE_SHEET) return;
  if (syncEnCours) return;
  syncEnCours = true;
  majBoutonSync('en-cours');

  try {
    const reponse = await fetch(URL_GOOGLE_SHEET, { method: 'GET' });
    if (!reponse.ok) throw new Error('Réponse HTTP ' + reponse.status);
    const distants = await reponse.json();

    const locaux = getScores();
    const fusion = fusionnerScores(locaux, Array.isArray(distants) ? distants : []);
    localStorage.setItem(LS_SCORES, JSON.stringify(fusion));

    const maintenant = Date.now();
    localStorage.setItem(LS_LAST_SYNC, String(maintenant));
    majBoutonSync('ok', maintenant);

    window.dispatchEvent(new CustomEvent('geo-sync-complete', { detail: { count: fusion.length, manuel: !!manuel } }));
  } catch (erreur) {
    console.warn('Synchronisation Google Sheet impossible :', erreur);
    majBoutonSync('erreur');
  } finally {
    syncEnCours = false;
  }
}

/* Sync auto : au chargement si > 1h depuis la dernière fois, puis vérification
   périodique tant que l'onglet reste ouvert (pour un vrai rafraîchissement "toutes les heures"). */
function initialiserSyncAuto() {
  if (!URL_GOOGLE_SHEET) return;

  const verifier = () => {
    const dernier = parseInt(localStorage.getItem(LS_LAST_SYNC), 10) || 0;
    if (Date.now() - dernier >= SYNC_INTERVAL_MS) {
      synchroniserDepuisGoogleSheet(false);
    }
  };

  verifier();
  setInterval(verifier, SYNC_CHECK_MS);
}

/* Injecte la barre de navigation partagée dans un élément #top-nav-slot.
   `page` = 'accueil' | 'jeu' | 'scores' pour surligner le lien actif. */
function injecterNav(page) {
  const slot = document.getElementById('top-nav-slot');
  if (!slot) return;

  const pseudo = getLastPseudo();
  const chip = pseudo
    ? `<div class="player-chip"><span class="avatar">${getInitiales(pseudo)}</span><span class="chip-label">${pseudo}</span></div>`
    : '';

  const boutonSync = URL_GOOGLE_SHEET
    ? `<button id="sync-btn" class="sync-btn" onclick="synchroniserDepuisGoogleSheet(true)" title="Synchroniser les scores"><i class="fa-solid fa-rotate"></i></button>`
    : '';

  slot.innerHTML = `
    <nav class="top-nav">
      <a href="index.html" class="brand"><span class="o-mark">O</span><span class="brand-label"> OuiMap Dropper</span></a>
      <div class="nav-links">
        <a href="index.html" class="${page === 'accueil' ? 'active' : ''}"><i class="fa-solid fa-house"></i><span class="nav-label"> Accueil</span></a>
        <a href="jeu.html" class="${page === 'jeu' ? 'active' : ''}"><i class="fa-solid fa-play"></i><span class="nav-label"> Jouer</span></a>
        <a href="scores.html" class="${page === 'scores' ? 'active' : ''}"><i class="fa-solid fa-chart-column"></i><span class="nav-label"> Stats</span></a>
      </div>
      ${boutonSync}
      ${chip}
    </nav>
  `;

  majBoutonSync('ok');
  initialiserSyncAuto();
}
