// ============================================================
//  qr.js — Génération QR code CHROMATRACE
//  Réutilise le socket défini par projector.js (chargé avant)
// ============================================================

(function () {
    let qrDone = false;

    function afficherQR(url) {
        if (qrDone) return;
        qrDone = true;

        const container = document.getElementById('qr-canvas');
        if (!container) return;

        // On nettoie le conteneur avant de générer pour éviter les doublons
        container.innerHTML = "";

        try {
            new QRCode(container, {
                text:         url,
                width:        160,
                height:       160,
                colorDark:    '#0f172a',
                colorLight:   '#ffffff',
                correctLevel: QRCode.CorrectLevel.M,
            });
            const urlBox = document.getElementById('server-url');
            if (urlBox) urlBox.innerText = url;
        } catch (e) {
            console.error('QR error:', e);
        }
    }

    // Dès que la page charge, on décide de l'URL
    window.addEventListener('DOMContentLoaded', function () {
        const host = window.location.hostname;

        // Cas 1 : On est sur internet (Railway)
        if (host !== 'localhost' && host !== '127.0.0.1') {
            // "origin" récupère automatiquement https://projet-production... sans port :3000
            const finalUrl = window.location.origin + '/controller.html';
            afficherQR(finalUrl);
        }
        // Cas 2 : On est en local, on génère une base avec localhost en attendant l'IP du serveur
        else {
            afficherQR('http://' + host + ':3000/controller.html');
        }
    });

    // Écoute du serveur : on n'utilise l'IP du serveur QUE si on est en développement local
    socket.on('state', function (p) {
        const host = window.location.hostname;
        
        // Si on est en local et que le serveur nous donne son IP (ex: 192.168.1.15)
        if ((host === 'localhost' || host === '127.0.0.1') && p.serverIp) {
            // On autorise la mise à jour du QR Code avec la vraie IP locale
            qrDone = false; 
            afficherQR('http://' + p.serverIp + ':3000/controller.html');
        }
        // Si on est sur Railway, on ignore p.serverIp !
    });
}());
