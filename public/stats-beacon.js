// Beacon analytics privacy-friendly di Strummolo.
// Cosa invia: SOLO il percorso della pagina, una visita e i secondi di lettura
// (tempo con la pagina effettivamente visibile). Niente cookie, niente IP,
// niente fingerprinting: i dati vengono aggregati per giorno lato server e
// non è possibile risalire al singolo visitatore.
(() => {
  // Rispettiamo Do Not Track e Global Privacy Control: chi li attiva non viene contato.
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;

  // Niente tracking in locale né sulle pagine riservate.
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return;
  const path = location.pathname;
  if (path.startsWith("/admin") || path.startsWith("/stats")) return;

  const API = "https://chat-api.davidecucciardi.workers.dev/track";

  // sendBeacon con stringa => content-type text/plain: niente preflight CORS
  // e l'invio funziona anche mentre la pagina si sta chiudendo.
  const send = (data) => {
    try {
      navigator.sendBeacon(API, JSON.stringify(data));
    } catch (e) {
      /* se il beacon fallisce pazienza, mai bloccare la pagina */
    }
  };

  // 1 visita alla pagina.
  send({ p: path, v: 1 });

  // Tempo di lettura: accumuliamo solo i millisecondi in cui la pagina è visibile
  // e li spediamo quando l'utente la nasconde o la chiude.
  let visibleSince = document.visibilityState === "visible" ? Date.now() : null;
  let accumulated = 0;

  const flush = () => {
    if (visibleSince !== null) {
      accumulated += Date.now() - visibleSince;
      visibleSince = null;
    }
    const seconds = Math.round(accumulated / 1000);
    if (seconds >= 1) {
      send({ p: path, s: seconds });
      accumulated = 0;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    } else if (visibleSince === null) {
      visibleSince = Date.now();
    }
  });
  addEventListener("pagehide", flush);
})();
