// Iscrizione alle notifiche push (iPhone: richiede iOS 16.4+ e l'app aggiunta alla schermata Home)
(function () {
  const C = window.PROMEMORIA_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const status = $("notif-status"), install = $("notif-install");
  const bOn = $("notif-on"), bOff = $("notif-off"), bTest = $("notif-test");
  const say = (t) => (status.textContent = t);
  const show = (el, v) => (el.hidden = !v);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const configured = C.SUPABASE_URL && !C.SUPABASE_URL.includes("TUO_") && C.SUPABASE_KEY && !C.SUPABASE_KEY.includes("TUA_");

  function b64ToBytes(s) {
    const p = "=".repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function rpc(name, args) {
    const r = await fetch(`${C.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.SUPABASE_KEY },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`Supabase ha risposto ${r.status}: ${await r.text()}`);
  }

  async function refresh() {
    show(bOn, false); show(bOff, false); show(bTest, false); show(install, false);
    if (!configured) return say("Manca la configurazione di Supabase in config.js.");
    if (!("serviceWorker" in navigator)) return say("Questo browser non supporta le notifiche.");
    if (isIOS && !standalone) { show(install, true); return say("Su iPhone le notifiche funzionano solo dall'app sulla schermata Home."); }
    if (!("PushManager" in window)) return say("Notifiche non disponibili. Serve iOS 16.4 o successivo.");
    if (Notification.permission === "denied")
      return say("Notifiche bloccate. Riattivale da Impostazioni › Notifiche › Rifiuti.");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Risalva sempre l'iscrizione: se un tentativo precedente non era arrivato a Supabase, si sistema da solo
      const j = sub.toJSON();
      try { await rpc("save_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }); }
      catch (e) { say("Notifiche attive sul telefono, ma non salvate su Supabase: " + e.message); show(bOff, true); return; }
      say("Attive. Ricevi un promemoria alle 18 di lunedì, mercoledì e venerdì.");
      show(bOff, true); show(bTest, true);
    } else {
      say("Ricevi alle 18 del giorno prima cosa portare fuori.");
      show(bOn, true);
    }
  }

  bOn.addEventListener("click", async () => {
    bOn.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Permesso non concesso.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(C.VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      await rpc("save_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    } catch (e) { say("Non sono riuscito ad attivarle: " + e.message); bOn.disabled = false; return; }
    bOn.disabled = false; refresh();
  });

  bOff.addEventListener("click", async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { try { await rpc("delete_subscription", { p_endpoint: sub.endpoint }); } catch (_) {} await sub.unsubscribe(); }
    refresh();
  });

  bTest.addEventListener("click", async () => {
    bTest.disabled = true;
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      const r = await fetch(`${C.SUPABASE_URL}/functions/v1/send-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: C.SUPABASE_KEY },
        body: JSON.stringify({ test: true, endpoint: sub.endpoint }),
      });
      if (!r.ok) {
        let msg = `errore ${r.status}`;
        try { const j = await r.json(); msg = j.error || j.message || msg; } catch (_) {}
        throw new Error(msg);
      }
      say("Prova inviata: dovrebbe arrivare tra pochi secondi.");
    } catch (e) { say("Prova non riuscita: " + e.message); }
    bTest.disabled = false;
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  refresh();
})();
