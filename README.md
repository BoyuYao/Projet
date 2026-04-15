# CHROMATRACE - Prototype Phaser + Socket.io

Prototype jouable inspiré du GDD de **CHROMATRACE / La Conquête de Territoire**.

## Contenu

- **Projecteur** : écran principal Phaser sur `http://localhost:3000/`
- **Manette smartphone** : interface tactile sur `http://localhost:3000/controller.html`
- **Serveur Node.js + Socket.io** : logique temps réel, grille, captures, collisions, items

## Fonctionnalités incluses

- capture de territoire par fermeture de boucle
- élimination si un joueur coupe une trace
- élimination si on touche le bord
- respawn automatique après 2 secondes
- items **Boost** et **Shield**
- leaderboard en temps réel
- style visuel cyber-néon sans assets externes

## Installation

```bash
npm install
npm start
```

Puis ouvrir :

- projecteur : `http://localhost:3000/`
- téléphone/manette : `http://localhost:3000/controller.html`

## Commandes utiles

### Installer les dépendances
```bash
npm install
```

### Lancer le serveur
```bash
npm start
```

### Lancer en mode développement
```bash
npm run dev
```

## Structure

```text
chromatrace-phaser/
├── package.json
├── server.js
├── README.md
└── public/
    ├── index.html
    ├── controller.html
    ├── projector.js
    ├── controller.js
    └── style.css
```

## Remarques

- Ce prototype est volontairement simple et autonome.
- Il ne dépend d'aucun sprite externe.
- Le rendu est basé sur des formes dessinées par le code.
- La logique reste assez proche du GDD, mais sans optimisation avancée de type Quadtree.
