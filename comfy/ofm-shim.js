/*
 * OFM Cloud shim для оригинального ComfyUI (frontend dist v1.14.5).
 * Перехватывает fetch / XMLHttpRequest / WebSocket и мокает бэкенд ComfyUI:
 *   /api/users /api/settings /api/extensions /api/object_info /api/prompt
 *   /api/queue /api/history /api/interrupt /api/free /api/upload/image
 *   /api/embeddings /api/userdata /api/system_stats /api/workflow_templates
 *   /internal/logs* /view?* и WebSocket /ws (прогресс выполнения).
 * Статические файлы (assets, fonts, templates/, extensions/) НЕ трогаются.
 */
(function () {
  "use strict";

  var BASE = location.pathname.replace(/[^/]*$/, "").replace(/\/$/, ""); // "/comfy"
  var LS = {
    settings: "ofm_comfy_settings",
    userdata: "ofm_comfy_ud_",
    packs: "ofm_comfy_packs",
  };

  /* ───────────────────────── настройки ───────────────────────── */
  var settings = { Comfy: { UseNewMenu: "Bottom" } };
  try {
    var saved = JSON.parse(localStorage.getItem(LS.settings) || "{}");
    if (saved && typeof saved === "object") settings = Object.assign(settings, saved);
  } catch (e) { /* no-op */ }
  function saveSettings() {
    try { localStorage.setItem(LS.settings, JSON.stringify(settings)); } catch (e) { /* no-op */ }
  }

  /* ───────────────────────── object_info ───────────────────────── */
  var SAMPLERS = ["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "ddim", "uni_pc", "uni_pc_bh2"];
  var SCHEDULERS = ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"];
  var UPSCALE = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"];

  function def(name, category, input, output, opts) {
    opts = opts || {};
    return {
      input: input, output: output, output_name: output.slice(),
      name: name, display_name: opts.display || name.replace(/([a-z])([A-Z])/g, "$1 $2"),
      description: opts.desc || name,
      category: category, output_node: !!opts.output_node,
      python_module: "nodes.py",
    };
  }

  var OBJ = {};
  // топовые фотореалистичные чекпойнты (строки — часть мока, реальных весов нет)
  OBJ.CheckpointLoaderSimple = def("CheckpointLoaderSimple", "loaders", {
    required: { ckpt_name: [["realvisxlV50_sdxl.safetensors", "cyberrealisticXL_v12.safetensors", "epicrealismXL_v10.safetensors", "juggernautXL_v9.safetensors", "flux1-dev-fp8.safetensors", "sd_xl_base_1.0.safetensors", "v1-5-pruned-emaonly.safetensors"], { image_upload: false }] },
  }, ["MODEL", "CLIP", "VAE"], { display: "Load Checkpoint" });
  OBJ.LoraLoader = def("LoraLoader", "loaders", {
    required: {
      lora_name: [["ofm_influencer_v2.safetensors", "ofm_final.safetensors", "detail_tweaker_xl.safetensors", "add_detail.safetensors"], { image_upload: false }],
      strength_model: ["FLOAT", { default: 1.0, min: -20.0, max: 20.0, step: 0.01 }],
      strength_clip: ["FLOAT", { default: 1.0, min: -20.0, max: 20.0, step: 0.01 }],
      model: ["MODEL"], clip: ["CLIP"],
    },
  }, ["MODEL", "CLIP"], { display: "Load LoRA" });
  OBJ.VAELoader = def("VAELoader", "loaders", {
    required: { vae_name: [["vae-ft-mse-840000-ema-pruned.safetensors", "sdxl_vae.safetensors"], { image_upload: false }] },
  }, ["VAE"], { display: "Load VAE" });
  OBJ.CLIPLoader = def("CLIPLoader", "loaders", {
    required: { clip_name: [["t5xxl_fp16.safetensors", "clip_l.safetensors"], { image_upload: false }], type: [["stable-diffusion", "sd3", "flux"]] },
  }, ["CLIP"], { display: "Load CLIP" });
  OBJ.CLIPTextEncode = def("CLIPTextEncode", "conditioning", {
    required: { text: ["STRING", { default: "", multiline: true }], clip: ["CLIP"] },
  }, ["CONDITIONING"], { display: "CLIP Text Encode (Prompt)" });
  OBJ.CLIPSetLastLayer = def("CLIPSetLastLayer", "conditioning", {
    required: { stop_at_clip_layer: ["INT", { default: -1, min: -24, max: -1, step: 1 }], clip: ["CLIP"] },
  }, ["CLIP"], { display: "CLIP Set Last Layer" });
  OBJ.ConditioningCombine = def("ConditioningCombine", "conditioning", {
    required: { conditioning_1: ["CONDITIONING"], conditioning_2: ["CONDITIONING"] },
  }, ["CONDITIONING"]);
  OBJ.ControlNetLoader = def("ControlNetLoader", "loaders/controlnet", {
    required: { control_net_name: [["control_v11p_sd15_canny.safetensors", "control_v11f1p_sd15_depth.safetensors"], { image_upload: false }] },
  }, ["CONTROL_NET"], { display: "Load ControlNet" });
  OBJ.ControlNetApplyAdvanced = def("ControlNetApplyAdvanced", "conditioning/controlnet", {
    required: {
      positive: ["CONDITIONING"], negative: ["CONDITIONING"], control_net: ["CONTROL_NET"],
      image: ["IMAGE"], strength: ["FLOAT", { default: 1.0, min: 0.0, max: 2.0, step: 0.01 }],
      start_percent: ["FLOAT", { default: 0.0, min: 0.0, max: 1.0, step: 0.001 }],
      end_percent: ["FLOAT", { default: 1.0, min: 0.0, max: 1.0, step: 0.001 }],
    },
  }, ["CONDITIONING", "CONDITIONING"], { display: "Apply ControlNet" });
  OBJ.EmptyLatentImage = def("EmptyLatentImage", "latent", {
    required: {
      width: ["INT", { default: 512, min: 16, max: 16384, step: 8 }],
      height: ["INT", { default: 512, min: 16, max: 16384, step: 8 }],
      batch_size: ["INT", { default: 1, min: 1, max: 64, step: 1 }],
    },
  }, ["LATENT"]);
  OBJ.LatentUpscale = def("LatentUpscale", "latent", {
    required: {
      samples: ["LATENT"], upscale_method: [UPSCALE],
      width: ["INT", { default: 512, min: 16, max: 16384, step: 8 }],
      height: ["INT", { default: 512, min: 16, max: 16384, step: 8 }],
      crop: [["disabled", "center"]],
    },
  }, ["LATENT"]);
  OBJ.KSampler = def("KSampler", "sampling", {
    required: {
      model: ["MODEL"],
      seed: ["INT", { default: 0, min: 0, max: 18446744073709551614 }],
      steps: ["INT", { default: 20, min: 1, max: 10000, step: 1 }],
      cfg: ["FLOAT", { default: 8.0, min: 0.0, max: 100.0, step: 0.1 }],
      sampler_name: [SAMPLERS],
      scheduler: [SCHEDULERS],
      denoise: ["FLOAT", { default: 1.0, min: 0.0, max: 1.0, step: 0.01 }],
      positive: ["CONDITIONING"], negative: ["CONDITIONING"], latent_image: ["LATENT"],
    },
  }, ["LATENT"]);
  OBJ.KSamplerAdvanced = def("KSamplerAdvanced", "sampling", {
    required: {
      add_noise: [["enable", "disable"]], noise_seed: ["INT", { default: 0, min: 0, max: 18446744073709551614, control_after_generate: true }],
      steps: ["INT", { default: 20, min: 1, max: 10000, step: 1 }],
      cfg: ["FLOAT", { default: 8.0, min: 0.0, max: 100.0, step: 0.1 }],
      sampler_name: [SAMPLERS], scheduler: [SCHEDULERS],
      start_at_step: ["INT", { default: 0, min: 0, max: 10000, step: 1 }],
      end_at_step: ["INT", { default: 20, min: 0, max: 10000, step: 1 }],
      return_with_leftover_noise: [["disable", "enable"]],
      model: ["MODEL"], positive: ["CONDITIONING"], negative: ["CONDITIONING"], latent_image: ["LATENT"],
    },
  }, ["LATENT"]);
  OBJ.VAEDecode = def("VAEDecode", "latent", { required: { samples: ["LATENT"], vae: ["VAE"] } }, ["IMAGE"]);
  OBJ.VAEEncode = def("VAEEncode", "latent", { required: { pixels: ["IMAGE"], vae: ["VAE"] } }, ["LATENT"]);
  OBJ.SaveImage = def("SaveImage", "image", {
    required: { images: ["IMAGE"], filename_prefix: ["STRING", { default: "ComfyUI" }] },
  }, [], { output_node: true });
  OBJ.PreviewImage = def("PreviewImage", "image", { required: { images: ["IMAGE"] } }, [], { output_node: true, display: "Save Image (Preview)" });
  OBJ.LoadImage = def("LoadImage", "image", {
    required: { image: [["example.png"], { image_upload: true }] },
  }, ["IMAGE", "MASK"]);
  OBJ.ImageScale = def("ImageScale", "image/upscaling", {
    required: {
      image: ["IMAGE"], upscale_method: [UPSCALE],
      width: ["INT", { default: 512, min: 1, max: 16384, step: 1 }],
      height: ["INT", { default: 512, min: 1, max: 16384, step: 1 }],
      crop: [["disabled", "center"]],
    },
  }, ["IMAGE"], { display: "Upscale Image" });
  OBJ.ImageInvert = def("ImageInvert", "image", { required: { image: ["IMAGE"] } }, ["IMAGE"]);
  OBJ.EasyNegativeEmbedding = def("EasyNegativeEmbedding", "conditioning", {
    required: { token_norm_strategy: [["scale_factor", "weighted_sum"]], conditioning: ["CONDITIONING"] },
  }, ["CONDITIONING"], { display: "Embedding Prompt" });

  /* ───────────────────────── OFM training (мок-ноды тренажёра) ───────────────────────── */
  OBJ.OFM_DatasetLoader = def("OFM_DatasetLoader", "OFM/training", {
    required: {
      dataset_dir: ["STRING", { default: "/workspace/datasets/influencer" }],
      caption_extension: [[".txt", ".caption"]],
      resolution: ["INT", { default: 1024, min: 256, max: 2048, step: 64 }],
    },
  }, ["DATASET"], { display: "OFM Dataset Loader", desc: "Dataset folder for LoRA training (30-40 images + captions)" });
  OBJ.OFM_TrainLora = def("OFM_TrainLora", "OFM/training", {
    required: {
      model: ["MODEL"], dataset: ["DATASET"],
      steps: ["INT", { default: 1500, min: 100, max: 100000, step: 100 }],
      learning_rate: ["FLOAT", { default: 0.0001, min: 0.0000001, max: 1.0, step: 0.000001 }],
      batch_size: ["INT", { default: 1, min: 1, max: 8, step: 1 }],
      trigger_word: ["STRING", { default: "ofm_influencer" }],
      output_name: ["STRING", { default: "ofm_influencer_v2" }],
    },
  }, ["LORA"], { display: "OFM Train LoRA", desc: "Runs LoRA training job on the pod (simulated in cloud console)" });
  OBJ.OFM_SaveLora = def("OFM_SaveLora", "OFM/training", {
    required: {
      lora: ["LORA"],
      filename_prefix: ["STRING", { default: "loras/ofm_influencer_v2" }],
    },
  }, [], { output_node: true, display: "OFM Save LoRA", desc: "Saves trained LoRA into /workspace/models/loras" });

  /* ───────────────────────── состояние очереди ───────────────────────── */
  var QUEUE = { running: [], pending: [] };
  var HISTORY = {};
  var seq = 0; // счётчик элементов очереди
  var UPLOADS = {}; // filename -> Blob
  var OUT_SEQ = 0;
  var INTERRUPT = false;
  var activeWS = []; // все открытые мок-сокеты

  function wsBroadcast(msg) {
    var text = typeof msg === "string" ? msg : JSON.stringify(msg);
    activeWS.forEach(function (ws) { ws._emitMessage(text); });
  }
  function sendStatus() {
    wsBroadcast({ type: "status", data: { status: { exec_info: { queue_remaining: QUEUE.running.length + QUEUE.pending.length } }, sid: null }, sid: null });
  }

  /* ───────────────────────── логи (для /internal/logs) ───────────────────────── */
  var LOGS = [
    { m: "Total VRAM 81920 MB, Total RAM 190434 MB", t: Date.now(), level: "" },
    { m: "Set torch.Thread to 8", t: Date.now(), level: "" },
    { m: "Import times for custom nodes:", t: Date.now(), level: "" },
    { m: "   0.0s (CLIPLoader etc.)", t: Date.now(), level: "" },
    { m: "** ComfyUI startup complete: torch 2.8.0+cu128", t: Date.now(), level: "" },
  ];

  /* ───────────────────────── папки моделей (для /internal/folder_paths) ───────────────────────── */
  var FOLDER_PATHS = [
    "checkpoints", "loras", "vae", "controlnet", "embeddings", "upscale_models",
    "clip", "clip_vision", "style_models", "diffusers", "diffusion_models", "unet", "photomaker",
  ].map(function (name) {
    return {
      name: name,
      paths: ["/workspace/ComfyUI/models/" + name, "/workspace/models/" + name],
    };
  });

  /* ───────────────────────── дефолтные воркфлоу (сидируются в userdata) ───────────────────────── */
  function wfGraph(nodes, links, lastId) {
    return { last_node_id: lastId, last_link_id: links.length, links: links, nodes: nodes, groups: [], config: {}, extra: {}, version: 0.4 };
  }
  function wfNode(id, type, pos, widgets, outs, ins, order) {
    return {
      id: id, type: type, pos: pos, size: [320, 130], flags: {}, order: order, mode: 0,
      inputs: ins || [], outputs: outs || [], properties: {}, widgets_values: widgets || [],
    };
  }

  // OFM LoRA Train — тренировочный пайплайн на мок-нодах тренажёра
  var TRAIN_WF = wfGraph([
    wfNode(1, "OFM_DatasetLoader", [80, 260], ["/workspace/datasets/influencer", ".txt", 1024], [{ name: "DATASET", type: "DATASET", links: [1] }], [], 0),
    wfNode(2, "CheckpointLoaderSimple", [80, 60], ["realvisxlV50_sdxl.safetensors"], [
      { name: "MODEL", type: "MODEL", links: [2] }, { name: "CLIP", type: "CLIP", links: [] }, { name: "VAE", type: "VAE", links: [] },
    ], [], 1),
    wfNode(3, "OFM_TrainLora", [520, 160], [1500, 0.0001, 1, "ofm_influencer", "ofm_influencer_v2"], [{ name: "LORA", type: "LORA", links: [3] }], [
      { name: "model", type: "MODEL", link: 2 }, { name: "dataset", type: "DATASET", link: 1 },
    ], 2),
    wfNode(4, "OFM_SaveLora", [940, 200], ["loras/ofm_influencer_v2"], [], [{ name: "lora", type: "LORA", link: 3 }], 3),
  ], [
    [1, 1, 0, 3, 1, "DATASET"],
    [2, 2, 0, 3, 0, "MODEL"],
    [3, 3, 0, 4, 0, "LORA"],
  ], 4);

  // OFM LoRA Test — генерация с обученной LoRA (фотореалистичные чекпойнты)
  var TEST_WF = wfGraph([
    wfNode(1, "CheckpointLoaderSimple", [40, 140], ["realvisxlV50_sdxl.safetensors"], [
      { name: "MODEL", type: "MODEL", links: [1] }, { name: "CLIP", type: "CLIP", links: [2] }, { name: "VAE", type: "VAE", links: [10] },
    ], [], 0),
    wfNode(2, "LoraLoader", [440, 140], ["ofm_influencer_v2.safetensors", 0.8, 0.8], [
      { name: "MODEL", type: "MODEL", links: [3] }, { name: "CLIP", type: "CLIP", links: [4] },
    ], [
      { name: "model", type: "MODEL", link: 1 }, { name: "clip", type: "CLIP", link: 2 },
    ], 1),
    wfNode(3, "CLIPTextEncode", [440, 380], ["photo of a stylish fashion influencer, ofm_influencer, natural skin texture, soft studio lighting, instagram photo, 85mm lens, highly detailed"], [{ name: "CONDITIONING", type: "CONDITIONING", links: [5] }], [{ name: "clip", type: "CLIP", link: 4 }], 2),
    wfNode(4, "CLIPTextEncode", [440, 570], ["lowres, blurry, deformed hands, watermark, text, jpeg artifacts"], [{ name: "CONDITIONING", type: "CONDITIONING", links: [6] }], [{ name: "clip", type: "CLIP", link: 4 }], 2),
    wfNode(5, "EmptyLatentImage", [440, 760], [832, 1216, 1], [{ name: "LATENT", type: "LATENT", links: [7] }], [], 0),
    wfNode(6, "KSampler", [880, 180], [42, "fixed", 30, 6.5, "dpmpp_2m", "karras", 1.0], [{ name: "LATENT", type: "LATENT", links: [8] }], [
      { name: "model", type: "MODEL", link: 3 }, { name: "positive", type: "CONDITIONING", link: 5 },
      { name: "negative", type: "CONDITIONING", link: 6 }, { name: "latent_image", type: "LATENT", link: 7 },
    ], 3),
    wfNode(7, "VAEDecode", [1280, 200], [], [{ name: "IMAGE", type: "IMAGE", links: [9] }], [
      { name: "samples", type: "LATENT", link: 8 }, { name: "vae", type: "VAE", link: 10 },
    ], 4),
    wfNode(8, "SaveImage", [1280, 440], ["ofm_lora_test"], [], [{ name: "images", type: "IMAGE", link: 9 }], 5),
  ], [
    [1, 1, 0, 2, 0, "MODEL"],
    [2, 1, 1, 2, 1, "CLIP"],
    [3, 2, 0, 6, 0, "MODEL"],
    [4, 2, 1, 3, 1, "CLIP"],
    [5, 2, 1, 4, 1, "CLIP"],
    [6, 4, 0, 6, 2, "CONDITIONING"],
    [7, 5, 0, 6, 3, "LATENT"],
    [8, 6, 0, 7, 0, "LATENT"],
    [9, 7, 0, 8, 0, "IMAGE"],
    [10, 1, 2, 7, 1, "VAE"],
  ], 8);

  function seedWorkflows() {
    try {
      var tw = LS.userdata + "workflows/ofm_lora_train.json";
      var te = LS.userdata + "workflows/ofm_lora_test.json";
      var old = localStorage.getItem(tw);
      if (!old || old.indexOf("last_link_id") < 0) localStorage.setItem(tw, JSON.stringify(TRAIN_WF));
      old = localStorage.getItem(te);
      if (!old || old.indexOf("last_link_id") < 0) localStorage.setItem(te, JSON.stringify(TEST_WF));
    } catch (e) { /* no-op */ }
  }
  seedWorkflows();

  /* ───────────────────────── выполнение промпта ───────────────────────── */
  function randId() { return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }

  function findNode(prompt, pred) {
    var keys = Object.keys(prompt || {});
    for (var i = 0; i < keys.length; i++) {
      var n = prompt[keys[i]];
      if (n && pred(n.class_type || "")) return { id: keys[i], node: n };
    }
    return null;
  }

  function runPrompt(prompt, clientId) {
    var pid = randId();
    var sampler = findNode(prompt, function (t) { return t === "KSampler" || t === "KSamplerAdvanced" || t === "SamplerCustom"; });
    var steps = (sampler && sampler.node.inputs && +sampler.node.inputs.steps) || 20;
    var outputs = [];
    var seed = (sampler && sampler.node.inputs && (sampler.node.inputs.seed != null ? sampler.node.inputs.seed : sampler.node.inputs.noise_seed)) || 42;
    Object.keys(prompt).forEach(function (nid) {
      var t = prompt[nid].class_type || "";
      if (t === "SaveImage" || t === "PreviewImage" || t === "SaveAnimatedWEBP" || t === "VHS_VideoCombine") {
        var prefix = (prompt[nid].inputs && prompt[nid].inputs.filename_prefix) || "ComfyUI";
        outputs.push({ nid: nid, filename: prefix + "_" + String(++OUT_SEQ).padStart(5, "0") + "_.png", seed: seed });
      }
    });

    QUEUE.running.push({ number: ++seq, prompt_id: pid, prompt: [seq, pid, prompt, {}, []] });
    sendStatus();

    var stepMs = Math.max(60, Math.min(280, 9000 / Math.max(steps, 1)));
    var t0 = 300;
    var total = steps * stepMs;
    var interrupted = false;

    function later(ms, fn) { setTimeout(fn, ms); }

    later(t0, function () {
      if (INTERRUPT) { finishInterrupted(pid); return; }
      wsBroadcast({ type: "execution_start", data: { prompt_id: pid }, sid: null });
      // «executing» по узлам графа
      var nids = Object.keys(prompt);
      var i = 0;
      function nextNode() {
        if (INTERRUPT) { finishInterrupted(pid); return; }
        if (i >= nids.length) { startSampling(); return; }
        var nid = nids[i++];
        wsBroadcast({ type: "executing", data: { node: nid, display_node: nid, prompt_id: pid }, sid: null });
        later(120 + Math.random() * 260, nextNode);
      }
      nextNode();
    });

    function startSampling() {
      var snid = sampler ? sampler.id : null;
      var v = 0;
      var iv = setInterval(function () {
        if (INTERRUPT) { clearInterval(iv); finishInterrupted(pid); return; }
        v += stepMs;
        var p = Math.min(v / total, 1);
        wsBroadcast({ type: "progress", data: { value: p * steps, max: steps, prompt_id: pid, node: snid || "" }, sid: null });
        if (p >= 1) { clearInterval(iv); deliver(); }
      }, stepMs);
    }

    function deliver() {
      var outMap = {};
      outputs.forEach(function (o) {
        outMap[o.nid] = { images: [{ filename: o.filename, subfolder: "", type: "output" }] };
      });
      QUEUE.running = QUEUE.running.filter(function (q) { return q.prompt_id !== pid; });
      HISTORY[pid] = {
        prompt: [seq, pid, prompt, {}, outMap],
        outputs: outMap,
        status: { status_str: "success", completed: true, messages: [["execution_success", { prompt_id: pid }]] },
      };
      outputs.forEach(function (o) {
        wsBroadcast({ type: "executed", data: { node: o.nid, prompt_id: pid, output: outMap[o.nid] }, sid: null });
      });
      wsBroadcast({ type: "execution_success", data: { prompt_id: pid }, sid: null });
      // классический сигнал конца промпта — без него фронт считает выполнение незавершённым
      wsBroadcast({ type: "executing", data: { node: null, display_node: null, prompt_id: pid }, sid: null });
      LOGS.push({ m: "Prompt " + pid + " executed in " + (total / 1000).toFixed(2) + "s (seed " + seed + ")", t: Date.now(), level: "" });
      if (LOGS.length > 60) LOGS = LOGS.slice(-60);
      sendStatus();
    }

    function finishInterrupted(pid) {
      INTERRUPT = false;
      QUEUE.running = QUEUE.running.filter(function (q) { return q.prompt_id !== pid; });
      wsBroadcast({ type: "execution_interrupted", data: { prompt_id: pid }, sid: null });
      wsBroadcast({ type: "executing", data: { node: null, display_node: null, prompt_id: pid }, sid: null });
      sendStatus();
    }
  }

  /* ───────────────────────── PNG для /view ───────────────────────── */
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function renderPng(filename) {
    try {
      var m = /(\d+)/.exec(filename || "");
      var seed = m ? parseInt(m[1], 10) : 42;
      var r = mulberry(seed * 2654435761);
      var S = 512;
      var cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      var g = cv.getContext("2d");
      g.fillStyle = "#12121a"; g.fillRect(0, 0, S, S);
      // мягкие сиреневые пятна
      for (var i = 0; i < 26; i++) {
        var x = r() * S, y = r() * S, rad = 40 + r() * 150;
        var grad = g.createRadialGradient(x, y, 0, x, y, rad);
        var hue = 252 + r() * 24;
        grad.addColorStop(0, "hsla(" + hue + ",64%," + (52 + r() * 24) + "%," + (0.10 + r() * 0.30) + ")");
        grad.addColorStop(1, "hsla(" + hue + ",64%,60%,0)");
        g.fillStyle = grad;
        g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      }
      // дизеринг-шум
      for (var d = 0; d < 2600; d++) {
        g.fillStyle = r() < 0.5 ? "rgba(220,205,255," + (0.05 + r() * 0.25) + ")" : "rgba(10,8,18," + (0.05 + r() * 0.2) + ")";
        g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1, 1);
      }
      // рамка-подпись
      g.fillStyle = "rgba(8,8,14,0.72)"; g.fillRect(0, S - 54, S, 54);
      g.fillStyle = "#d4c8ff"; g.font = "600 22px ui-monospace, Consolas, monospace";
      g.fillText("OFM Cloud · ComfyUI", 18, S - 30);
      g.fillStyle = "#8b8b98"; g.font = "13px ui-monospace, Consolas, monospace";
      g.fillText((filename || "preview.png") + "  ·  seed " + seed, 18, S - 12);

      // toDataURL — синхронно: toBlob в этом окружении кодирует по несколько секунд
      var dataUrl = cv.toDataURL("image/png");
      return fetch(dataUrl).then(function (r2) { return r2.blob(); });
    } catch (e) {
      try { window.__ofmRenderErr = String((e && e.stack) || e).slice(0, 300); } catch (e2) { /* no-op */ }
      var cv2 = document.createElement("canvas");
      cv2.width = 256; cv2.height = 256;
      var g2 = cv2.getContext("2d");
      g2.fillStyle = "#8b5cf6"; g2.fillRect(0, 0, 256, 256);
      var fallbackUrl = cv2.toDataURL("image/png");
      return fetch(fallbackUrl).then(function (r2) { return r2.blob(); });
    }
  }
  window.__ofmRenderPng = renderPng; // диагностика

  /* ───────────────────────── роутер API ───────────────────────── */
  function resp(body, status, type) {
    var headers = { "Content-Type": type || "application/json" };
    return new Response(body == null ? "" : body, { status: status || 200, headers: headers });
  }
  function jresp(obj, status) { return resp(JSON.stringify(obj == null ? {} : obj), status); }

  function parseBody(body, contentType) {
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return null; }
  }

  function listUserdata(dir, recurse, fullInfo) {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LS.userdata) === 0) {
        var p = k.slice(LS.userdata.length);
        if (!dir || p.indexOf(dir) === 0) out.push(p);
      }
    }
    out.sort();
    if (fullInfo) {
      return out.map(function (p) {
        var v = localStorage.getItem(LS.userdata + p) || "";
        return { path: p, size: v.length, modified: Date.now() };
      });
    }
    return out;
  }

  function route(method, urlPath, query, bodyText) {
    var segs = urlPath.replace(/^\/api\//, "").split("/");

    if (method === "GET" && urlPath === "/api/users") {
      // нет ключа "users" → однопользовательский режим, без диалога логина
      return jresp({ migrated: false });
    }
    if (method === "POST" && urlPath === "/api/users") return jresp({});

    if (method === "GET" && urlPath === "/api/settings") return jresp(settings);
    if (method === "POST" && urlPath === "/api/settings") { try { Object.assign(settings, JSON.parse(bodyText || "{}")); } catch (e) {} saveSettings(); return jresp({}); }
    if (method === "POST" && urlPath.indexOf("/api/settings/") === 0) {
      var id = decodeURIComponent(urlPath.slice("/api/settings/".length));
      try { settings[id] = JSON.parse(bodyText); } catch (e) { settings[id] = bodyText; }
      saveSettings(); return jresp({});
    }

    if (method === "GET" && urlPath === "/api/extensions") {
      // фронт склеивает путь через fileURL (api_base + route) → путь БЕЗ BASE
      return jresp(["/extensions/ofm-manager.js"]);
    }

    /* каталог из воркфлоу: закрывает ВСЕ типы нод 15 воркфлоу (рукописные
       дефы выше главнее) — «Missing Node Types» в превью больше не бывает */
    var GEN = (typeof window !== "undefined" && window.OFM_NODE_DEFS) || {};
    for (var gk in GEN) if (!OBJ[gk]) OBJ[gk] = GEN[gk];

    if (method === "GET" && urlPath === "/api/object_info") return jresp(OBJ);
    if (method === "GET" && urlPath.indexOf("/api/object_info/") === 0) {
      var nt = decodeURIComponent(urlPath.slice("/api/object_info/".length));
      return jresp(OBJ[nt] ? OBJ[nt] : {});
    }

    if (method === "POST" && urlPath === "/api/prompt") {
      var p = parseBody(bodyText) || {};
      var promptObj = p.prompt || {};
      runPrompt(promptObj, p.client_id);
      var firstOutput = null;
      return jresp({ prompt_id: QUEUE.running.length ? QUEUE.running[QUEUE.running.length - 1].prompt_id : randId(), number: QUEUE.pending.length + QUEUE.running.length, node_errors: {} });
    }
    if (method === "DELETE" && urlPath === "/api/prompt") { QUEUE.pending = []; sendStatus(); return jresp({}); }
    if (method === "POST" && urlPath === "/api/queue") {
      var q = parseBody(bodyText) || {};
      if (q.clear) QUEUE.pending = [];
      if (Array.isArray(q.delete)) QUEUE.pending = QUEUE.pending.filter(function (it) { return q.delete.indexOf(it.prompt_id) < 0; });
      sendStatus(); return jresp({});
    }
    if (method === "GET" && urlPath === "/api/queue") {
      return jresp({ queue_running: QUEUE.running, queue_pending: QUEUE.pending });
    }
    if (method === "POST" && urlPath === "/api/interrupt") { INTERRUPT = true; return jresp({}); }
    if (method === "POST" && urlPath === "/api/free") { LOGS.push({ m: "Freed memory (unload_models + free_memory)", t: Date.now(), level: "" }); return jresp({}); }
    if (method === "GET" && urlPath.indexOf("/api/models") === 0) return jresp([]);
    // /experiment/models* — фронт ожидает 404 → возвращает [] (иначе .filter падает)
    if (method === "GET" && urlPath.indexOf("/api/experiment/") === 0) return jresp({ error: "not found" }, 404);
    if (method === "GET" && urlPath.indexOf("/api/history") === 0) return jresp(HISTORY);
    if (method === "GET" && urlPath === "/api/embeddings") return jresp(["easynegative.safetensors", "ofm_style.safetensors", "badhandv4.pt"]);
    if (method === "GET" && urlPath === "/api/workflow_templates") return jresp({});
    if (method === "GET" && urlPath === "/api/system_stats") {
      return jresp({
        system: { os: "linux", ram_total: 190434, ram_free: 152000, comfyui_version: "0.3.44", python_version: "3.11.9", pytorch_version: "2.8.0+cu128", argv: ["--port", "3000"] },
        devices: [{ name: "NVIDIA RTX PRO 6000 Workstation Edition", type: "cuda", index: 0, vram_total: 85899345920, vram_free: 80483139584, torch_version: "2.8.0+cu128" }],
      });
    }

    // userdata
    if (urlPath.indexOf("/api/userdata") === 0) {
      if (method === "GET" && !segs[1]) {
        return jresp(listUserdata(query.get("dir") || "", query.get("recurse") !== "false", query.get("full_info") === "true"));
      }
      var path2 = decodeURIComponent(urlPath.slice("/api/userdata/".length));
      if (method === "GET") {
        var v2 = localStorage.getItem(LS.userdata + path2);
        return v2 == null ? jresp({ error: "file not found" }, 404) : resp(v2, 200, "application/json");
      }
      if (method === "POST") { localStorage.setItem(LS.userdata + path2, bodyText || ""); return jresp({}); }
      if (method === "DELETE") { localStorage.removeItem(LS.userdata + path2); return jresp({}); }
    }

    // upload/image
    if (method === "POST" && urlPath === "/api/upload/image") {
      // fetch-путь: body — FormData (не парсим как JSON)
      return null; // обрабатывается отдельным хуком (см. fetch patch)
    }

    // /view
    if (method === "GET" && urlPath === "/view") return null; // отдельный хук

    return jresp({}, 200);
  }

  /* ───────────────────────── URL-утилиты ───────────────────────── */
  function splitUrl(u) {
    var a = document.createElement("a");
    a.href = u;
    var path = a.pathname.replace(/\/$/, "") || "/";
    var query = new URLSearchParams(a.search);
    return { path: path, query: query, origin: a.origin };
  }
  function isApiUrl(u) {
    var s = splitUrl(u);
    if (s.origin && s.origin !== location.origin) return false;
    if (/sorted-custom-node-map\.json/.test(s.path)) return true;
    if (BASE && s.path.indexOf(BASE + "/") === 0) s.path = s.path.slice(BASE.length);
    return s.path.indexOf("/api/") === 0 || s.path === "/view" || s.path.indexOf("/internal/") === 0;
  }
  function normApi(u) {
    var s = splitUrl(u);
    var p = s.path;
    if (BASE && p.indexOf(BASE + "/") === 0) p = p.slice(BASE.length);
    return { path: p, query: s.query };
  }

  /* ───────────────────────── журнал API (диагностика) ───────────────────────── */
  window.__ofmApiLog = [];
  function apiLog(method, path) {
    try {
      var L = window.__ofmApiLog;
      L.push(method + " " + path);
      if (L.length > 400) L.splice(0, L.length - 400);
    } catch (e) { /* no-op */ }
  }

  /* ───────────────────────── fetch patch ───────────────────────── */
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (!isApiUrl(url)) return origFetch(input, init);
    var method = (init && init.method) || (input && input.method) || "GET";
    method = String(method).toUpperCase();
    var n = normApi(url);
    apiLog(method, n.path + (n.query.toString() ? "?" + n.query.toString() : ""));

    // upload/image — читаем FormData в UPLOADS
    if (n.path === "/api/upload/image" && method === "POST") {
      var fd = (init && init.body) || (input && input.body);
      var name = "uploaded_" + randId() + ".png";
      var done = Promise.resolve(new Response(JSON.stringify({ name: name, subfolder: "", type: "input" }), { status: 200, headers: { "Content-Type": "application/json" } }));
      try {
        if (fd && typeof fd.get === "function") {
          var file = fd.get("image");
          if (file) {
            name = file.name || name;
            if (file.arrayBuffer) {
              file.arrayBuffer().then(function (ab) {
                UPLOADS[name] = new Blob([ab], { type: file.type || "image/png" });
                LOGS.push({ m: "Uploaded image: " + name, t: Date.now(), level: "" });
              });
            }
          }
        }
      } catch (e) { /* no-op */ }
      return done;
    }

    // /view → PNG (или загруженная картинка). Фронт строит URL как /api/view?... (apiURL добавляет /api)
    if (n.path === "/view" || n.path === "/api/view") {
      var fn = n.query.get("filename") || "";
      if (n.query.get("type") === "input" && UPLOADS[fn]) {
        return Promise.resolve(new Response(UPLOADS[fn], { status: 200, headers: { "Content-Type": UPLOADS[fn].type || "image/png" } }));
      }
      return renderPng(fn).then(function (b) { return new Response(b, { status: 200, headers: { "Content-Type": "image/png" } }); });
    }

    // text-мод ReadableStream недоступен для our Response из blob — читаем как есть
    var bodyText = init && typeof init.body === "string" ? init.body : null;
    try {
      var out = route(method, n.path, n.query, bodyText);
      if (out) return Promise.resolve(out);
    } catch (err) {
      return Promise.resolve(jresp({ error: String(err) }, 500));
    }
    return Promise.resolve(jresp({}));
  };

  /* ───────────────────────── <img src="/view?..."> через fetch → blob ─────────────────────────
     Фронт рендерит превью нод через new Image() с src=/comfy/view?... — прямой HTTP-запрос не
     попадает в перехватчик fetch и даёт 404. Перенаправляем такие src через fetch → blob URL. */
  try {
    var imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (imgSrcDesc && imgSrcDesc.set) {
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        enumerable: imgSrcDesc.enumerable,
        get: function () { return imgSrcDesc.get.call(this); },
        set: function (v) {
          var self = this;
          var u = String(v == null ? "" : v);
          var isView = false;
          try { isView = /\/(api\/)?view$/.test(splitUrl(u).path) || /\/(api\/)?view\?/.test(u); } catch (e) {}
          if (!isView) { imgSrcDesc.set.call(this, u); return; }
          fetch(u).then(function (r) { return r.blob(); }).then(function (b) {
            imgSrcDesc.set.call(self, URL.createObjectURL(b));
          }).catch(function () { imgSrcDesc.set.call(self, u); });
        },
      });
    }
  } catch (e) { /* no-op */ }

  /* ───────────────────────── XHR patch (axios → /internal/logs, templates pass-through) ───────────────────────── */
  var XHR = XMLHttpRequest.prototype;
  var origOpen = XHR.open;
  var origSend = XHR.send;
  XHR.open = function (method, url) {
    this.__ofmUrl = String(url || "");
    this.__ofmMethod = String(method || "GET").toUpperCase();
    return origOpen.apply(this, arguments);
  };
  XHR.send = function (body) {
    var self = this;
    if (self.__ofmUrl && isApiUrl(self.__ofmUrl)) {
      var n = normApi(self.__ofmUrl);
      setTimeout(function () {
        var payload = "{}";
        var status = 200;
        try {
          if (n.path === "/internal/logs" && self.__ofmMethod === "GET") payload = JSON.stringify({ entries: LOGS.slice(-40), size: LOGS.length });
          else if (n.path === "/internal/logs/raw" && self.__ofmMethod === "GET") payload = LOGS.map(function (l) { return l.m; }).join("\n");
          else if (n.path === "/internal/folder_paths" && self.__ofmMethod === "GET") payload = JSON.stringify(FOLDER_PATHS);
          else if (/sorted-custom-node-map\.json/.test(self.__ofmUrl)) payload = "{}";
          else if (n.path.indexOf("/internal/") === 0) payload = "{}";
          else payload = "{}";
        } catch (e) { payload = "{}"; }
        try {
          Object.defineProperty(self, "readyState", { value: 4, configurable: true });
          Object.defineProperty(self, "status", { value: status, configurable: true });
          Object.defineProperty(self, "responseText", { value: payload, configurable: true });
          Object.defineProperty(self, "response", { value: payload, configurable: true });
          Object.defineProperty(self, "responseURL", { value: self.__ofmUrl, configurable: true });
          self.getAllResponseHeaders = function () { return "content-type: application/json\r\n"; };
          self.getResponseHeader = function (h) { return String(h).toLowerCase() === "content-type" ? "application/json" : null; };
          if (self.onreadystatechange) try { self.onreadystatechange(new Event("readystatechange")); } catch (e) {}
          try { self.dispatchEvent(new Event("readystatechange")); } catch (e) {}
          if (self.onload) try { self.onload(new ProgressEvent("load")); } catch (e) {}
          try { self.dispatchEvent(new ProgressEvent("load")); } catch (e) {}
          try { self.dispatchEvent(new ProgressEvent("loadend")); } catch (e) {}
          if (self.onloadend) try { self.onloadend(new ProgressEvent("loadend")); } catch (e) {}
        } catch (e) { /* no-op */ }
      }, 20);
      return;
    }
    return origSend.apply(this, arguments);
  };

  /* ───────────────────────── WebSocket mock ───────────────────────── */
  function MockWS(url) {
    this.url = url;
    this.binaryType = "blob";
    this.readyState = 0; // CONNECTING
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
    this._listeners = {};
    var self = this;
    activeWS.push(this);
    setTimeout(function () {
      self.readyState = 1; // OPEN
      self._fire("open", new Event("open"));
      if (self.onopen) try { self.onopen(new Event("open")); } catch (e) {}
      sendStatusTo(self);
    }, 30);
  }
  MockWS.prototype._fire = function (type, ev) {
    var ls = (this._listeners[type] || []).slice();
    for (var i = 0; i < ls.length; i++) { try { ls[i].call(this, ev); } catch (e) {} }
  };
  MockWS.prototype._emitMessage = function (text) {
    var ev = new MessageEvent("message", { data: text });
    this._fire("message", ev);
    if (this.onmessage) try { this.onmessage(ev); } catch (e) {}
  };
  MockWS.prototype.addEventListener = function (type, cb) { (this._listeners[type] = this._listeners[type] || []).push(cb); };
  MockWS.prototype.removeEventListener = function (type, cb) {
    var ls = this._listeners[type] || [];
    var i = ls.indexOf(cb); if (i >= 0) ls.splice(i, 1);
  };
  MockWS.prototype.send = function (data) {
    // клиентские сообщения: status / interrupt — просто отдаём статус
    try {
      var m = JSON.parse(data);
      if (m.type === "status") sendStatusTo(this);
    } catch (e) { /* no-op */ }
  };
  MockWS.prototype.close = function () {
    this.readyState = 3;
    activeWS = activeWS.filter(function (w) { return w !== this; }, this);
    this._fire("close", new Event("close"));
    if (this.onclose) try { this.onclose(new Event("close")); } catch (e) {}
  };
  function sendStatusTo(ws) {
    var text = JSON.stringify({ type: "status", data: { status: { exec_info: { queue_remaining: QUEUE.running.length + QUEUE.pending.length } }, sid: null }, sid: null });
    ws._emitMessage(text);
  }
  MockWS.OPEN = 1; MockWS.CONNECTING = 0; MockWS.CLOSING = 2; MockWS.CLOSED = 3;
  MockWS.prototype.CONNECTING = 0; MockWS.prototype.OPEN = 1; MockWS.prototype.CLOSING = 2; MockWS.prototype.CLOSED = 3;

  window.WebSocket = function (url, protocols) {
    var isOfm = false;
    try { isOfm = /\/ws(\?|$)/.test(splitUrl(url).path + "?"); } catch (e) {}
    if (!isOfm) {
      // посторонние сокеты (sentry и т.п.) — тихо закрываем
      var stub = new EventTarget();
      stub.binaryType = "blob"; stub.readyState = 3; stub.url = url;
      stub.send = function () {}; stub.close = function () {};
      setTimeout(function () { try { stub.dispatchEvent(new Event("close")); } catch (e) {} }, 0);
      return stub;
    }
    return new MockWS(url);
  };
  window.WebSocket.prototype = MockWS.prototype;
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;

  /* ───────────────────────── ловушка ошибок (диагностика) ───────────────────────── */
  window.__ofmErrors = [];
  window.addEventListener("error", function (e) {
    var st = e.error && e.error.stack ? e.error.stack : e.message;
    window.__ofmErrors.push("E: " + String(st).slice(0, 800));
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    var st = r && r.stack ? r.stack : String(r);
    window.__ofmErrors.push("R: " + String(st).slice(0, 800));
  });
  ["error", "warn"].forEach(function (lvl) {
    var orig = console[lvl].bind(console);
    console[lvl] = function () {
      try {
        var args = Array.prototype.slice.call(arguments).map(function (a) {
          return typeof a === "string" ? a : (a && a.stack) || (a && a.message) || JSON.stringify(a);
        });
        if (args.join(" ").length > 0) window.__ofmErrors.push(lvl[0].toUpperCase() + ": " + args.join(" | ").slice(0, 600));
      } catch (e) { /* no-op */ }
      orig.apply(null, arguments);
    };
  });
})();
