(() => {
  "use strict";

  const DB_NAME = "cvat_ipad_offline_v1";
  const DB_VERSION = 1;
  const STORE_META = "meta";
  const STORE_PHOTOS = "photos";
  const ACTIVE_KEY = "active_project";

  const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp"]);
  const DEFAULT_LABEL_COLORS = {
    plant_target: "#22c55e",
    soil_target: "#d97706",
    other_plant: "#06b6d4",
    pot_rim_wall: "#a855f7",
    card_label: "#eab308",
    other_background: "#64748b",
    ignore_uncertain: "#ef4444",
  };
  const FALLBACK_PALETTE = [
    "#3b82f6",
    "#ec4899",
    "#14b8a6",
    "#f97316",
    "#84cc16",
    "#6366f1",
    "#f43f5e",
    "#0ea5e9",
  ];

  function utcNowCvat() {
    const iso = new Date().toISOString();
    return iso.replace("T", " ").replace("Z", "000+00:00");
  }

  function deterministicColor(name) {
    if (DEFAULT_LABEL_COLORS[name]) return DEFAULT_LABEL_COLORS[name];
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
  }

  function extOf(name) {
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx).toLowerCase() : "";
  }

  function mimeForName(name) {
    const ext = extOf(name);
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".bmp") return "image/bmp";
    if (ext === ".tif" || ext === ".tiff") return "image/tiff";
    return "image/jpeg";
  }

  function normalizeRelPath(raw) {
    return String(raw || "")
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/^\/+/, "");
  }

  function baseName(raw) {
    const clean = normalizeRelPath(raw);
    const idx = clean.lastIndexOf("/");
    return idx >= 0 ? clean.slice(idx + 1) : clean;
  }

  function isIgnoredArchivePath(relPath) {
    const clean = normalizeRelPath(relPath);
    if (!clean || clean.endsWith("/")) return true;
    if (clean.startsWith("__MACOSX/") || clean.includes("/__MACOSX/")) return true;
    const b = baseName(clean);
    return b.startsWith("._") || b === ".DS_Store";
  }

  function sanitizeBatchName(rawName) {
    const clean = String(rawName || "lote_ipad")
      .replace(/\.zip$/i, "")
      .replace(/^anotacion_/, "")
      .replace(/_para_ipad$/i, "")
      .replace(/_ipad_bundle$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return clean || "lote_ipad";
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
          db.createObjectStore(STORE_PHOTOS, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("No se pudo abrir IndexedDB"));
    });
  }

  function idbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAllKeys(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function measureBlobDimensions(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const dims = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dims);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo leer dimensiones de imagen"));
      };
      img.src = url;
    });
  }

  function parsePointsAttr(pointsStr) {
    const out = [];
    for (const pair of String(pointsStr || "").trim().split(";")) {
      const clean = pair.trim();
      if (!clean) continue;
      const parts = clean.split(",");
      if (parts.length !== 2) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.push({ x, y });
      }
    }
    return out;
  }

  function buildDefaultXmlDoc(entries, taskName) {
    const doc = document.implementation.createDocument("", "annotations", null);
    const root = doc.documentElement;
    const now = utcNowCvat();

    const el = (tag, text, attrs) => {
      const node = doc.createElement(tag);
      if (text !== undefined && text !== null) node.textContent = String(text);
      if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
          node.setAttribute(k, String(v));
        }
      }
      return node;
    };

    root.appendChild(el("version", "1.1"));
    const meta = el("meta");
    const task = el("task");
    task.appendChild(el("id", "1"));
    task.appendChild(el("name", taskName || "cvat_ipad_offline"));
    task.appendChild(el("size", String(entries.length)));
    task.appendChild(el("mode", "annotation"));
    task.appendChild(el("overlap", "0"));
    task.appendChild(el("bugtracker", ""));
    task.appendChild(el("created", now));
    task.appendChild(el("updated", now));

    const labelsEl = el("labels");
    for (const [lblName, color] of Object.entries(DEFAULT_LABEL_COLORS)) {
      const lbl = el("label");
      lbl.appendChild(el("name", lblName));
      lbl.appendChild(el("color", color));
      lbl.appendChild(el("type", "mask"));
      lbl.appendChild(el("attributes"));
      labelsEl.appendChild(lbl);
    }
    task.appendChild(labelsEl);
    meta.appendChild(task);
    meta.appendChild(el("dumped", now));
    root.appendChild(meta);

    entries.forEach((entry, idx) => {
      root.appendChild(
        el("image", null, {
          id: String(entry.id ?? idx),
          name: entry.name,
          width: String(entry.width),
          height: String(entry.height),
        })
      );
    });

    return doc;
  }

  function serializeXmlDoc(doc) {
    const formatNode = (node, depth) => {
      if (node.nodeType !== 1) return;
      const children = Array.from(node.childNodes).filter((c) => c.nodeType === 1);
      if (children.length === 0) return;
      // Remove pure whitespace text nodes
      Array.from(node.childNodes).forEach((c) => {
        if (c.nodeType === 3 && !c.nodeValue.trim()) {
          node.removeChild(c);
        }
      });
      const indent = "\n" + "  ".repeat(depth + 1);
      const closingIndent = "\n" + "  ".repeat(depth);
      const elementChildren = Array.from(node.children);
      for (const child of elementChildren) {
        node.insertBefore(doc.createTextNode(indent), child);
        formatNode(child, depth + 1);
      }
      node.appendChild(doc.createTextNode(closingIndent));
    };

    const clone = doc.cloneNode(true);
    formatNode(clone.documentElement, 0);
    const body = new XMLSerializer().serializeToString(clone);
    return `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`;
  }

  class OfflineWorkspaceManager {
    constructor() {
      this.db = null;
      this.projectName = "lote_ipad";
      this.doc = null;
      this.xmlText = "";
      this.photoKeys = new Map(); // imageId -> photoKey in IndexedDB
      this.photoUrls = new Map(); // photoKey -> objectURL
      this.updatedAt = null;
    }

    async ensureDb() {
      if (!this.db) {
        this.db = await openDb();
      }
      return this.db;
    }

    revokeAllUrls() {
      for (const url of this.photoUrls.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
      this.photoUrls.clear();
    }

    parseXml(xmlStr) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlStr, "application/xml");
      const err = doc.querySelector("parsererror");
      if (err) {
        throw new Error(`XML inválido: ${err.textContent.slice(0, 140)}`);
      }
      if (!doc.documentElement || doc.documentElement.tagName !== "annotations") {
        throw new Error("El XML no tiene raíz <annotations> de CVAT 1.1");
      }
      return doc;
    }

    resolvePhotoKeyForImage(imageName, availableKeys) {
      const norm = normalizeRelPath(imageName);
      const strippedImages = norm.replace(/^images\//i, "");
      const base = baseName(norm);

      if (availableKeys.has(norm)) return norm;
      if (availableKeys.has(strippedImages)) return strippedImages;
      if (availableKeys.has(`images/${strippedImages}`)) return `images/${strippedImages}`;

      for (const k of availableKeys) {
        const kn = normalizeRelPath(k).replace(/^images\//i, "");
        if (kn === strippedImages) return k;
      }
      for (const k of availableKeys) {
        if (baseName(k).toLowerCase() === base.toLowerCase()) return k;
      }
      return null;
    }

    async loadSavedProject() {
      const db = await this.ensureDb();
      const saved = await idbGet(db, STORE_META, ACTIVE_KEY);
      if (!saved || !saved.xmlText) return false;

      const keys = new Set(await idbGetAllKeys(db, STORE_PHOTOS));
      this.revokeAllUrls();
      this.projectName = saved.projectName || "lote_ipad";
      this.updatedAt = saved.updatedAt || null;
      this.doc = this.parseXml(saved.xmlText);
      this.xmlText = saved.xmlText;
      this.rebuildPhotoKeyMap(keys);
      return true;
    }

    rebuildPhotoKeyMap(availableKeys) {
      this.photoKeys.clear();
      if (!this.doc) return;
      const imgs = Array.from(this.doc.documentElement.querySelectorAll(":scope > image"));
      imgs.forEach((imgEl, idx) => {
        const imgId = imgEl.getAttribute("id") || String(idx);
        const name = imgEl.getAttribute("name") || `image_${idx}`;
        const key = this.resolvePhotoKeyForImage(name, availableKeys);
        if (key) this.photoKeys.set(imgId, key);
      });
    }

    async importFiles(fileList) {
      const files = Array.from(fileList || []);
      if (files.length === 0) {
        throw new Error("No se seleccionó ningún archivo.");
      }

      const JSZipLib = window.JSZip;
      const collectedImages = new Map(); // normalized path -> { blob, name }
      let xmlCandidateText = null;
      let inferredProjectName = null;

      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".zip")) {
          if (!JSZipLib) {
            throw new Error("No se encontró JSZip en local para descomprimir ZIPs.");
          }
          if (!inferredProjectName) {
            inferredProjectName = sanitizeBatchName(file.name);
          }
          const zip = await JSZipLib.loadAsync(file);
          const entries = Object.values(zip.files);
          for (const entry of entries) {
            if (entry.dir || isIgnoredArchivePath(entry.name)) continue;
            const entryClean = normalizeRelPath(entry.name);
            const entryBase = baseName(entryClean).toLowerCase();
            if (entryBase === "annotations.xml" || (entryBase.endsWith(".xml") && !xmlCandidateText)) {
              const text = await entry.async("string");
              if (text.includes("<annotations")) {
                xmlCandidateText = text;
              }
            } else if (IMAGE_EXTS.has(extOf(entryBase))) {
              const rawBlob = await entry.async("blob");
              const typedBlob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: mimeForName(entryClean) });
              collectedImages.set(entryClean, { blob: typedBlob, name: entryClean });
            }
          }
        } else if (lower.endsWith(".xml")) {
          const text = await file.text();
          if (text.includes("<annotations")) {
            xmlCandidateText = text;
          }
        } else if (IMAGE_EXTS.has(extOf(lower))) {
          const clean = normalizeRelPath(file.webkitRelativePath || file.name);
          collectedImages.set(clean, { blob: file, name: clean });
        }
      }

      if (collectedImages.size === 0 && !xmlCandidateText) {
        throw new Error("No se encontraron imágenes ni un annotations.xml válido.");
      }

      // If only an XML was imported while images already exist in IndexedDB, keep existing photos!
      const db = await this.ensureDb();
      let existingKeys = new Set();
      if (collectedImages.size === 0) {
        existingKeys = new Set(await idbGetAllKeys(db, STORE_PHOTOS));
        if (existingKeys.size === 0) {
          throw new Error("Has cargado un XML sin imágenes y no hay fotos guardadas en el iPad.");
        }
      }

      let doc;
      if (xmlCandidateText) {
        doc = this.parseXml(xmlCandidateText);
      } else {
        const sortedNames = Array.from(collectedImages.keys()).sort((a, b) => a.localeCompare(b));
        const entries = [];
        for (let i = 0; i < sortedNames.length; i++) {
          const imgName = sortedNames[i];
          const item = collectedImages.get(imgName);
          const dims = await measureBlobDimensions(item.blob);
          entries.push({
            id: i,
            name: imgName.replace(/^images\//i, ""),
            width: dims.width,
            height: dims.height,
          });
        }
        doc = buildDefaultXmlDoc(entries, inferredProjectName || "lote_ipad");
      }

      // Persist photos + project atomically in IndexedDB
      if (collectedImages.size > 0) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction([STORE_PHOTOS], "readwrite");
          const store = tx.objectStore(STORE_PHOTOS);
          store.clear();
          for (const [key, item] of collectedImages.entries()) {
            store.put({
              key,
              blob: item.blob,
              mimeType: item.blob.type || mimeForName(key),
            });
          }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      }

      this.revokeAllUrls();
      this.doc = doc;
      this.projectName = inferredProjectName || this.getTaskName() || "lote_ipad";
      this.xmlText = serializeXmlDoc(doc);
      this.updatedAt = new Date().toISOString();

      const photoKeysSet = collectedImages.size > 0 ? new Set(collectedImages.keys()) : existingKeys;
      this.rebuildPhotoKeyMap(photoKeysSet);

      await this.persistProjectMeta();
      return {
        projectName: this.projectName,
        totalImages: this.listImages().length,
        matchedPhotos: this.photoKeys.size,
      };
    }

    async persistProjectMeta() {
      const db = await this.ensureDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_META], "readwrite");
        tx.objectStore(STORE_META).put({
          key: ACTIVE_KEY,
          projectName: this.projectName,
          xmlText: this.xmlText,
          updatedAt: this.updatedAt,
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }

    getTaskName() {
      const t = this.doc?.querySelector("meta > task > name");
      return t ? t.textContent.trim() : "";
    }

    getLabels() {
      const out = [];
      const seen = new Set();
      if (this.doc) {
        const labelEls = this.doc.querySelectorAll("meta > task > labels > label");
        labelEls.forEach((lblEl) => {
          const name = lblEl.querySelector("name")?.textContent?.trim();
          if (!name || seen.has(name)) return;
          seen.add(name);
          const color = lblEl.querySelector("color")?.textContent?.trim() || deterministicColor(name);
          out.push({ name, color });
        });
        this.doc.querySelectorAll("image > mask").forEach((mEl) => {
          const name = (mEl.getAttribute("label") || "").trim();
          if (!name || seen.has(name)) return;
          seen.add(name);
          out.push({ name, color: deterministicColor(name) });
        });
      }
      if (out.length === 0) {
        for (const [name, color] of Object.entries(DEFAULT_LABEL_COLORS)) {
          out.push({ name, color });
        }
      }
      return out;
    }

    ensureLabelInMeta(labelName) {
      if (!this.doc) return;
      let meta = this.doc.querySelector("meta");
      if (!meta) {
        meta = this.doc.createElement("meta");
        this.doc.documentElement.insertBefore(meta, this.doc.documentElement.firstChild);
      }
      let task = meta.querySelector("task");
      if (!task) {
        task = this.doc.createElement("task");
        meta.appendChild(task);
      }
      let labelsEl = task.querySelector("labels");
      if (!labelsEl) {
        labelsEl = this.doc.createElement("labels");
        task.appendChild(labelsEl);
      }
      const exists = Array.from(labelsEl.querySelectorAll(":scope > label > name")).some(
        (n) => n.textContent.trim() === labelName
      );
      if (exists) return;

      const lblEl = this.doc.createElement("label");
      const nameEl = this.doc.createElement("name");
      nameEl.textContent = labelName;
      const colEl = this.doc.createElement("color");
      colEl.textContent = deterministicColor(labelName);
      const typeEl = this.doc.createElement("type");
      typeEl.textContent = "mask";
      const attrEl = this.doc.createElement("attributes");
      lblEl.append(nameEl, colEl, typeEl, attrEl);
      labelsEl.appendChild(lblEl);
    }

    listImages() {
      if (!this.doc) return [];
      const imgs = Array.from(this.doc.documentElement.querySelectorAll(":scope > image"));
      return imgs.map((el, idx) => {
        const id = el.getAttribute("id") || String(idx);
        const numMasks = el.querySelectorAll(":scope > mask").length;
        const numPolygons = el.querySelectorAll(":scope > polygon").length;
        const numPoints = el.querySelectorAll(":scope > points").length;
        return {
          id,
          name: el.getAttribute("name") || `image_${idx}`,
          width: Number(el.getAttribute("width") || 0),
          height: Number(el.getAttribute("height") || 0),
          has_image_file: this.photoKeys.has(id),
          num_masks: numMasks,
          num_polygons: numPolygons,
          num_points: numPoints,
          has_annotations: numMasks > 0 || numPolygons > 0,
        };
      });
    }

    findImageElement(imageId) {
      if (!this.doc) throw new Error("No hay ningún lote cargado.");
      const target = String(imageId);
      const imgs = Array.from(this.doc.documentElement.querySelectorAll(":scope > image"));
      for (let idx = 0; idx < imgs.length; idx++) {
        const el = imgs[idx];
        if (
          el.getAttribute("id") === target ||
          el.getAttribute("name") === target ||
          String(idx) === target
        ) {
          return el;
        }
      }
      throw new Error(`Imagen '${imageId}' no encontrada en XML`);
    }

    async getPhotoUrl(imageId) {
      const key = this.photoKeys.get(String(imageId));
      if (!key) {
        throw new Error("Esta imagen del XML no se encontró en los archivos cargados.");
      }
      if (this.photoUrls.has(key)) {
        return this.photoUrls.get(key);
      }
      const db = await this.ensureDb();
      const rec = await idbGet(db, STORE_PHOTOS, key);
      if (!rec || !rec.blob) {
        throw new Error(`Foto no encontrada en almacenamiento local: ${key}`);
      }
      const url = URL.createObjectURL(rec.blob);
      this.photoUrls.set(key, url);
      return url;
    }

    getImageObjects(imageId) {
      const el = this.findImageElement(imageId);
      const w = Number(el.getAttribute("width") || 0);
      const h = Number(el.getAttribute("height") || 0);
      const labelColors = new Map(this.getLabels().map((l) => [l.name, l.color]));

      const objects = [];
      const maskEls = Array.from(el.querySelectorAll(":scope > mask"));
      maskEls.forEach((mEl, idx) => {
        const lbl = (mEl.getAttribute("label") || "").trim();
        if (!lbl) return;
        const left = Number(mEl.getAttribute("left") || 0);
        const top = Number(mEl.getAttribute("top") || 0);
        const width = Number(mEl.getAttribute("width") || 0);
        const height = Number(mEl.getAttribute("height") || 0);
        const rle = mEl.getAttribute("rle") || "";
        if (!rle || width <= 0 || height <= 0) return;

        const obj = {
          uid: `mask_${idx}`,
          index: objects.length,
          label: lbl,
          color: labelColors.get(lbl) || deterministicColor(lbl),
          source: (mEl.getAttribute("source") || "manual").trim() || "manual",
          occluded: (mEl.getAttribute("occluded") || "0").trim() || "0",
          z_order: Number(mEl.getAttribute("z_order") ?? idx),
          mask_rle: { left, top, width, height, rle },
        };
        const grp = mEl.getAttribute("group_id");
        if (grp !== null) obj.group_id = grp;
        objects.push(obj);
      });

      const points = [];
      el.querySelectorAll(":scope > points").forEach((pEl) => {
        const lbl = (pEl.getAttribute("label") || "").trim();
        for (const pt of parsePointsAttr(pEl.getAttribute("points"))) {
          points.push({ label: lbl, x: pt.x, y: pt.y });
        }
      });

      return {
        image_id: el.getAttribute("id") || String(imageId),
        name: el.getAttribute("name") || "",
        width: w,
        height: h,
        objects,
        points,
      };
    }

    async updateImageObjects(imageId, objects) {
      const el = this.findImageElement(imageId);
      const w = Number(el.getAttribute("width") || 0);
      const h = Number(el.getAttribute("height") || 0);

      Array.from(el.querySelectorAll(":scope > mask")).forEach((node) => el.removeChild(node));

      let count = 0;
      objects.forEach((obj, idx) => {
        const lbl = String(obj.label || "").trim();
        const rle = obj.mask_rle;
        if (!lbl || !rle || !rle.rle || rle.width <= 0 || rle.height <= 0) return;
        this.ensureLabelInMeta(lbl);

        const mEl = this.doc.createElement("mask");
        mEl.setAttribute("label", lbl);
        mEl.setAttribute("source", String(obj.source || "manual"));
        mEl.setAttribute("occluded", String(obj.occluded || "0"));
        mEl.setAttribute("rle", String(rle.rle));
        mEl.setAttribute("left", String(rle.left));
        mEl.setAttribute("top", String(rle.top));
        mEl.setAttribute("width", String(rle.width));
        mEl.setAttribute("height", String(rle.height));
        mEl.setAttribute("z_order", String(obj.z_order ?? idx));
        if (obj.group_id !== undefined && obj.group_id !== null && obj.group_id !== "") {
          mEl.setAttribute("group_id", String(obj.group_id));
        }
        el.appendChild(mEl);
        count++;
      });

      const now = utcNowCvat();
      const upd = this.doc.querySelector("meta > task > updated");
      if (upd) upd.textContent = now;
      const dumped = this.doc.querySelector("meta > dumped");
      if (dumped) dumped.textContent = now;

      this.xmlText = serializeXmlDoc(this.doc);
      this.updatedAt = new Date().toISOString();
      await this.persistProjectMeta();

      return {
        ok: true,
        image_id: el.getAttribute("id") || String(imageId),
        width: w,
        height: h,
        num_objects: count,
        cvat_zip_name: `anotacion_${this.projectName}.zip`,
      };
    }

    getStatus() {
      const imgs = this.listImages();
      return {
        ok: true,
        mode: "offline",
        project_name: this.projectName,
        xml_name: "annotations.xml",
        cvat_zip_name: `anotacion_${this.projectName}.zip`,
        total_images: imgs.length,
        labels: this.getLabels(),
        sam: {
          sam2: { available: false },
          sam1: { available: false },
        },
      };
    }

    getXmlBlob() {
      if (!this.doc) throw new Error("No hay anotaciones cargadas.");
      const xml = serializeXmlDoc(this.doc);
      return new Blob([xml], { type: "application/xml; charset=utf-8" });
    }

    async buildCvatZipBlob() {
      if (!this.doc) throw new Error("No hay anotaciones cargadas.");
      if (!window.JSZip) throw new Error("JSZip no disponible.");
      const zip = new window.JSZip();
      zip.file("annotations.xml", serializeXmlDoc(this.doc));
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      return {
        blob,
        filename: `anotacion_${this.projectName}.zip`,
      };
    }

    async clearProject() {
      const db = await this.ensureDb();
      this.revokeAllUrls();
      this.doc = null;
      this.xmlText = "";
      this.photoKeys.clear();
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_META, STORE_PHOTOS], "readwrite");
        tx.objectStore(STORE_META).clear();
        tx.objectStore(STORE_PHOTOS).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  window.CvatOfflineStore = new OfflineWorkspaceManager();
})();
