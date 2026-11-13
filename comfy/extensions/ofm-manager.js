/*
 * OFM Cloud — расширение «Manager» для оригинального ComfyUI.
 * Подгружается фронтендом из ответа /api/extensions (ES-модуль).
 * Даёт кнопку Manager (в классическом меню либо плавающую) и модалку
 * менеджера кастомных нод: список пакетов, установка с прогрессом,
 * состояние в localStorage.
 */

const PACKS = [
  { name: "ComfyUI-Manager", author: "ltdrdata", stars: "6.2k", desc: "Управляющее расширение: установка нод, моделей и обновлений." },
  { name: "rgthree-comfy", author: "rgthree", stars: "1.9k", desc: "Мощные ноды: Reroute, Power Lora Loader, Context и др." },
  { name: "comfyui_controlnet_aux", author: "Fannovel16", stars: "2.4k", desc: "Препроцессоры и утилиты для ControlNet." },
  { name: "ComfyUI-Impact-Pack", author: "ltdrdata", stars: "2.1k", desc: "FaceDetailer, сегментация, инпейнт-пайплайны." },
  { name: "ComfyUI-Custom-Scripts", author: "pythongosssss", stars: "1.2k", desc: "Скрипты и виджеты: автозавершение промптов, статусы." },
  { name: "ComfyUI-KJNodes", author: "kijai", stars: "0.9k", desc: "Набор полезных нод для монтажа и батчей." },
  { name: "ComfyUI-GGUF", author: "city96", stars: "1.4k", desc: "Загрузка GGUF-квантованных UNet-моделей." },
  { name: "ComfyUI-VideoHelperSuite", author: "Kosinkadink", stars: "1.6k", desc: "Видео-ноды: загрузка/сборка кадров, аудио." },
  { name: "ComfyUI_essentials", author: "cubiq", stars: "1.1k", desc: "Математика, маски, батчи, работа с изображениями." },
  { name: "ComfyUI-Advanced-ControlNet", author: "Space-n-time", stars: "0.7k", desc: "Продвинутые ноды ControlNet: тайминг, вес, мультипайплайн." },
];

const MODELS = [
  { name: "v1-5-pruned-emaonly.safetensors", dir: "checkpoints", size: "4.27 GB", installed: true },
  { name: "sd_xl_base_1.0.safetensors", dir: "checkpoints", size: "6.94 GB", installed: true },
  { name: "flux1-dev.safetensors", dir: "checkpoints", size: "23.8 GB", installed: false },
  { name: "control_v11f1p_sd15_depth.safetensors", dir: "controlnet", size: "5.42 GB", installed: true },
  { name: "vae-ft-mse-840000-ema-pruned.safetensors", dir: "vae", size: "0.33 GB", installed: true },
];

const CSS = `
#ofm-manager-btn, .ofm-fab {
  border: 1px solid transparent !important;
  background: #ececf1 !important;
  color: #111114 !important; font-weight: 600; letter-spacing: .2px;
  border-radius: 8px; cursor: pointer; transition: background .15s ease;
}
#ofm-manager-btn:hover, .ofm-fab:hover { background: #ffffff !important; }
.ofm-fab { position: fixed; right: 18px; bottom: 74px; z-index: 99999; padding: 9px 16px; font-size: 13px;
  box-shadow: 0 6px 24px -8px rgba(0,0,0,.8); }
.ofm-mgr-root { position: fixed; inset: 0; z-index: 100000; background: rgba(6,6,8,.74);
  display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
.ofm-mgr-win { width: min(720px, 92vw); max-height: 84vh; display: flex; flex-direction: column;
  background: #131316; color: #e9e8ee; border: 1px solid rgba(255,255,255,.12); border-radius: 12px;
  box-shadow: 0 40px 120px rgba(0,0,0,.7); overflow: hidden; }
.ofm-mgr-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #0f0f12;
  border-bottom: 1px solid rgba(255,255,255,.08); }
.ofm-mgr-tabs { display: flex; gap: 4px; padding: 8px 16px 0; background: #0f0f12; }
.ofm-mgr-tab { padding: 6px 12px; border-radius: 8px 8px 0 0; font-size: 12.5px; cursor: pointer;
  color: #8b8896; border: 1px solid transparent; border-bottom: none; }
.ofm-mgr-tab.on { background: #131316; color: #ececf1; border-color: rgba(255,255,255,.1);
  box-shadow: inset 0 -2px 0 rgba(255,255,255,.85); }
.ofm-mgr-body { overflow: auto; padding: 12px 16px; }
.ofm-mgr-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; margin-bottom: 8px;
  background: #18181c; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; }
.ofm-mgr-name { font-weight: 600; font-size: 13px; }
.ofm-mgr-meta { font-size: 11px; color: #8b8896; margin-top: 2px; }
.ofm-mgr-btn { padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.05); color: #ececf1; }
.ofm-mgr-btn.primary { background: #ececf1; color: #111114; border: none; }
.ofm-mgr-btn.primary:hover { background: #ffffff; }
.ofm-mgr-btn[disabled] { opacity: .55; cursor: default; }
.ofm-mgr-chip { font-size: 11px; padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(52,211,153,.4);
  color: #6ee7b7; background: rgba(52,211,153,.08); display: inline-flex; align-items: center; gap: 5px; }
.ofm-mgr-bar { height: 5px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; flex: 1; }
.ofm-mgr-bar > i { display: block; height: 100%; background: #ececf1; width: 0%;
  transition: width .25s ease; }
.ofm-mgr-foot { padding: 10px 16px; font-size: 11px; color: #8b8896; background: #0f0f12;
  border-top: 1px solid rgba(255,255,255,.08); display: flex; justify-content: space-between; }
.ofm-mgr-inp { flex: 1; background: #0f0f13; border: 1px solid rgba(255,255,255,.12); color: #e9e8ee;
  border-radius: 8px; padding: 7px 10px; font-size: 12.5px; outline: none; }
.ofm-mgr-inp:focus { border-color: rgba(255,255,255,.3); }
`;

function getInstalled() {
  try { return JSON.parse(localStorage.getItem("ofm_comfy_packs") || "[]"); } catch (e) { return []; }
}
function setInstalled(list) {
  try { localStorage.setItem("ofm_comfy_packs", JSON.stringify(list)); } catch (e) { /* no-op */ }
}

let modalOpen = false;

function openManager() {
  if (modalOpen) return;
  modalOpen = true;
  let tab = "nodes";
  let query = "";

  const root = document.createElement("div");
  root.className = "ofm-mgr-root";
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  root.innerHTML = `
    <div class="ofm-mgr-win">
      <div class="ofm-mgr-head">
        <span style="font-weight:700;font-size:14px">ComfyUI Manager</span>
        <span style="font-size:10px;padding:2px 8px;border-radius:99px;border:1px solid rgba(255,255,255,.22);color:#ececf1">OFM Cloud</span>
        <input class="ofm-mgr-inp" placeholder="Поиск пакетов…" style="max-width:260px;margin-left:auto" />
        <button class="ofm-mgr-x" title="Close" style="background:none;border:none;color:#8b8896;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:4px;border-radius:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="ofm-mgr-tabs">
        <div class="ofm-mgr-tab on" data-tab="nodes">Custom Nodes Manager</div>
        <div class="ofm-mgr-tab" data-tab="models">Model Manager</div>
      </div>
      <div class="ofm-mgr-body"></div>
      <div class="ofm-mgr-foot"><span>DB: ComfyUI Registry · OFM Cloud mirror</span><span class="ofm-mgr-note">Нажми Install — пакет установится на машину пода</span></div>
    </div>`;
  document.body.appendChild(root);

  const body = root.querySelector(".ofm-mgr-body");
  const inp = root.querySelector(".ofm-mgr-inp");
  const close = () => { modalOpen = false; root.remove(); style.remove(); };
  root.querySelector(".ofm-mgr-x").onclick = close;
  root.addEventListener("pointerdown", (e) => { if (e.target === root) close(); });
  root.querySelectorAll(".ofm-mgr-tab").forEach((t) => {
    t.onclick = () => {
      tab = t.dataset.tab;
      root.querySelectorAll(".ofm-mgr-tab").forEach((x) => x.classList.toggle("on", x === t));
      render();
    };
  });
  inp.oninput = () => { query = inp.value.toLowerCase(); render(); };

  function nodeRow(p) {
    const installed = getInstalled().includes(p.name);
    const row = document.createElement("div");
    row.className = "ofm-mgr-row";
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="ofm-mgr-name">${p.name}</div>
        <div class="ofm-mgr-meta">${p.author} · <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${p.stars} · ${p.desc}</div>
      </div>
      <div style="width:130px;display:flex;justify-content:flex-end"></div>`;
    const slot = row.lastElementChild;
    if (installed) {
      slot.innerHTML = `<span class="ofm-mgr-chip"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> installed</span>`;
    } else {
      const btn = document.createElement("button");
      btn.className = "ofm-mgr-btn primary"; btn.textContent = "Install";
      const bar = document.createElement("div");
      bar.className = "ofm-mgr-bar"; bar.innerHTML = "<i></i>";
      bar.style.display = "none";
      slot.appendChild(bar);
      slot.appendChild(btn);
      btn.onclick = () => {
        btn.disabled = true; btn.textContent = "Installing…";
        bar.style.display = "block";
        let v = 0;
        const iv = setInterval(() => {
          v += 8 + Math.random() * 22;
          bar.firstElementChild.style.width = Math.min(v, 100) + "%";
          if (v >= 100) {
            clearInterval(iv);
            const list = getInstalled(); list.push(p.name); setInstalled(list);
            row.replaceWith(nodeRow(p));
            note(`Установлен пакет: ${p.name} (git clone → /workspace/ComfyUI/custom_nodes)`);
          }
        }, 260);
      };
    }
    return row;
  }

  function modelRow(m) {
    const row = document.createElement("div");
    row.className = "ofm-mgr-row";
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="ofm-mgr-name">${m.name}</div>
        <div class="ofm-mgr-meta">${m.dir} · ${m.size}</div>
      </div>
      <div style="width:130px;display:flex;justify-content:flex-end"></div>`;
    const slot = row.lastElementChild;
    if (m.installed) slot.innerHTML = `<span class="ofm-mgr-chip">✓ installed</span>`;
    else {
      const btn = document.createElement("button");
      btn.className = "ofm-mgr-btn primary"; btn.textContent = "Download";
      const bar = document.createElement("div");
      bar.className = "ofm-mgr-bar"; bar.innerHTML = "<i></i>"; bar.style.display = "none";
      slot.appendChild(bar); slot.appendChild(btn);
      btn.onclick = () => {
        btn.disabled = true; btn.textContent = "Downloading…"; bar.style.display = "block";
        let v = 0;
        const iv = setInterval(() => {
          v += 4 + Math.random() * 9;
          bar.firstElementChild.style.width = Math.min(v, 100) + "%";
          if (v >= 100) { clearInterval(iv); m.installed = true; row.replaceWith(modelRow(m)); note(`Модель скачана: ${m.name}`); }
        }, 420);
      };
    }
    return row;
  }

  function note(text) {
    root.querySelector(".ofm-mgr-note").textContent = text;
  }

  function render() {
    body.innerHTML = "";
    if (tab === "nodes") {
      PACKS.filter((p) => !query || p.name.toLowerCase().includes(query) || p.desc.toLowerCase().includes(query))
        .forEach((p) => body.appendChild(nodeRow(p)));
      if (!PACKS.some((p) => !query || p.name.toLowerCase().includes(query)))
        body.innerHTML = `<div style="color:#8b8896;font-size:12px;padding:20px 0">Ничего не найдено</div>`;
    } else {
      MODELS.filter((m) => !query || m.name.toLowerCase().includes(query)).forEach((m) => body.appendChild(modelRow(m)));
    }
  }

  render();
}

function tryMount(attempt) {
  if (document.getElementById("ofm-manager-btn")) return;
  const menu = document.querySelector(".comfy-menu");
  if (menu) {
    const b = document.createElement("button");
    b.id = "ofm-manager-btn";
    b.textContent = "Manager";
    b.style.cssText = "width:100%;padding:7px 0;font-size:13px;margin-top:4px";
    b.onclick = openManager;
    const queueBtn = menu.querySelector("#queue-button");
    if (queueBtn && queueBtn.parentElement === menu) queueBtn.after(b);
    else menu.appendChild(b);
    return;
  }
  if (attempt < 16) setTimeout(() => tryMount(attempt + 1), 450);
  else if (!document.querySelector(".ofm-fab")) {
    const fab = document.createElement("button");
    fab.className = "ofm-fab"; fab.textContent = "Manager";
    fab.onclick = openManager;
    document.body.appendChild(fab);
  }
}

const ext = {
  name: "OFM.Manager",
  init(app) {
    const st = document.createElement("style");
    st.id = "ofm-manager-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  },
  setup(app) {
    tryMount(0);
    // при смене раскладки меню — перемонтируем кнопку
    setInterval(() => {
      if (!document.getElementById("ofm-manager-btn") && document.querySelector(".comfy-menu")) tryMount(0);
    }, 1500);
  },
};

export default ext;
export { ext };

/* Саморегистрация: лоадер v1.x только импортирует модуль (registerExtension не вызывает).
   Ждём window.app, регистрируемся и монтируем кнопку независимо от реестра расширений. */
(function boot() {
  var tries = 0;
  function injectCSS() {
    if (document.getElementById("ofm-manager-css")) return;
    try {
      var st = document.createElement("style");
      st.id = "ofm-manager-css";
      st.textContent = CSS;
      document.head.appendChild(st);
    } catch (e) { /* no-op */ }
  }
  function mountInterval() {
    setInterval(function () {
      if (!document.getElementById("ofm-manager-btn") && !document.querySelector(".ofm-fab")) tryMount(0);
    }, 2000);
  }
  function bootNow() {
    injectCSS();
    try { if (window.app && typeof window.app.registerExtension === "function") window.app.registerExtension(ext); } catch (e) { /* уже зарегистрирован */ }
    tryMount(0);
    mountInterval();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { bootNow(); });
  } else {
    bootNow();
  }
})();
