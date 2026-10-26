// Notifiche push e pannello impostazioni (iPhone: iOS 16.4+ e app aggiunta alla schermata Home)
(function () {
  const C = window.PROMEMORIA_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const status = $("notif-status"), install = $("notif-install");
  const bOn = $("notif-on"), bOff = $("notif-off"), bTest = $("notif-test");
  const banner = $("notif-banner"), bannerText = $("banner-text");
  const sheet = $("settings"), timeIn = $("notify-time"), bSave = $("save-time"), timeStatus = $("time-status");
  const say = (t) => (status.textContent = t);
  const show = (el, v) => (el.hidden = !v);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const configured = C.SUPABASE_URL && !C.SUPABASE_URL.includes("TUO_") && C.SUPABASE_KEY && !C.SUPABASE_KEY.includes("TUA_");

  // Orario: Supabase è la fonte; localStorage serve solo a mostrarlo subito
  const store = {
    get() { try { return localStorage.getItem("notify_time") || "18:00"; } catch (_) { return "18:00"; } },
    set(v) { try { localStorage.setItem("notify_time", v); } catch (_) {} },
  };
  let savedTime = store.get();
  let currentSub = null;

  function roundTo5(v) {
    const [h, m] = v.split(":").map(Number);
    let t = Math.round((h * 60 + m) / 5) * 5;
    if (t >= 24 * 60) t = 24 * 60 - 5;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }
  function paintTime() {
    timeIn.value = savedTime;
    document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === timeIn.value)));
    bSave.disabled = timeIn.value === savedTime;
  }

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
    const txt = await r.text();
    try { return JSON.parse(txt); } catch (_) { return txt; }
  }
  const saveSub = (sub, time) => {
    const j = sub.toJSON();
    return rpc("save_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_time: time || null });
  };

  function setBanner(text) {
    if (text) { bannerText.textContent = text; show(banner, true); } else show(banner, false);
  }

  async function refresh() {
    show(bOn, false); show(bOff, false); show(bTest, false); show(install, false);
    currentSub = null;
    if (!configured) { setBanner("Manca la configurazione di Supabase."); return say("Manca la configurazione di Supabase in config.js."); }
    if (!("serviceWorker" in navigator)) { setBanner(null); return say("Questo browser non supporta le notifiche."); }
    if (isIOS && !standalone) {
      show(install, true); setBanner("Aggiungi l'app alla Home per ricevere i promemoria.");
      return say("Su iPhone le notifiche funzionano solo dall'app sulla schermata Home.");
    }
    if (!("PushManager" in window)) { setBanner(null); return say("Notifiche non disponibili. Serve iOS 16.4 o successivo."); }
    if (Notification.permission === "denied") {
      setBanner("Notifiche bloccate.");
      return say("Notifiche bloccate. Riattivale da Impostazioni › Notifiche › Rifiuti.");
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      currentSub = sub;
      // Risalva sempre l'iscrizione (si ripara da sola) e legge l'orario salvato su Supabase
      try {
        const t = await saveSub(sub, null);
        if (typeof t === "string" && /^\d\d:\d\d$/.test(t)) { savedTime = t; store.set(t); paintTime(); }
      } catch (e) {
        setBanner("Notifiche non salvate su Supabase.");
        say("Notifiche attive sul telefono, ma non salvate su Supabase: " + e.message); show(bOff, true); return;
      }
      say(`Attive. Ricevi il promemoria alle ${savedTime} la sera prima di ogni raccolta.`);
      show(bOff, true); show(bTest, true); setBanner(null);
    } else {
      say(`Ricevi alle ${savedTime} della sera prima cosa portare fuori.`);
      show(bOn, true); setBanner("Notifiche non attive.");
    }
  }

  bOn.addEventListener("click", async () => {
    bOn.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Permesso non concesso.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription() ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(C.VAPID_PUBLIC_KEY) });
      await saveSub(sub, savedTime);
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

  // Orario
  timeIn.addEventListener("input", () => {
    document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === timeIn.value)));
    bSave.disabled = !timeIn.value || timeIn.value === savedTime;
    timeStatus.textContent = "Gli orari vanno di 5 in 5 minuti.";
  });
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest(".preset"); if (!b) return;
    timeIn.value = b.dataset.t; timeIn.dispatchEvent(new Event("input"));
  });
  bSave.addEventListener("click", async () => {
    if (!timeIn.value) return;
    const t = roundTo5(timeIn.value);
    bSave.disabled = true;
    try {
      if (currentSub) {
        const r = await rpc("set_notify_time", { p_endpoint: currentSub.endpoint, p_time: t });
        if (!r) throw new Error("iscrizione non trovata, prova a disattivare e riattivare le notifiche");
      }
      savedTime = t; store.set(t); paintTime();
      timeStatus.textContent = currentSub
        ? `Salvato. Il prossimo promemoria arriverà alle ${t}.`
        : `Salvato. Verrà usato quando attivi le notifiche.`;
      if (currentSub) say(`Attive. Ricevi il promemoria alle ${t} la sera prima di ogni raccolta.`);
      else say(`Ricevi alle ${t} della sera prima cosa portare fuori.`);
    } catch (e) {
      timeStatus.textContent = "Orario non salvato: " + e.message;
      bSave.disabled = false;
    }
  });

  // Apertura e chiusura del pannello
  function openSheet() { sheet.hidden = false; document.body.style.overflow = "hidden"; $("close-settings").focus(); }
  function closeSheet() { sheet.hidden = true; document.body.style.overflow = ""; $("open-settings").focus(); }
  $("open-settings").addEventListener("click", openSheet);
  $("banner-open").addEventListener("click", openSheet);
  $("close-settings").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  paintTime();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  refresh();
})();
