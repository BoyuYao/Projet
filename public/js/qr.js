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

        try {
            new QRCode(container, {
                text:         url,
                width:        150,
                height:       150,
                colorDark:    '#0f172a',
                colorLight:   '#ffffff',
                correctLevel: QRCode.CorrectLevel.M,
            });
            document.getElementById('server-url').innerText = url;
        } catch (e) {
            console.error('QR error:', e);
        }
    }

    // Reçoit l'IP réelle via le socket existant (partagé avec projector.js)
    socket.on('state', function (p) {
        if (p.serverIp && !qrDone) {
            afficherQR('http://' + p.serverIp + ':3000/controller.html');
        }
    });

    // Fallback : si la page est déjà servie depuis la bonne IP
    window.addEventListener('DOMContentLoaded', function () {
        const host = window.location.hostname;
        if (host && host !== 'localhost' && host !== '127.0.0.1') {
            const port = window.location.port || '3000';
            afficherQR('http://' + host + ':' + port + '/controller.html');
        }
    });
}());
