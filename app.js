(() => {
  "use strict";

  const DOCK_STORAGE_KEY = "cvat_ipad_notes_dock_v2";
  const MAX_UNDO = 20;

  const state = {
    labels: [],
    images: [],
    currentImageId: null,
    imgW: 0,
    imgH: 0,
    photoImage: null,
    // Array of { uid, label, color, rgb, source, occluded, z_order, group_id, visible, locked, selectedForJoin, mask: Uint8Array, pixelCount }
    objects: [],
    activeObjectUid: null,
    editingLabelUid: null,
    nextUidSeq: 1,
    tool: "brush", // brush | eraser | lasso_fill | lasso_erase | sam_ai
    brushSize: 12,
    eraserSize: 16,
    maskOpacity: 0.55,
    palmRejection: true,
    pressureEnabled: false,
    disjointMode: true,
    peekOriginal: false,
    grayBgPreview: false,
    isFullscreen: false,
    dirty: false,
    points: [],
    scale: 1,
    tx: 0,
    ty: 0,
    activePointers: new Map(),
    drawingPointerId: null,
    lastPt: null,
    strokeBBox: null,
    strokeBeforeMap: null, // Map<uid, Uint8Array>
    lassoPoints: [],
    hoverPt: null,
    undoStack: [],
    redoStack: [],
    panStart: null,
    pinchStart: null,
    toastTimer: null,
    offlineMode: false,
    // SAM / SAM2
    samStatus: { sam2: { available: false }, sam1: { available: false } },
    samModel: "sam2",
    samPromptMode: "pos",
    samPosPoints: [],
    samNegPoints: [],
    samPromptHistory: [],
    samBox: null,
    samBoxDraft: null,
    samPreviewMask: null,
    samPreviewPixels: 0,
    samBusy: false,
    samRequestSeq: 0,
  };

  const viewport = document.getElementById("viewport");
  const canvasStage = document.getElementById("canvas-stage");
  const photoCanvas = document.getElementById("photo-canvas");
  const maskCanvas = document.getElementById("mask-canvas");
  const samCanvas = document.getElementById("sam-canvas");
  const uiCanvas = document.getElementById("ui-canvas");

  const photoCtx = photoCanvas.getContext("2d", { alpha: false });
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const samCtx = samCanvas.getContext("2d");
  const uiCtx = uiCanvas.getContext("2d");

  let maskImageData = null;

  const elAppShell = document.getElementById("app");
  const elSelectImage = document.getElementById("select-image");
  const elDimsBadge = document.getElementById("image-dims-badge");
  const elToolPill = document.getElementById("active-tool-pill");
  const elActiveObjPill = document.getElementById("active-object-pill");
  const elSaveStatus = document.getElementById("save-status");
  const elZoomHud = document.getElementById("zoom-hud");
  const elPencilToast = document.getElementById("pencil-toast");
  const elInspector = document.getElementById("inspector");
  const elServerInfo = document.getElementById("server-info");
  const elBtnFullscreen = document.getElementById("btn-fullscreen");

  const elObjectsCount = document.getElementById("objects-count");
  const elObjectsList = document.getElementById("objects-list");
  const elNewObjLabel = document.getElementById("new-object-label");
  const elBtnJoinSelectedPanel = document.getElementById("btn-join-selected-panel");

  const elNotesDock = document.getElementById("notes-dock");
  const elNotesDragHandle = document.getElementById("notes-drag-handle");
  const elBtnDockOrient = document.getElementById("btn-dock-orient");
  const elLblBrushSize = document.getElementById("lbl-brush-size");
  const elLblEraserSize = document.getElementById("lbl-eraser-size");
  const elLblJoinBtn = document.getElementById("lbl-join-btn");
  const elLblOpacityBtn = document.getElementById("lbl-opacity-btn");

  const elSizePopover = document.getElementById("tool-size-popover");
  const elSizeTitle = document.getElementById("tool-size-title");
  const elSizeTrack = document.getElementById("tool-size-track");
  const elSizeFill = document.getElementById("tool-size-fill");
  const elSizeThumb = document.getElementById("tool-size-thumb");
  const elSizeSlider = document.getElementById("tool-size-slider");

  const elOpacityPopover = document.getElementById("opacity-popover");
  const elMaskOpacity = document.getElementById("mask-opacity");
  const elMaskOpacityVal = document.getElementById("mask-opacity-val");
  const elChkPalm = document.getElementById("chk-palm-rejection");
  const elChkPressure = document.getElementById("chk-pressure");
  const elChkDisjoint = document.getElementById("chk-disjoint");

  const elSamPopover = document.getElementById("sam-popover");
  const elSamStatusBadge = document.getElementById("sam-status-badge");
  const elSamInfoLine = document.getElementById("sam-info-line");
  const elBtnSamAdd = document.getElementById("btn-sam-add");
  const elBtnSamNew = document.getElementById("btn-sam-new");
  const elBtnSamReplace = document.getElementById("btn-sam-replace");
  const elBtnSamUndoPt = document.getElementById("btn-sam-undo-pt");
  const elBtnSamClear = document.getElementById("btn-sam-clear");

  const elBtnLocalBatch = document.getElementById("btn-local-batch");
  const elBtnDownloadCvatZip = document.getElementById("btn-download-cvat-zip");
  const elBtnDownloadXml = document.getElementById("btn-download-xml");
  const elBtnDownloadIpadBundle = document.getElementById("btn-download-ipad-bundle");
  const elBtnUploadSyncZip = document.getElementById("btn-upload-sync-zip");
  const elPcSyncUploadInput = document.getElementById("pc-sync-upload-input");
  const elBtnExportBenchmark = document.getElementById("btn-export-benchmark");

  const elLocalModal = document.getElementById("local-batch-modal");
  const elBtnLocalModalClose = document.getElementById("btn-local-modal-close");
  const elLocalCurrentBox = document.getElementById("local-current-box");
  const elLocalCurrentName = document.getElementById("local-current-name");
  const elLocalCurrentMeta = document.getElementById("local-current-meta");
  const elBtnLocalContinue = document.getElementById("btn-local-continue");
  const elBtnLocalExportZip = document.getElementById("btn-local-export-zip");
  const elLocalFilesInput = document.getElementById("local-files-input");
  const elLocalImportStatus = document.getElementById("local-import-status");
  const elBtnLocalClear = document.getElementById("btn-local-clear");

  const elJoinPopover = document.getElementById("join-popover");
  const elJoinSummaryText = document.getElementById("join-summary-text");
  const elJoinTargetLabel = document.getElementById("join-target-label");
  const elBtnJoinSelected = document.getElementById("btn-join-selected");
  const elBtnJoinSam = document.getElementById("btn-join-sam");

  function hexToRgb(hex) {
    const clean = (hex || "#22c55e").replace("#", "");
    const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function labelColor(labelName) {
    const found = state.labels.find((l) => l.name === labelName);
    return found ? found.color : "#38bdf8";
  }

  function showToast(text) {
    elPencilToast.textContent = text;
    elPencilToast.classList.remove("hidden");
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      elPencilToast.classList.add("hidden");
    }, 1250);
  }

  function setDirty(flag) {
    state.dirty = flag;
    elSaveStatus.textContent = flag ? "Cambios sin guardar" : "Guardado";
    elSaveStatus.className = "save-status " + (flag ? "dirty" : "saved");
  }

  function currentToolSize() {
    return state.tool === "eraser" ? state.eraserSize : state.brushSize;
  }

  function getActiveObject() {
    if (!state.activeObjectUid) return null;
    return state.objects.find((o) => o.uid === state.activeObjectUid) || null;
  }

  function syncSizeTrackVisual(sz) {
    const clamped = Math.max(1, Math.min(200, sz));
    const ratio = Math.pow((clamped - 1) / 199, 1 / 1.5);
    const pct = `${(ratio * 100).toFixed(2)}%`;
    const isVert = elSizePopover.classList.contains("vertical-mode");
    if (isVert) {
      elSizeFill.style.width = "100%";
      elSizeFill.style.height = pct;
      elSizeThumb.style.left = "50%";
      elSizeThumb.style.bottom = pct;
      elSizeThumb.style.top = "auto";
    } else {
      elSizeFill.style.height = "100%";
      elSizeFill.style.width = pct;
      elSizeThumb.style.top = "50%";
      elSizeThumb.style.left = pct;
      elSizeThumb.style.bottom = "auto";
    }
    elSizeTrack.setAttribute("aria-valuenow", String(clamped));
  }

  function syncSizeBadges() {
    elLblBrushSize.textContent = `${state.brushSize}px`;
    elLblEraserSize.textContent = `${state.eraserSize}px`;
    if (state.tool === "brush") {
      elToolPill.textContent = `✏️ Lápiz · ${state.brushSize}px`;
    } else if (state.tool === "eraser") {
      elToolPill.textContent = `◫ Borrar · ${state.eraserSize}px`;
    }
    const isEraser = state.tool === "eraser";
    const sz = isEraser ? state.eraserSize : state.brushSize;
    elSizeTitle.textContent = `${sz} px`;
    elSizeSlider.value = String(sz);
    syncSizeTrackVisual(sz);
  }

  function hideDockPopovers(except = null) {
    if (except !== "size") elSizePopover.classList.add("hidden");
    if (except !== "opacity") elOpacityPopover.classList.add("hidden");
    if (except !== "join") elJoinPopover.classList.add("hidden");
    if (except !== "sam" && state.tool !== "sam_ai") elSamPopover.classList.add("hidden");
  }

  function positionSizePopover(toolName = state.tool) {
    if (elSizePopover.classList.contains("hidden")) return;
    const anchorBtn = document.getElementById(toolName === "eraser" ? "btn-tool-eraser" : "btn-tool-brush");
    if (!anchorBtn) return;

    const dockHorizontal = elNotesDock.classList.contains("horizontal");
    elSizePopover.classList.toggle("vertical-mode", dockHorizontal);

    const vpRect = viewport.getBoundingClientRect();
    const btnRect = anchorBtn.getBoundingClientRect();
    const popRect = elSizePopover.getBoundingClientRect();
    if (!vpRect.width || !vpRect.height || !popRect.width || !popRect.height) return;

    let left = 12;
    let top = 12;
    if (dockHorizontal) {
      // Dock is horizontal -> show vertical slider directly above the button (or below if near top)
      left = btnRect.left - vpRect.left + (btnRect.width - popRect.width) * 0.5;
      top = btnRect.top - vpRect.top - popRect.height - 10;
      if (top < 8) {
        top = btnRect.bottom - vpRect.top + 10;
      }
    } else {
      // Dock is vertical -> show horizontal slider next to (left of) the button (or right if near left edge)
      left = btnRect.left - vpRect.left - popRect.width - 10;
      top = btnRect.top - vpRect.top + (btnRect.height - popRect.height) * 0.5;
      if (left < 8) {
        left = btnRect.right - vpRect.left + 10;
      }
    }

    left = Math.max(8, Math.min(vpRect.width - popRect.width - 8, left));
    top = Math.max(8, Math.min(vpRect.height - popRect.height - 8, top));
    elSizePopover.style.left = `${left}px`;
    elSizePopover.style.top = `${top}px`;
    elSizePopover.style.right = "auto";
    elSizePopover.style.bottom = "auto";

    syncSizeTrackVisual(toolName === "eraser" ? state.eraserSize : state.brushSize);
  }

  function openSizePopoverFor(toolName) {
    const isEraser = toolName === "eraser";
    const sz = isEraser ? state.eraserSize : state.brushSize;
    elSizeTitle.textContent = `${sz} px`;
    elSizeSlider.value = String(sz);
    hideDockPopovers("size");
    elSizePopover.classList.remove("hidden");
    positionSizePopover(toolName);
  }

  function setTool(toolName, announce = false, toggleSizePopover = false) {
    const wasSame = state.tool === toolName;
    state.tool = toolName;
    document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === toolName);
    });

    const labels = {
      brush: [`✏️ Lápiz · ${state.brushSize}px`, "tool-brush"],
      eraser: [`◫ Borrar · ${state.eraserSize}px`, "tool-eraser"],
      lasso_fill: ["〰️ Lazo +", "tool-brush"],
      lasso_erase: ["✂️ Lazo -", "tool-eraser"],
      sam_ai: [`✨ IA ${state.samModel.toUpperCase()}`, "tool-ai"],
    };
    const [txt, cls] = labels[toolName] || [`✏️ Lápiz · ${state.brushSize}px`, "tool-brush"];
    elToolPill.textContent = txt;
    elToolPill.className = "tool-pill " + cls;

    if (toolName === "sam_ai") {
      hideDockPopovers("sam");
      elSamPopover.classList.remove("hidden");
      updateSamUi();
    } else {
      elSamPopover.classList.add("hidden");
      if ((toolName === "brush" || toolName === "eraser") && toggleSizePopover) {
        if (wasSame && !elSizePopover.classList.contains("hidden")) {
          elSizePopover.classList.add("hidden");
        } else {
          openSizePopoverFor(toolName);
        }
      } else {
        elSizePopover.classList.add("hidden");
      }
    }

    if (announce) showToast(txt);
    drawUiOverlay();
  }

  function updateStageTransform() {
    canvasStage.style.transform = `translate3d(${state.tx}px, ${state.ty}px, 0) scale(${state.scale})`;
    elZoomHud.textContent = `${Math.round(state.scale * 100)}%`;
  }

  function fitImageToViewport() {
    if (!state.imgW || !state.imgH) return;
    const rect = viewport.getBoundingClientRect();
    const pad = 16;
    const sx = (rect.width - pad * 2) / state.imgW;
    const sy = (rect.height - pad * 2) / state.imgH;
    state.scale = Math.max(0.05, Math.min(sx, sy));
    state.tx = (rect.width - state.imgW * state.scale) * 0.5;
    state.ty = (rect.height - state.imgH * state.scale) * 0.5;
    updateStageTransform();
  }

  function screenToImage(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.tx) / state.scale,
      y: (clientY - rect.top - state.ty) / state.scale,
    };
  }

  function decodeRleToArray(rleObj, targetUint8) {
    if (!rleObj || !rleObj.rle) return 0;
    const left = rleObj.left | 0;
    const top = rleObj.top | 0;
    const w = rleObj.width | 0;
    const runs = rleObj.rle.trim().split(/[\s,]+/).map(Number);

    let localIdx = 0;
    let val = 0;
    let count = 0;
    const imgW = state.imgW;

    for (let i = 0; i < runs.length; i++) {
      const len = runs[i];
      if (val === 1 && len > 0) {
        const end = localIdx + len;
        for (let p = localIdx; p < end; p++) {
          const py = top + ((p / w) | 0);
          const px = left + (p % w);
          if (px >= 0 && px < state.imgW && py >= 0 && py < state.imgH) {
            targetUint8[py * imgW + px] = 1;
            count++;
          }
        }
      }
      localIdx += len;
      val ^= 1;
    }
    return count;
  }

  function encodeUint8MaskToRle(maskArr) {
    const imgW = state.imgW;
    const imgH = state.imgH;
    let minX = imgW, minY = imgH, maxX = -1, maxY = -1;

    for (let y = 0; y < imgH; y++) {
      const rowOff = y * imgW;
      for (let x = 0; x < imgW; x++) {
        if (maskArr[rowOff + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null;

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const runs = [];
    let expected = 0;
    let runLen = 0;

    for (let y = minY; y <= maxY; y++) {
      const rowOff = y * imgW;
      for (let x = minX; x <= maxX; x++) {
        const v = maskArr[rowOff + x] ? 1 : 0;
        if (v === expected) {
          runLen++;
        } else {
          runs.push(runLen);
          expected = v;
          runLen = 1;
        }
      }
    }
    runs.push(runLen);

    return {
      left: minX,
      top: minY,
      width,
      height,
      rle: runs.join(", "),
    };
  }

  function countMaskPixels(maskArr) {
    let c = 0;
    for (let i = 0; i < maskArr.length; i++) {
      if (maskArr[i]) c++;
    }
    return c;
  }

  function renderPhotoCanvas() {
    if (!state.photoImage) return;
    photoCtx.clearRect(0, 0, state.imgW, state.imgH);
    photoCtx.drawImage(state.photoImage, 0, 0, state.imgW, state.imgH);

    if (state.grayBgPreview) {
      const activeObj = getActiveObject();
      if (activeObj) {
        const imgData = photoCtx.getImageData(0, 0, state.imgW, state.imgH);
        const data = imgData.data;
        const m = activeObj.mask;
        for (let i = 0; i < m.length; i++) {
          if (!m[i]) {
            const p = i * 4;
            data[p] = 127;
            data[p + 1] = 127;
            data[p + 2] = 127;
          }
        }
        photoCtx.putImageData(imgData, 0, 0);
      }
    }
  }

  function renderMaskRegion(x0, y0, x1, y1) {
    if (!maskImageData || !state.imgW || !state.imgH) return;
    const rx0 = Math.max(0, Math.floor(x0));
    const ry0 = Math.max(0, Math.floor(y0));
    const rx1 = Math.min(state.imgW - 1, Math.ceil(x1));
    const ry1 = Math.min(state.imgH - 1, Math.ceil(y1));
    if (rx1 < rx0 || ry1 < ry0) return;

    const data = maskImageData.data;
    const imgW = state.imgW;
    const activeUid = state.activeObjectUid;
    const activeAlpha = Math.round(state.maskOpacity * 255);
    const inactiveAlpha = Math.round(state.maskOpacity * 0.55 * 255);

    const visibleObjs = state.objects.filter((o) => o.visible);
    // Order so active object renders on top visually
    visibleObjs.sort((a, b) => (a.uid === activeUid ? 1 : 0) - (b.uid === activeUid ? 1 : 0));

    for (let y = ry0; y <= ry1; y++) {
      const rowOff = y * imgW;
      for (let x = rx0; x <= rx1; x++) {
        const idx = rowOff + x;
        const p = idx * 4;
        let drawn = false;
        for (let k = visibleObjs.length - 1; k >= 0; k--) {
          const obj = visibleObjs[k];
          if (obj.mask[idx]) {
            data[p] = obj.rgb[0];
            data[p + 1] = obj.rgb[1];
            data[p + 2] = obj.rgb[2];
            data[p + 3] = obj.uid === activeUid ? activeAlpha : inactiveAlpha;
            drawn = true;
            break;
          }
        }
        if (!drawn) {
          data[p + 3] = 0;
        }
      }
    }

    maskCtx.putImageData(maskImageData, 0, 0, rx0, ry0, rx1 - rx0 + 1, ry1 - ry0 + 1);
  }

  function renderFullMaskOverlay() {
    if (!state.imgW || !state.imgH) return;
    maskCanvas.style.opacity = state.peekOriginal ? "0" : "1";
    samCanvas.style.opacity = state.peekOriginal ? "0" : "1";
    renderMaskRegion(0, 0, state.imgW - 1, state.imgH - 1);
  }

  function renderSamPreviewOverlay() {
    if (!state.imgW || !state.imgH) return;
    samCtx.clearRect(0, 0, state.imgW, state.imgH);
    samCanvas.style.opacity = state.peekOriginal ? "0" : "1";
    if (!state.samPreviewMask) return;

    const w = state.imgW;
    const h = state.imgH;
    const m = state.samPreviewMask;
    const imgData = samCtx.createImageData(w, h);
    const d = imgData.data;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        if (!m[i]) continue;
        const isEdge =
          x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
          !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w];
        const p = i * 4;
        if (isEdge) {
          d[p] = 240;
          d[p + 1] = 249;
          d[p + 2] = 255;
          d[p + 3] = 235;
        } else {
          d[p] = 56;
          d[p + 1] = 189;
          d[p + 2] = 248;
          d[p + 3] = 128;
        }
      }
    }
    samCtx.putImageData(imgData, 0, 0);
  }

  function drawUiOverlay() {
    if (!state.imgW || !state.imgH) return;
    uiCtx.clearRect(0, 0, state.imgW, state.imgH);

    if (state.points && state.points.length > 0) {
      uiCtx.save();
      uiCtx.lineWidth = Math.max(1.5, 2 / state.scale);
      const arm = Math.max(6, 10 / state.scale);
      for (const pt of state.points) {
        uiCtx.strokeStyle = "#facc15";
        uiCtx.beginPath();
        uiCtx.moveTo(pt.x - arm, pt.y);
        uiCtx.lineTo(pt.x + arm, pt.y);
        uiCtx.moveTo(pt.x, pt.y - arm);
        uiCtx.lineTo(pt.x, pt.y + arm);
        uiCtx.stroke();
      }
      uiCtx.restore();
    }

    const activeBox = state.samBoxDraft
      ? [
          [Math.min(state.samBoxDraft.start.x, state.samBoxDraft.end.x), Math.min(state.samBoxDraft.start.y, state.samBoxDraft.end.y)],
          [Math.max(state.samBoxDraft.start.x, state.samBoxDraft.end.x), Math.max(state.samBoxDraft.start.y, state.samBoxDraft.end.y)],
        ]
      : state.samBox;
    if (activeBox) {
      uiCtx.save();
      uiCtx.lineWidth = Math.max(1.5, 2.2 / state.scale);
      uiCtx.setLineDash([Math.max(4, 8 / state.scale), Math.max(3, 5 / state.scale)]);
      uiCtx.strokeStyle = "#c084fc";
      uiCtx.fillStyle = "rgba(192, 132, 252, 0.08)";
      const bx = activeBox[0][0];
      const by = activeBox[0][1];
      uiCtx.fillRect(bx, by, activeBox[1][0] - bx, activeBox[1][1] - by);
      uiCtx.strokeRect(bx, by, activeBox[1][0] - bx, activeBox[1][1] - by);
      uiCtx.restore();
    }

    if (state.samPosPoints.length > 0 || state.samNegPoints.length > 0) {
      uiCtx.save();
      const rad = Math.max(4, 7 / state.scale);
      const lw = Math.max(1.5, 2 / state.scale);
      const drawDot = (pt, fillColor, sign) => {
        uiCtx.beginPath();
        uiCtx.arc(pt[0], pt[1], rad, 0, Math.PI * 2);
        uiCtx.fillStyle = fillColor;
        uiCtx.fill();
        uiCtx.lineWidth = lw;
        uiCtx.strokeStyle = "#ffffff";
        uiCtx.stroke();
        uiCtx.beginPath();
        uiCtx.moveTo(pt[0] - rad * 0.45, pt[1]);
        uiCtx.lineTo(pt[0] + rad * 0.45, pt[1]);
        if (sign === "+") {
          uiCtx.moveTo(pt[0], pt[1] - rad * 0.45);
          uiCtx.lineTo(pt[0], pt[1] + rad * 0.45);
        }
        uiCtx.stroke();
      };
      for (const p of state.samPosPoints) drawDot(p, "#16a34a", "+");
      for (const p of state.samNegPoints) drawDot(p, "#dc2626", "-");
      uiCtx.restore();
    }

    if (state.lassoPoints.length > 1) {
      uiCtx.save();
      uiCtx.lineWidth = Math.max(1.5, 2 / state.scale);
      uiCtx.strokeStyle = state.tool === "lasso_erase" ? "#ef4444" : "#38bdf8";
      uiCtx.fillStyle = state.tool === "lasso_erase" ? "rgba(239,68,68,0.18)" : "rgba(56,189,248,0.18)";
      uiCtx.beginPath();
      uiCtx.moveTo(state.lassoPoints[0].x, state.lassoPoints[0].y);
      for (let i = 1; i < state.lassoPoints.length; i++) {
        uiCtx.lineTo(state.lassoPoints[i].x, state.lassoPoints[i].y);
      }
      uiCtx.closePath();
      uiCtx.fill();
      uiCtx.stroke();
      uiCtx.restore();
    }

    if (state.hoverPt && (state.tool === "brush" || state.tool === "eraser")) {
      uiCtx.save();
      const radius = currentToolSize() * 0.5;
      uiCtx.lineWidth = Math.max(1, 1.5 / state.scale);
      uiCtx.strokeStyle = state.tool === "eraser" ? "#f87171" : "#ffffff";
      uiCtx.beginPath();
      uiCtx.arc(state.hoverPt.x, state.hoverPt.y, Math.max(0.5, radius), 0, Math.PI * 2);
      uiCtx.stroke();
      uiCtx.restore();
    }
  }

  function refreshJoinUi() {
    const selected = state.objects.filter((o) => o.selectedForJoin);
    const nSel = selected.length;
    elLblJoinBtn.textContent = nSel > 0 ? `Join (${nSel})` : "Join";
    elBtnJoinSelectedPanel.textContent = `🔗 Unir marcados (${nSel})`;
    elBtnJoinSelectedPanel.disabled = nSel < 2;
    elBtnJoinSelected.textContent = `🔗 Unir seleccionados (${nSel})`;
    elBtnJoinSelected.disabled = nSel < 2;

    const hasSam = Boolean(state.samPreviewMask && state.samPreviewPixels > 0);
    elBtnJoinSam.classList.toggle("hidden", !hasSam);

    if (nSel >= 2) {
      elJoinSummaryText.textContent = `${nSel} objetos marcados listos para unir en una sola máscara.`;
      const firstLbl = selected[0].label;
      if (Array.from(elJoinTargetLabel.options).some((o) => o.value === firstLbl)) {
        elJoinTargetLabel.value = firstLbl;
      }
    } else {
      elJoinSummaryText.textContent = "Marca 2 o más objetos (☑) en el panel derecho para unirlos en una sola máscara.";
    }
  }

  function changeObjectLabel(uid, newLabel) {
    const obj = state.objects.find((o) => o.uid === uid);
    if (!obj || !newLabel) return;
    if (obj.locked) {
      showToast("🔒 Objeto bloqueado");
      renderObjectsPanel();
      return;
    }
    if (obj.label === newLabel) {
      state.editingLabelUid = null;
      renderObjectsPanel();
      return;
    }
    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    const col = labelColor(newLabel);
    obj.label = newLabel;
    obj.color = col;
    obj.rgb = hexToRgb(col);
    state.activeObjectUid = obj.uid;
    state.editingLabelUid = null;
    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
    showToast(`🏷️ Etiqueta → ${newLabel}`);
  }

  function renderObjectsPanel() {
    elObjectsCount.textContent = String(state.objects.length);
    elObjectsList.innerHTML = "";

    const activeObj = getActiveObject();
    if (activeObj) {
      const idx = state.objects.indexOf(activeObj);
      elActiveObjPill.textContent = `#${idx + 1} · ${activeObj.label}`;
      elActiveObjPill.style.borderColor = activeObj.color;
    } else {
      elActiveObjPill.textContent = "Sin objeto";
      elActiveObjPill.style.borderColor = "#334155";
    }

    if (state.objects.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted-note";
      empty.textContent = "Sin objetos de máscara todavía. Pulsa «+ Nuevo» o pinta con el Apple Pencil.";
      elObjectsList.appendChild(empty);
    }

    state.objects.forEach((obj, idx) => {
      const isActive = obj.uid === state.activeObjectUid;
      const block = document.createElement("div");
      block.className = "obj-block";

      const item = document.createElement("div");
      item.className = "layer-item" + (isActive ? " active" : "");
      item.dataset.uid = obj.uid;
      item.onclick = () => {
        if (!isActive) {
          state.activeObjectUid = obj.uid;
          state.editingLabelUid = null;
          if (!obj.visible) obj.visible = true;
        } else {
          state.editingLabelUid = state.editingLabelUid === obj.uid ? null : obj.uid;
        }
        renderObjectsPanel();
        renderFullMaskOverlay();
        if (state.grayBgPreview) renderPhotoCanvas();
      };

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "join-check";
      chk.checked = Boolean(obj.selectedForJoin);
      chk.title = "Marcar para Join Masks";
      chk.onclick = (e) => e.stopPropagation();
      chk.onchange = () => {
        obj.selectedForJoin = chk.checked;
        refreshJoinUi();
      };

      const swatch = document.createElement("span");
      swatch.className = "layer-swatch";
      swatch.style.background = obj.color;

      const meta = document.createElement("div");
      meta.className = "layer-meta";

      const titleRow = document.createElement("div");
      titleRow.className = "obj-title-row";
      const idxBadge = document.createElement("span");
      idxBadge.className = "obj-index";
      idxBadge.textContent = `#${idx + 1}`;

      const lblSelect = document.createElement("select");
      lblSelect.className = "obj-label-select";
      lblSelect.style.borderColor = obj.color;
      lblSelect.title = "Cambiar etiqueta de la instancia";
      const labelNames = state.labels.map((l) => l.name);
      if (!labelNames.includes(obj.label)) labelNames.push(obj.label);
      for (const lName of labelNames) {
        const opt = document.createElement("option");
        opt.value = lName;
        opt.textContent = lName;
        lblSelect.appendChild(opt);
      }
      lblSelect.value = obj.label;
      lblSelect.onclick = (e) => {
        e.stopPropagation();
        if (state.activeObjectUid !== obj.uid) {
          state.activeObjectUid = obj.uid;
          if (!obj.visible) obj.visible = true;
          elObjectsList.querySelectorAll(".layer-item").forEach((row) => {
            row.classList.toggle("active", row.dataset.uid === obj.uid);
          });
          elActiveObjPill.textContent = `#${idx + 1} · ${obj.label}`;
          elActiveObjPill.style.borderColor = obj.color;
          renderFullMaskOverlay();
          if (state.grayBgPreview) renderPhotoCanvas();
        }
      };
      lblSelect.onchange = () => changeObjectLabel(obj.uid, lblSelect.value);

      titleRow.append(idxBadge, lblSelect);

      const countEl = document.createElement("span");
      countEl.className = "layer-count";
      countEl.textContent = `${obj.pixelCount.toLocaleString("es-ES")} px · ${obj.source}`;
      meta.append(titleRow, countEl);

      const eyeBtn = document.createElement("button");
      eyeBtn.className = "layer-icon-btn" + (obj.visible ? "" : " hidden-eye");
      eyeBtn.textContent = obj.visible ? "👁️" : "🚫";
      eyeBtn.title = "Mostrar / ocultar máscara";
      eyeBtn.onclick = (e) => {
        e.stopPropagation();
        obj.visible = !obj.visible;
        renderObjectsPanel();
        renderFullMaskOverlay();
      };

      const lockBtn = document.createElement("button");
      lockBtn.className = "layer-icon-btn" + (obj.locked ? " locked" : "");
      lockBtn.textContent = obj.locked ? "🔒" : "🔓";
      lockBtn.title = "Bloquear objeto";
      lockBtn.onclick = (e) => {
        e.stopPropagation();
        obj.locked = !obj.locked;
        renderObjectsPanel();
      };

      const delBtn = document.createElement("button");
      delBtn.className = "layer-icon-btn";
      delBtn.textContent = "🗑️";
      delBtn.title = "Eliminar objeto";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteObjectByUid(obj.uid);
      };

      item.append(chk, swatch, meta, eyeBtn, lockBtn, delBtn);
      block.appendChild(item);

      if (isActive && state.editingLabelUid === obj.uid) {
        const chipsBox = document.createElement("div");
        chipsBox.className = "obj-label-chips";
        for (const lName of labelNames) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "obj-label-chip" + (lName === obj.label ? " active" : "");
          const dot = document.createElement("span");
          dot.className = "obj-label-chip-dot";
          dot.style.background = labelColor(lName);
          const txt = document.createElement("span");
          txt.textContent = lName;
          chip.append(dot, txt);
          chip.onclick = (e) => {
            e.stopPropagation();
            changeObjectLabel(obj.uid, lName);
          };
          chipsBox.appendChild(chip);
        }
        block.appendChild(chipsBox);
      }

      elObjectsList.appendChild(block);
    });

    refreshJoinUi();
  }

  function createObject(labelName, maskArr = null, source = "manual", activate = true) {
    const lbl = labelName || elNewObjLabel.value || state.labels[0]?.name || "plant_target";
    const col = labelColor(lbl);
    const arr = maskArr || new Uint8Array(state.imgW * state.imgH);
    const obj = {
      uid: `obj_${state.nextUidSeq++}`,
      label: lbl,
      color: col,
      rgb: hexToRgb(col),
      source,
      occluded: "0",
      z_order: state.objects.length,
      group_id: "",
      visible: true,
      locked: false,
      selectedForJoin: false,
      mask: arr,
      pixelCount: countMaskPixels(arr),
    };
    state.objects.push(obj);
    if (activate) state.activeObjectUid = obj.uid;
    return obj;
  }

  function cloneObjectsList(objs) {
    return objs.map((o) => ({
      ...o,
      rgb: [...o.rgb],
      mask: new Uint8Array(o.mask),
    }));
  }

  function pushFullObjectsUndo(beforeObjs, beforeActiveUid) {
    const afterObjs = cloneObjectsList(state.objects);
    state.undoStack.push({
      kind: "objects",
      beforeObjs,
      afterObjs,
      beforeActiveUid,
      afterActiveUid: state.activeObjectUid,
    });
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack = [];
    setDirty(true);
    renderObjectsPanel();
    renderFullMaskOverlay();
    if (state.grayBgPreview) renderPhotoCanvas();
  }

  function ensureActiveObjectForDrawing() {
    let activeObj = getActiveObject();
    if (activeObj) return activeObj;
    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    activeObj = createObject(elNewObjLabel.value || state.labels[0]?.name, null, "manual", true);
    state.undoStack.push({
      kind: "objects",
      beforeObjs,
      afterObjs: cloneObjectsList(state.objects),
      beforeActiveUid,
      afterActiveUid: state.activeObjectUid,
    });
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack = [];
    renderObjectsPanel();
    showToast(`Objeto creado: ${activeObj.label}`);
    return activeObj;
  }

  function deleteObjectByUid(uid) {
    const target = state.objects.find((o) => o.uid === uid);
    if (!target) return;
    if (target.locked) {
      showToast("🔒 Objeto bloqueado");
      return;
    }
    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    state.objects = state.objects.filter((o) => o.uid !== uid);
    if (state.activeObjectUid === uid) {
      state.activeObjectUid = state.objects[0]?.uid || null;
    }
    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
    showToast("🗑️ Objeto eliminado");
  }

  function clearActiveObjectMask() {
    const activeObj = getActiveObject();
    if (!activeObj) return;
    if (activeObj.locked) {
      showToast("🔒 Objeto bloqueado");
      return;
    }
    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    activeObj.mask.fill(0);
    activeObj.pixelCount = 0;
    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
    showToast("Máscara vaciada");
  }

  // ---- Fast slice Undo / Redo for Brush & Eraser strokes ----
  function expandStrokeHistory(rx0, ry0, rx1, ry1) {
    const bx0 = Math.max(0, Math.floor(rx0));
    const by0 = Math.max(0, Math.floor(ry0));
    const bx1 = Math.min(state.imgW - 1, Math.ceil(rx1));
    const by1 = Math.min(state.imgH - 1, Math.ceil(ry1));
    if (bx1 < bx0 || by1 < by0) return;

    const touchedObjs = state.objects.filter((o) => o.uid === state.activeObjectUid || (state.disjointMode && !o.locked));
    if (!state.strokeBBox) {
      state.strokeBBox = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
      state.strokeBeforeMap = new Map();
      const w = bx1 - bx0 + 1;
      const h = by1 - by0 + 1;
      for (const obj of touchedObjs) {
        const snap = new Uint8Array(w * h);
        for (let row = 0; row < h; row++) {
          const srcOff = (by0 + row) * state.imgW + bx0;
          snap.set(obj.mask.subarray(srcOff, srcOff + w), row * w);
        }
        state.strokeBeforeMap.set(obj.uid, snap);
      }
      return;
    }

    const old = state.strokeBBox;
    const nx0 = Math.min(old.x0, bx0);
    const ny0 = Math.min(old.y0, by0);
    const nx1 = Math.max(old.x1, bx1);
    const ny1 = Math.max(old.y1, by1);
    if (nx0 === old.x0 && ny0 === old.y0 && nx1 === old.x1 && ny1 === old.y1) return;

    const nw = nx1 - nx0 + 1;
    const nh = ny1 - ny0 + 1;
    const ow = old.x1 - old.x0 + 1;
    const oh = old.y1 - old.y0 + 1;

    for (const obj of touchedObjs) {
      const oldSnap = state.strokeBeforeMap.get(obj.uid);
      const newSnap = new Uint8Array(nw * nh);
      for (let row = 0; row < nh; row++) {
        const srcOff = (ny0 + row) * state.imgW + nx0;
        newSnap.set(obj.mask.subarray(srcOff, srcOff + nw), row * nw);
      }
      if (oldSnap) {
        for (let row = 0; row < oh; row++) {
          const dstOff = (old.y0 - ny0 + row) * nw + (old.x0 - nx0);
          newSnap.set(oldSnap.subarray(row * ow, (row + 1) * ow), dstOff);
        }
      }
      state.strokeBeforeMap.set(obj.uid, newSnap);
    }
    state.strokeBBox = { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
  }

  function finalizeStrokeHistory() {
    if (!state.strokeBBox || !state.strokeBeforeMap) return;
    const b = state.strokeBBox;
    const w = b.x1 - b.x0 + 1;
    const h = b.y1 - b.y0 + 1;
    const slices = [];
    for (const [uid, beforeData] of state.strokeBeforeMap.entries()) {
      const obj = state.objects.find((o) => o.uid === uid);
      if (!obj) continue;
      const afterData = new Uint8Array(w * h);
      let changed = false;
      for (let row = 0; row < h; row++) {
        const srcOff = (b.y0 + row) * state.imgW + b.x0;
        const sl = obj.mask.subarray(srcOff, srcOff + w);
        afterData.set(sl, row * w);
      }
      for (let i = 0; i < beforeData.length; i++) {
        if (beforeData[i] !== afterData[i]) {
          changed = true;
          break;
        }
      }
      if (changed) {
        slices.push({ uid, before: beforeData, after: afterData });
        obj.pixelCount = countMaskPixels(obj.mask);
      }
    }
    if (slices.length > 0) {
      state.undoStack.push({ kind: "slice", x0: b.x0, y0: b.y0, w, h, slices });
      if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
      state.redoStack = [];
      setDirty(true);
      renderObjectsPanel();
    }
    state.strokeBBox = null;
    state.strokeBeforeMap = null;
  }

  function applyUndoRecord(rec, useAfter) {
    if (rec.kind === "objects") {
      state.objects = cloneObjectsList(useAfter ? rec.afterObjs : rec.beforeObjs);
      state.activeObjectUid = useAfter ? rec.afterActiveUid : rec.beforeActiveUid;
      renderObjectsPanel();
      renderFullMaskOverlay();
      if (state.grayBgPreview) renderPhotoCanvas();
      setDirty(true);
      return;
    }
    if (rec.kind === "slice") {
      for (const s of rec.slices) {
        const obj = state.objects.find((o) => o.uid === s.uid);
        if (!obj) continue;
        const buf = useAfter ? s.after : s.before;
        for (let row = 0; row < rec.h; row++) {
          const dstOff = (rec.y0 + row) * state.imgW + rec.x0;
          obj.mask.set(buf.subarray(row * rec.w, (row + 1) * rec.w), dstOff);
        }
        obj.pixelCount = countMaskPixels(obj.mask);
      }
      renderMaskRegion(rec.x0, rec.y0, rec.x0 + rec.w - 1, rec.y0 + rec.h - 1);
      if (state.grayBgPreview) renderPhotoCanvas();
      setDirty(true);
      renderObjectsPanel();
    }
  }

  function undo() {
    const rec = state.undoStack.pop();
    if (!rec) return;
    applyUndoRecord(rec, false);
    state.redoStack.push(rec);
    showToast("↩️ Deshecho");
  }

  function redo() {
    const rec = state.redoStack.pop();
    if (!rec) return;
    applyUndoRecord(rec, true);
    state.undoStack.push(rec);
    showToast("↪️ Rehecho");
  }

  function paintBrushCapsule(p0, p1, diameterPx, isErase) {
    const activeObj = ensureActiveObjectForDrawing();
    if (activeObj.locked) {
      showToast("🔒 Objeto bloqueado");
      return;
    }
    const r = Math.max(0.5, diameterPx * 0.5);
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(Math.min(p0.x, p1.x) - r - 1));
    const y0 = Math.max(0, Math.floor(Math.min(p0.y, p1.y) - r - 1));
    const x1 = Math.min(state.imgW - 1, Math.ceil(Math.max(p0.x, p1.x) + r + 1));
    const y1 = Math.min(state.imgH - 1, Math.ceil(Math.max(p0.y, p1.y) + r + 1));
    if (x1 < x0 || y1 < y0) return;

    expandStrokeHistory(x0, y0, x1, y1);

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len2 = dx * dx + dy * dy;
    const imgW = state.imgW;
    const activeMask = activeObj.mask;
    const lockedOthers = state.objects.filter((o) => o.uid !== activeObj.uid && o.locked);
    const unlockedOthers = state.disjointMode
      ? state.objects.filter((o) => o.uid !== activeObj.uid && !o.locked)
      : [];

    for (let y = y0; y <= y1; y++) {
      const rowOff = y * imgW;
      for (let x = x0; x <= x1; x++) {
        let t = 0;
        if (len2 > 1e-6) {
          t = ((x - p0.x) * dx + (y - p0.y) * dy) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
        }
        const cx = p0.x + t * dx;
        const cy = p0.y + t * dy;
        const dist2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (dist2 <= r2) {
          const idx = rowOff + x;
          if (isErase) {
            activeMask[idx] = 0;
          } else {
            if (state.disjointMode) {
              let blocked = false;
              for (let k = 0; k < lockedOthers.length; k++) {
                if (lockedOthers[k].mask[idx]) {
                  blocked = true;
                  break;
                }
              }
              if (blocked) continue;
              for (let k = 0; k < unlockedOthers.length; k++) {
                unlockedOthers[k].mask[idx] = 0;
              }
            }
            activeMask[idx] = 1;
          }
        }
      }
    }

    renderMaskRegion(x0, y0, x1, y1);
    if (state.grayBgPreview) renderPhotoCanvas();
  }

  function applyLassoPolygon(pts, isErase) {
    if (pts.length < 3) return;
    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    let activeObj = getActiveObject();
    if (!activeObj) {
      if (isErase) return;
      activeObj = createObject(elNewObjLabel.value || state.labels[0]?.name, null, "manual", true);
    }
    if (activeObj.locked) {
      showToast("🔒 Objeto bloqueado");
      return;
    }

    let minX = state.imgW, minY = state.imgH, maxX = -1, maxY = -1;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rx0 = Math.max(0, Math.floor(minX));
    const ry0 = Math.max(0, Math.floor(minY));
    const rx1 = Math.min(state.imgW - 1, Math.ceil(maxX));
    const ry1 = Math.min(state.imgH - 1, Math.ceil(maxY));
    if (rx1 < rx0 || ry1 < ry0) return;

    const imgW = state.imgW;
    const activeMask = activeObj.mask;
    const lockedOthers = state.objects.filter((o) => o.uid !== activeObj.uid && o.locked);
    const unlockedOthers = state.disjointMode
      ? state.objects.filter((o) => o.uid !== activeObj.uid && !o.locked)
      : [];
    const n = pts.length;

    for (let y = ry0; y <= ry1; y++) {
      const sy = y + 0.5;
      const xs = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = pts[i].y, yj = pts[j].y;
        const xi = pts[i].x, xj = pts[j].x;
        if ((yi > sy) !== (yj > sy)) {
          xs.push(xi + ((sy - yi) * (xj - xi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      const rowOff = y * imgW;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xStart = Math.max(rx0, Math.ceil(xs[k] - 0.5));
        const xEnd = Math.min(rx1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xStart; x <= xEnd; x++) {
          const idx = rowOff + x;
          if (isErase) {
            activeMask[idx] = 0;
          } else {
            if (state.disjointMode) {
              let blocked = false;
              for (let m = 0; m < lockedOthers.length; m++) {
                if (lockedOthers[m].mask[idx]) {
                  blocked = true;
                  break;
                }
              }
              if (blocked) continue;
              for (let m = 0; m < unlockedOthers.length; m++) {
                unlockedOthers[m].mask[idx] = 0;
              }
            }
            activeMask[idx] = 1;
          }
        }
      }
    }

    for (const o of state.objects) o.pixelCount = countMaskPixels(o.mask);
    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
  }

  // ---- Interactive SAM2 / SAM1 helpers ----
  function updateSamUi() {
    const mInfo = state.samStatus[state.samModel] || {};
    if (state.offlineMode) {
      elSamStatusBadge.textContent = "Solo con PC (offline)";
      elSamStatusBadge.className = "sam-badge err";
    } else if (state.samBusy) {
      elSamStatusBadge.textContent = `Calculando ${state.samModel.toUpperCase()}...`;
      elSamStatusBadge.className = "sam-badge warn";
    } else if (mInfo.available) {
      elSamStatusBadge.textContent = `${state.samModel.toUpperCase()} listo`;
      elSamStatusBadge.className = "sam-badge";
    } else {
      elSamStatusBadge.textContent = `${state.samModel.toUpperCase()} no activo`;
      elSamStatusBadge.className = "sam-badge err";
    }

    document.querySelectorAll("[data-sam-model]").forEach((b) => {
      b.classList.toggle("active", b.dataset.samModel === state.samModel);
    });
    document.querySelectorAll("[data-sam-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.samMode === state.samPromptMode);
    });

    const nPos = state.samPosPoints.length;
    const nNeg = state.samNegPoints.length;
    const hasBox = Boolean(state.samBox);
    const hasPrompts = nPos > 0 || nNeg > 0 || hasBox;
    const hasMask = Boolean(state.samPreviewMask && state.samPreviewPixels > 0);

    elBtnSamAdd.disabled = !hasMask || state.samBusy;
    elBtnSamNew.disabled = !hasMask || state.samBusy;
    elBtnSamReplace.disabled = !hasMask || state.samBusy || !getActiveObject();
    elBtnSamUndoPt.disabled = state.samPromptHistory.length === 0 || state.samBusy;
    elBtnSamClear.disabled = (!hasPrompts && !hasMask) || state.samBusy;

    if (state.offlineMode) {
      elSamInfoLine.textContent = "Modo local en iPad: SAM/SAM2 solo está disponible conectado al servidor del ordenador.";
    } else if (state.samBusy) {
      elSamInfoLine.textContent = `Ejecutando ${state.samModel.toUpperCase()} sobre la imagen...`;
    } else if (hasMask) {
      elSamInfoLine.textContent = `${nPos}+ · ${nNeg}−${hasBox ? " · ▢" : ""} → ${state.samPreviewPixels.toLocaleString("es-ES")} px propuestos`;
    } else if (hasPrompts) {
      elSamInfoLine.textContent = `${nPos}+ · ${nNeg}−${hasBox ? " · ▢" : ""} (sin píxeles)`;
    } else {
      elSamInfoLine.textContent = `Toca con el Apple Pencil (${state.samPromptMode === "box" ? "arrastra caja" : state.samPromptMode === "neg" ? "punto negativo" : "punto positivo"}).`;
    }

    if (state.tool === "sam_ai") {
      elToolPill.textContent = `✨ IA ${state.samModel.toUpperCase()}`;
    }
    refreshJoinUi();
  }

  function clearSamPrompts(keepToast = false) {
    state.samRequestSeq++;
    state.samPosPoints = [];
    state.samNegPoints = [];
    state.samPromptHistory = [];
    state.samBox = null;
    state.samBoxDraft = null;
    state.samPreviewMask = null;
    state.samPreviewPixels = 0;
    state.samBusy = false;
    renderSamPreviewOverlay();
    drawUiOverlay();
    updateSamUi();
    if (keepToast) showToast("Propuesta IA limpiada");
  }

  async function runSamPredict() {
    if (state.currentImageId === null) return;
    if (state.offlineMode) {
      showToast("✨ SAM requiere conexión con el ordenador");
      updateSamUi();
      return;
    }
    if (state.samPosPoints.length === 0 && state.samNegPoints.length === 0 && !state.samBox) {
      state.samPreviewMask = null;
      state.samPreviewPixels = 0;
      renderSamPreviewOverlay();
      updateSamUi();
      return;
    }

    const seq = ++state.samRequestSeq;
    state.samBusy = true;
    updateSamUi();

    try {
      const resp = await fetch(`/api/images/${encodeURIComponent(state.currentImageId)}/sam`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: state.samModel,
          pos_points: state.samPosPoints,
          neg_points: state.samNegPoints,
          obj_bbox: state.samBox,
        }),
      });
      const data = await resp.json();
      if (seq !== state.samRequestSeq) return;
      if (!resp.ok) throw new Error(data.error || "Error llamando a SAM");

      const arr = new Uint8Array(state.imgW * state.imgH);
      const pxCount = data.mask_rle ? decodeRleToArray(data.mask_rle, arr) : 0;
      state.samPreviewMask = pxCount > 0 ? arr : null;
      state.samPreviewPixels = pxCount;
      state.samBusy = false;
      renderSamPreviewOverlay();
      updateSamUi();
    } catch (err) {
      if (seq !== state.samRequestSeq) return;
      state.samBusy = false;
      updateSamUi();
      showToast(`❌ ${err.message || err}`);
    }
  }

  function undoLastSamPrompt() {
    const last = state.samPromptHistory.pop();
    if (!last) return;
    if (last.type === "pos") state.samPosPoints.pop();
    else if (last.type === "neg") state.samNegPoints.pop();
    else if (last.type === "box") state.samBox = last.prevBox || null;
    drawUiOverlay();
    runSamPredict();
  }

  function applySamMask(mode) {
    if (!state.samPreviewMask) return;
    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    const sam = state.samPreviewMask;
    const n = sam.length;

    let targetObj = getActiveObject();
    if (mode === "new" || !targetObj) {
      const lbl = elNewObjLabel.value || targetObj?.label || state.labels[0]?.name;
      targetObj = createObject(lbl, new Uint8Array(sam), "semi-auto", true);
    } else {
      if (targetObj.locked) {
        showToast("🔒 Objeto bloqueado");
        return;
      }
      if (mode === "replace") {
        targetObj.mask.fill(0);
      }
      const lockedOthers = state.objects.filter((o) => o.uid !== targetObj.uid && o.locked);
      const unlockedOthers = state.disjointMode
        ? state.objects.filter((o) => o.uid !== targetObj.uid && !o.locked)
        : [];
      for (let i = 0; i < n; i++) {
        if (!sam[i]) continue;
        if (state.disjointMode) {
          let blocked = false;
          for (let k = 0; k < lockedOthers.length; k++) {
            if (lockedOthers[k].mask[i]) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
          for (let k = 0; k < unlockedOthers.length; k++) {
            unlockedOthers[k].mask[i] = 0;
          }
        }
        targetObj.mask[i] = 1;
      }
      targetObj.source = "semi-auto";
    }

    for (const o of state.objects) o.pixelCount = countMaskPixels(o.mask);
    clearSamPrompts(false);
    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
    showToast(
      mode === "new" ? `✨ Nuevo objeto creado (${targetObj.label})`
        : mode === "replace" ? "✓ Máscara reemplazada con IA"
          : "➕ Propuesta IA sumada al objeto"
    );
  }

  // ---- Join Masks Operations ----
  function joinSelectedObjectsIntoOne() {
    const selected = state.objects.filter((o) => o.selectedForJoin);
    if (selected.length < 2) {
      showToast("Marca al menos 2 objetos en el panel derecho");
      return;
    }
    const lockedSel = selected.filter((o) => o.locked);
    if (lockedSel.length > 0) {
      showToast("🔒 Hay objetos bloqueados entre los marcados");
      return;
    }

    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;

    const targetLabel = elJoinTargetLabel.value || selected[0].label;
    const mergedMask = new Uint8Array(state.imgW * state.imgH);
    for (const obj of selected) {
      const m = obj.mask;
      for (let i = 0; i < m.length; i++) {
        if (m[i]) mergedMask[i] = 1;
      }
    }

    const firstIdx = state.objects.indexOf(selected[0]);
    const selectedSet = new Set(selected.map((o) => o.uid));
    const remaining = state.objects.filter((o) => !selectedSet.has(o.uid));

    const col = labelColor(targetLabel);
    const mergedObj = {
      uid: `obj_${state.nextUidSeq++}`,
      label: targetLabel,
      color: col,
      rgb: hexToRgb(col),
      source: "manual",
      occluded: "0",
      z_order: firstIdx,
      group_id: selected[0].group_id || "",
      visible: true,
      locked: false,
      selectedForJoin: false,
      mask: mergedMask,
      pixelCount: countMaskPixels(mergedMask),
    };

    const insertAt = Math.min(firstIdx, remaining.length);
    remaining.splice(insertAt, 0, mergedObj);
    state.objects = remaining;
    state.activeObjectUid = mergedObj.uid;

    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
    elJoinPopover.classList.add("hidden");
    showToast(`🔗 ${selected.length} objetos unidos en 1 máscara (${mergedObj.pixelCount.toLocaleString("es-ES")} px)`);
  }

  function joinNearbyFragmentsClosing(radius = 2) {
    const activeObj = getActiveObject();
    if (!activeObj) {
      showToast("Selecciona un objeto primero");
      return;
    }
    if (activeObj.locked) {
      showToast("🔒 Objeto bloqueado");
      return;
    }
    const w = state.imgW;
    const h = state.imgH;
    const m = activeObj.mask;

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (m[row + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) {
      showToast("La máscara activa está vacía");
      return;
    }

    minX = Math.max(0, minX - radius - 1);
    minY = Math.max(0, minY - radius - 1);
    maxX = Math.min(w - 1, maxX + radius + 1);
    maxY = Math.min(h - 1, maxY + radius + 1);

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const dilated = new Uint8Array(bw * bh);
    const closed = new Uint8Array(bw * bh);
    const r2 = radius * radius;

    for (let ly = 0; ly < bh; ly++) {
      const gy = minY + ly;
      for (let lx = 0; lx < bw; lx++) {
        const gx = minX + lx;
        if (!m[gy * w + gx]) continue;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = ly + dy;
          if (ny < 0 || ny >= bh) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const nx = lx + dx;
            if (nx >= 0 && nx < bw) dilated[ny * bw + nx] = 1;
          }
        }
      }
    }

    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        if (!dilated[ly * bw + lx]) continue;
        let ok = true;
        for (let dy = -radius; dy <= radius && ok; dy++) {
          const ny = ly + dy;
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > r2) continue;
            const nx = lx + dx;
            if (nx < 0 || nx >= bw || ny < 0 || ny >= bh || !dilated[ny * bw + nx]) {
              ok = false;
              break;
            }
          }
        }
        if (ok) closed[ly * bw + lx] = 1;
      }
    }

    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    let added = 0;
    for (let ly = 0; ly < bh; ly++) {
      const gy = minY + ly;
      for (let lx = 0; lx < bw; lx++) {
        const gx = minX + lx;
        const idx = gy * w + gx;
        if (closed[ly * bw + lx] && !m[idx]) {
          m[idx] = 1;
          added++;
        }
      }
    }
    activeObj.pixelCount = countMaskPixels(m);
    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
    showToast(`🩹 Conectados ${added.toLocaleString("es-ES")} px entre fragmentos`);
  }

  // ---- Pointer / Apple Pencil Input on Canvas ----
  function canPointerDraw(e) {
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return e.button === 0;
    if (e.pointerType === "touch") return !state.palmRejection;
    return false;
  }

  function effectiveBrushDiameter(e) {
    const base = currentToolSize();
    if (state.pressureEnabled && e.pointerType === "pen" && typeof e.pressure === "number" && e.pressure > 0) {
      const factor = 0.35 + 0.65 * Math.min(1, Math.max(0.05, e.pressure));
      return Math.max(1, base * factor);
    }
    return base;
  }

  viewport.addEventListener("pointerdown", (e) => {
    if (e.target !== viewport && e.target !== canvasStage && !canvasStage.contains(e.target)) {
      return;
    }
    e.preventDefault();
    viewport.setPointerCapture(e.pointerId);
    state.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    // Auto-hide transient size/opacity popovers when touching canvas
    elSizePopover.classList.add("hidden");
    elOpacityPopover.classList.add("hidden");

    if (state.activePointers.size >= 2) {
      if (state.drawingPointerId !== null) {
        state.drawingPointerId = null;
        state.lassoPoints = [];
        state.samBoxDraft = null;
        drawUiOverlay();
      }
      const pts = Array.from(state.activePointers.values());
      const cx = (pts[0].x + pts[1].x) * 0.5;
      const cy = (pts[0].y + pts[1].y) * 0.5;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      state.pinchStart = { cx, cy, dist, tx: state.tx, ty: state.ty, scale: state.scale };
      return;
    }

    if (canPointerDraw(e)) {
      const pt = screenToImage(e.clientX, e.clientY);
      state.hoverPt = pt;

      if (state.tool === "sam_ai") {
        const cx = Math.max(0, Math.min(state.imgW - 1, pt.x));
        const cy = Math.max(0, Math.min(state.imgH - 1, pt.y));
        if (state.samPromptMode === "box") {
          state.drawingPointerId = e.pointerId;
          state.samBoxDraft = { start: { x: cx, y: cy }, end: { x: cx, y: cy } };
          drawUiOverlay();
        } else if (state.samPromptMode === "neg") {
          state.samNegPoints.push([cx, cy]);
          state.samPromptHistory.push({ type: "neg" });
          drawUiOverlay();
          runSamPredict();
        } else {
          state.samPosPoints.push([cx, cy]);
          state.samPromptHistory.push({ type: "pos" });
          drawUiOverlay();
          runSamPredict();
        }
        return;
      }

      state.drawingPointerId = e.pointerId;
      if (state.tool === "lasso_fill" || state.tool === "lasso_erase") {
        state.lassoPoints = [pt];
        drawUiOverlay();
      } else {
        state.lastPt = pt;
        state.strokeBBox = null;
        state.strokeBeforeMap = null;
        paintBrushCapsule(pt, pt, effectiveBrushDiameter(e), state.tool === "eraser");
        drawUiOverlay();
      }
      return;
    }

    if (e.pointerType === "touch") {
      state.panStart = { x: e.clientX, y: e.clientY, tx: state.tx, ty: state.ty };
    }
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!state.activePointers.has(e.pointerId) && e.pointerType !== "pen" && e.pointerType !== "mouse") {
      return;
    }
    if (e.target !== viewport && e.target !== canvasStage && !canvasStage.contains(e.target) && !state.activePointers.has(e.pointerId)) {
      return;
    }
    e.preventDefault();
    if (state.activePointers.has(e.pointerId)) {
      state.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    }

    if (state.activePointers.size >= 2 && state.pinchStart) {
      const pts = Array.from(state.activePointers.values());
      const cx = (pts[0].x + pts[1].x) * 0.5;
      const cy = (pts[0].y + pts[1].y) * 0.5;
      const dist = Math.max(1, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const rect = viewport.getBoundingClientRect();
      const zoomFactor = dist / Math.max(1, state.pinchStart.dist);
      const newScale = Math.max(0.05, Math.min(40, state.pinchStart.scale * zoomFactor));
      const worldX = (state.pinchStart.cx - rect.left - state.pinchStart.tx) / state.pinchStart.scale;
      const worldY = (state.pinchStart.cy - rect.top - state.pinchStart.ty) / state.pinchStart.scale;
      state.scale = newScale;
      state.tx = (cx - rect.left) - worldX * newScale;
      state.ty = (cy - rect.top) - worldY * newScale;
      updateStageTransform();
      return;
    }

    const pt = screenToImage(e.clientX, e.clientY);
    state.hoverPt = pt;

    if (state.drawingPointerId === e.pointerId) {
      if (state.tool === "sam_ai" && state.samBoxDraft) {
        state.samBoxDraft.end = {
          x: Math.max(0, Math.min(state.imgW - 1, pt.x)),
          y: Math.max(0, Math.min(state.imgH - 1, pt.y)),
        };
        drawUiOverlay();
        return;
      }

      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
      if (state.tool === "lasso_fill" || state.tool === "lasso_erase") {
        for (const ce of events) {
          const cpt = screenToImage(ce.clientX, ce.clientY);
          const prev = state.lassoPoints[state.lassoPoints.length - 1];
          if (!prev || Math.hypot(cpt.x - prev.x, cpt.y - prev.y) >= 1.5) {
            state.lassoPoints.push(cpt);
          }
        }
        drawUiOverlay();
      } else if (state.tool === "brush" || state.tool === "eraser") {
        for (const ce of events) {
          const cpt = screenToImage(ce.clientX, ce.clientY);
          paintBrushCapsule(state.lastPt || cpt, cpt, effectiveBrushDiameter(ce), state.tool === "eraser");
          state.lastPt = cpt;
        }
        drawUiOverlay();
      }
      return;
    }

    if (state.panStart && e.pointerType === "touch") {
      state.tx = state.panStart.tx + (e.clientX - state.panStart.x);
      state.ty = state.panStart.ty + (e.clientY - state.panStart.y);
      updateStageTransform();
      return;
    }

    if (e.pointerType === "pen" || e.pointerType === "mouse") {
      drawUiOverlay();
    }
  });

  function finishPointer(e) {
    if (!state.activePointers.has(e.pointerId)) return;
    state.activePointers.delete(e.pointerId);

    if (state.activePointers.size < 2) {
      state.pinchStart = null;
    }

    if (state.drawingPointerId === e.pointerId) {
      state.drawingPointerId = null;
      if (state.tool === "sam_ai" && state.samBoxDraft) {
        const d = state.samBoxDraft;
        state.samBoxDraft = null;
        const x0 = Math.min(d.start.x, d.end.x);
        const y0 = Math.min(d.start.y, d.end.y);
        const x1 = Math.max(d.start.x, d.end.x);
        const y1 = Math.max(d.start.y, d.end.y);
        if (x1 - x0 >= 4 && y1 - y0 >= 4) {
          state.samPromptHistory.push({ type: "box", prevBox: state.samBox });
          state.samBox = [[x0, y0], [x1, y1]];
          drawUiOverlay();
          runSamPredict();
        } else {
          drawUiOverlay();
        }
      } else if (state.tool === "lasso_fill" || state.tool === "lasso_erase") {
        const pts = state.lassoPoints;
        state.lassoPoints = [];
        drawUiOverlay();
        applyLassoPolygon(pts, state.tool === "lasso_erase");
      } else {
        finalizeStrokeHistory();
      }
      state.lastPt = null;
    }

    if (e.pointerType === "touch") {
      state.panStart = null;
    }
  }

  viewport.addEventListener("pointerup", finishPointer);
  viewport.addEventListener("pointercancel", finishPointer);

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const vx = e.clientX - rect.left;
    const vy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.05, Math.min(40, state.scale * factor));
    const wx = (vx - state.tx) / state.scale;
    const wy = (vy - state.ty) / state.scale;
    state.scale = newScale;
    state.tx = vx - wx * newScale;
    state.ty = vy - wy * newScale;
    updateStageTransform();
  }, { passive: false });

  // ---- Movable Apple-Notes-style floating toolbar ----
  function clampDockIntoViewport() {
    const vpRect = viewport.getBoundingClientRect();
    const dockRect = elNotesDock.getBoundingClientRect();
    if (!vpRect.width || !vpRect.height) return;
    if (elNotesDock.style.left) {
      let left = parseFloat(elNotesDock.style.left) || 12;
      let top = parseFloat(elNotesDock.style.top) || 12;
      left = Math.max(8, Math.min(vpRect.width - dockRect.width - 8, left));
      top = Math.max(8, Math.min(vpRect.height - dockRect.height - 8, top));
      elNotesDock.style.left = `${left}px`;
      elNotesDock.style.top = `${top}px`;
      elNotesDock.style.right = "auto";
    }
  }

  function saveDockPrefs() {
    try {
      localStorage.setItem(
        DOCK_STORAGE_KEY,
        JSON.stringify({
          left: elNotesDock.style.left || "",
          top: elNotesDock.style.top || "",
          horizontal: elNotesDock.classList.contains("horizontal"),
        })
      );
    } catch (_) {}
  }

  function loadDockPrefs() {
    try {
      const raw = localStorage.getItem(DOCK_STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.horizontal) elNotesDock.classList.add("horizontal");
      if (prefs.left && prefs.top) {
        elNotesDock.style.left = prefs.left;
        elNotesDock.style.top = prefs.top;
        elNotesDock.style.right = "auto";
        requestAnimationFrame(clampDockIntoViewport);
      }
    } catch (_) {}
  }

  let dockDrag = null;
  elNotesDragHandle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    elNotesDragHandle.setPointerCapture(e.pointerId);
    const vpRect = viewport.getBoundingClientRect();
    const dockRect = elNotesDock.getBoundingClientRect();
    const curLeft = dockRect.left - vpRect.left;
    const curTop = dockRect.top - vpRect.top;
    elNotesDock.style.left = `${curLeft}px`;
    elNotesDock.style.top = `${curTop}px`;
    elNotesDock.style.right = "auto";
    dockDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: curLeft,
      origTop: curTop,
    };
  });

  elNotesDragHandle.addEventListener("pointermove", (e) => {
    if (!dockDrag || e.pointerId !== dockDrag.pointerId) return;
    e.stopPropagation();
    e.preventDefault();
    const vpRect = viewport.getBoundingClientRect();
    const dockRect = elNotesDock.getBoundingClientRect();
    const nextLeft = Math.max(8, Math.min(vpRect.width - dockRect.width - 8, dockDrag.origLeft + (e.clientX - dockDrag.startX)));
    const nextTop = Math.max(8, Math.min(vpRect.height - dockRect.height - 8, dockDrag.origTop + (e.clientY - dockDrag.startY)));
    elNotesDock.style.left = `${nextLeft}px`;
    elNotesDock.style.top = `${nextTop}px`;
    positionSizePopover();
  });

  const endDockDrag = (e) => {
    if (!dockDrag || e.pointerId !== dockDrag.pointerId) return;
    e.stopPropagation();
    dockDrag = null;
    clampDockIntoViewport();
    positionSizePopover();
    saveDockPrefs();
  };
  elNotesDragHandle.addEventListener("pointerup", endDockDrag);
  elNotesDragHandle.addEventListener("pointercancel", endDockDrag);

  elBtnDockOrient.onclick = () => {
    elNotesDock.classList.toggle("horizontal");
    requestAnimationFrame(() => {
      clampDockIntoViewport();
      positionSizePopover();
      saveDockPrefs();
    });
  };

  [
    elNotesDock,
    elSizePopover,
    elOpacityPopover,
    elSamPopover,
    elJoinPopover,
    document.getElementById("fullscreen-hud"),
  ].forEach((el) => {
    if (!el) return;
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  window.addEventListener("resize", () => {
    clampDockIntoViewport();
    positionSizePopover();
  });

  // ---- Image Loading & Saving (PC Server OR iPad Offline Store) ----
  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function updateLocalModalUi() {
    if (!elLocalCurrentBox) return;
    const store = window.CvatOfflineStore;
    const hasDoc = Boolean(state.offlineMode && store && store.doc);
    elLocalCurrentBox.classList.toggle("hidden", !hasDoc);
    if (hasDoc) {
      const imgs = store.listImages();
      const annotated = imgs.filter((i) => i.num_masks > 0).length;
      elLocalCurrentName.textContent = `Lote en iPad: ${store.projectName}`;
      elLocalCurrentMeta.textContent = `${imgs.length} imágenes · ${annotated} con máscaras guardadas`;
    }
  }

  function openLocalModal() {
    updateLocalModalUi();
    if (elLocalModal) elLocalModal.classList.remove("hidden");
  }

  function closeLocalModal() {
    if (elLocalModal) elLocalModal.classList.add("hidden");
  }

  async function loadImage(imageId) {
    if (state.dirty && state.currentImageId !== null) {
      await saveCurrentMasks();
    }
    clearSamPrompts(false);
    state.currentImageId = imageId;
    elSelectImage.value = String(imageId);

    let photoUrl;
    let objResp;
    if (state.offlineMode) {
      const store = window.CvatOfflineStore;
      photoUrl = await store.getPhotoUrl(imageId);
      objResp = store.getImageObjects(imageId);
    } else {
      photoUrl = `./api/images/${encodeURIComponent(imageId)}/photo?t=${Date.now()}`;
      objResp = await fetch(`./api/images/${encodeURIComponent(imageId)}/objects`).then((r) => r.json());
    }

    const photoResp = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = photoUrl;
    });

    state.photoImage = photoResp;
    state.imgW = objResp.width || photoResp.naturalWidth;
    state.imgH = objResp.height || photoResp.naturalHeight;
    state.points = objResp.points || [];

    photoCanvas.width = state.imgW;
    photoCanvas.height = state.imgH;
    maskCanvas.width = state.imgW;
    maskCanvas.height = state.imgH;
    samCanvas.width = state.imgW;
    samCanvas.height = state.imgH;
    uiCanvas.width = state.imgW;
    uiCanvas.height = state.imgH;
    canvasStage.style.width = `${state.imgW}px`;
    canvasStage.style.height = `${state.imgH}px`;

    elDimsBadge.textContent = `${state.imgW}×${state.imgH}`;
    maskImageData = maskCtx.createImageData(state.imgW, state.imgH);

    state.objects = [];
    for (const rawObj of objResp.objects || []) {
      const maskArr = new Uint8Array(state.imgW * state.imgH);
      const px = rawObj.mask_rle ? decodeRleToArray(rawObj.mask_rle, maskArr) : 0;
      const col = rawObj.color || labelColor(rawObj.label);
      state.objects.push({
        uid: `obj_${state.nextUidSeq++}`,
        label: rawObj.label,
        color: col,
        rgb: hexToRgb(col),
        source: rawObj.source || "manual",
        occluded: rawObj.occluded || "0",
        z_order: rawObj.z_order ?? state.objects.length,
        group_id: rawObj.group_id || "",
        visible: true,
        locked: false,
        selectedForJoin: false,
        mask: maskArr,
        pixelCount: px,
      });
    }
    state.activeObjectUid = state.objects[0]?.uid || null;

    state.undoStack = [];
    state.redoStack = [];
    setDirty(false);
    renderPhotoCanvas();
    renderFullMaskOverlay();
    renderSamPreviewOverlay();
    renderObjectsPanel();
    drawUiOverlay();
    fitImageToViewport();
  }

  async function saveCurrentMasks() {
    if (state.currentImageId === null) return;
    elSaveStatus.textContent = "Guardando...";
    const payloadObjects = [];
    state.objects.forEach((obj, idx) => {
      const rle = encodeUint8MaskToRle(obj.mask);
      if (!rle) return;
      payloadObjects.push({
        label: obj.label,
        source: obj.source || "manual",
        occluded: obj.occluded || "0",
        z_order: idx,
        group_id: obj.group_id || "",
        mask_rle: rle,
      });
    });

    if (state.offlineMode) {
      const result = await window.CvatOfflineStore.updateImageObjects(state.currentImageId, payloadObjects);
      setDirty(false);
      showToast(`💾 Guardado en iPad (${result.num_objects} obj)`);
      await refreshImageList();
      updateLocalModalUi();
      return;
    }

    const resp = await fetch(`./api/images/${encodeURIComponent(state.currentImageId)}/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objects: payloadObjects }),
    });
    if (!resp.ok) {
      showToast("❌ Error al guardar");
      elSaveStatus.textContent = "Error al guardar";
      return;
    }
    const result = await resp.json();
    setDirty(false);
    const zipLabel = result.cvat_zip_path ? result.cvat_zip_path.split(/[\\/]/).pop() : "ZIP CVAT";
    showToast(`💾 Guardado (${result.num_objects} obj · ${zipLabel})`);
    await refreshImageList();
  }

  async function refreshImageList() {
    const data = state.offlineMode
      ? { images: window.CvatOfflineStore.listImages() }
      : await fetch("./api/images").then((r) => r.json());
    state.images = data.images || [];
    const cur = String(state.currentImageId ?? "");
    elSelectImage.innerHTML = "";
    for (const img of state.images) {
      const opt = document.createElement("option");
      opt.value = img.id;
      const mark = img.num_masks > 0 ? "● " : "○ ";
      opt.textContent = `${mark}${img.name}`;
      elSelectImage.appendChild(opt);
    }
    if (cur) elSelectImage.value = cur;
  }

  function populateLabelSelectors() {
    [elNewObjLabel, elJoinTargetLabel].forEach((sel) => {
      const prev = sel.value;
      sel.innerHTML = "";
      for (const lbl of state.labels) {
        const opt = document.createElement("option");
        opt.value = lbl.name;
        opt.textContent = lbl.name;
        sel.appendChild(opt);
      }
      if (prev && state.labels.some((l) => l.name === prev)) {
        sel.value = prev;
      }
    });
  }

  async function applyWorkspaceStatus(status) {
    state.labels = (status.labels || []).map((l) => ({
      ...l,
      rgb: hexToRgb(l.color),
    }));
    populateLabelSelectors();
    if (status.sam) {
      state.samStatus = status.sam;
      if (!state.samStatus.sam2?.available && state.samStatus.sam1?.available) {
        state.samModel = "sam1";
      }
    }
    if (state.offlineMode) {
      elServerInfo.textContent = `Modo local en iPad (offline) · Lote: ${status.project_name || "lote_ipad"} · ${status.total_images || 0} imágenes`;
      if (elBtnDownloadIpadBundle) elBtnDownloadIpadBundle.classList.add("hidden");
      if (elBtnUploadSyncZip) elBtnUploadSyncZip.classList.add("hidden");
      if (elBtnExportBenchmark) elBtnExportBenchmark.classList.add("hidden");
    } else {
      const zipInfo = status.cvat_zip_path ? ` · ZIP: ${status.cvat_zip_path.split(/[\\/]/).pop()}` : "";
      elServerInfo.textContent = `Red local: ${status.lan_url} · XML: ${status.xml_name}${zipInfo}`;
      if (elBtnDownloadIpadBundle) elBtnDownloadIpadBundle.classList.remove("hidden");
      if (elBtnUploadSyncZip) elBtnUploadSyncZip.classList.remove("hidden");
      if (elBtnExportBenchmark) elBtnExportBenchmark.classList.remove("hidden");
    }
    updateSamUi();
    syncSizeBadges();
    await refreshImageList();
    if (state.images.length > 0) {
      await loadImage(state.images[0].id);
    }
  }

  async function detectServerStatus() {
    if (location.protocol === "file:") return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1800);
    try {
      const resp = await fetch("./api/status", { cache: "no-store", signal: ctrl.signal });
      if (!resp.ok) return null;
      const ctype = resp.headers.get("content-type") || "";
      if (!ctype.includes("application/json")) return null;
      const data = await resp.json();
      return data && data.ok ? data : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function registerPwaServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const isSecure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!isSecure) return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  async function init() {
    registerPwaServiceWorker();
    loadDockPrefs();

    const serverStatus = await detectServerStatus();
    if (serverStatus) {
      state.offlineMode = false;
      await applyWorkspaceStatus(serverStatus);
    } else {
      state.offlineMode = true;
      const store = window.CvatOfflineStore;
      const restored = store ? await store.loadSavedProject().catch(() => false) : false;
      if (restored) {
        await applyWorkspaceStatus(store.getStatus());
        showToast(`📂 Lote recuperado: ${store.projectName}`);
      } else {
        await applyWorkspaceStatus(store.getStatus());
        openLocalModal();
      }
    }
    requestAnimationFrame(clampDockIntoViewport);
  }

  // ---- UI Event Bindings ----
  document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.onclick = () => {
      const t = btn.dataset.tool;
      setTool(t, false, t === "brush" || t === "eraser");
    };
  });

  function setActiveToolSize(val) {
    const clamped = Math.max(1, Math.min(200, Math.round(val)));
    if (state.tool === "eraser") state.eraserSize = clamped;
    else state.brushSize = clamped;
    syncSizeBadges();
    drawUiOverlay();
  }

  function updateSizeFromTrackPointer(clientX, clientY) {
    const r = elSizeTrack.getBoundingClientRect();
    const isVert = elSizePopover.classList.contains("vertical-mode");
    let t = 0;
    if (isVert) {
      t = (r.bottom - clientY) / Math.max(1, r.height);
    } else {
      t = (clientX - r.left) / Math.max(1, r.width);
    }
    t = Math.max(0, Math.min(1, t));
    const sz = Math.round(1 + 199 * Math.pow(t, 1.5));
    setActiveToolSize(sz);
  }

  let sizeTrackDragId = null;
  elSizeTrack.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    sizeTrackDragId = e.pointerId;
    elSizeTrack.setPointerCapture(e.pointerId);
    updateSizeFromTrackPointer(e.clientX, e.clientY);
  });
  elSizeTrack.addEventListener("pointermove", (e) => {
    if (sizeTrackDragId !== e.pointerId) return;
    e.stopPropagation();
    e.preventDefault();
    updateSizeFromTrackPointer(e.clientX, e.clientY);
  });
  const endSizeTrackDrag = (e) => {
    if (sizeTrackDragId !== e.pointerId) return;
    e.stopPropagation();
    sizeTrackDragId = null;
  };
  elSizeTrack.addEventListener("pointerup", endSizeTrackDrag);
  elSizeTrack.addEventListener("pointercancel", endSizeTrackDrag);

  elSizeSlider.oninput = (e) => setActiveToolSize(Number(e.target.value));
  document.querySelectorAll(".size-preset").forEach((chip) => {
    chip.onclick = () => setActiveToolSize(Number(chip.dataset.size));
  });
  document.getElementById("btn-size-close").onclick = () => elSizePopover.classList.add("hidden");

  document.getElementById("btn-opacity-popover").onclick = () => {
    const opening = elOpacityPopover.classList.contains("hidden");
    hideDockPopovers(opening ? "opacity" : null);
    if (opening) elOpacityPopover.classList.remove("hidden");
  };
  document.getElementById("btn-opacity-close").onclick = () => elOpacityPopover.classList.add("hidden");

  elMaskOpacity.oninput = (e) => {
    state.maskOpacity = Number(e.target.value) / 100;
    elMaskOpacityVal.textContent = `${e.target.value}%`;
    elLblOpacityBtn.textContent = `${e.target.value}%`;
    renderFullMaskOverlay();
  };
  elChkPalm.onchange = (e) => { state.palmRejection = e.target.checked; };
  elChkPressure.onchange = (e) => { state.pressureEnabled = e.target.checked; };
  elChkDisjoint.onchange = (e) => { state.disjointMode = e.target.checked; };

  document.getElementById("btn-undo").onclick = undo;
  document.getElementById("btn-redo").onclick = redo;
  document.getElementById("btn-fit").onclick = fitImageToViewport;
  document.getElementById("btn-save").onclick = saveCurrentMasks;
  document.getElementById("btn-dock-save").onclick = saveCurrentMasks;

  // Objects panel actions
  document.getElementById("btn-new-object").onclick = () => {
    if (!state.imgW) return;
    const beforeObjs = cloneObjectsList(state.objects);
    const beforeActiveUid = state.activeObjectUid;
    const obj = createObject(elNewObjLabel.value, null, "manual", true);
    pushFullObjectsUndo(beforeObjs, beforeActiveUid);
    showToast(`+ Nuevo objeto: ${obj.label}`);
  };
  document.getElementById("btn-show-all-objs").onclick = () => {
    state.objects.forEach((o) => { o.visible = true; });
    renderObjectsPanel();
    renderFullMaskOverlay();
  };
  document.getElementById("btn-isolate-obj").onclick = () => {
    if (!state.activeObjectUid) return;
    state.objects.forEach((o) => { o.visible = o.uid === state.activeObjectUid; });
    renderObjectsPanel();
    renderFullMaskOverlay();
  };
  document.getElementById("btn-clear-object").onclick = clearActiveObjectMask;
  elBtnJoinSelectedPanel.onclick = joinSelectedObjectsIntoOne;

  // SAM AI controls
  document.querySelectorAll("[data-sam-model]").forEach((btn) => {
    btn.onclick = () => {
      state.samModel = btn.dataset.samModel;
      updateSamUi();
      if (state.samPosPoints.length > 0 || state.samNegPoints.length > 0 || state.samBox) {
        runSamPredict();
      }
    };
  });
  document.querySelectorAll("[data-sam-mode]").forEach((btn) => {
    btn.onclick = () => {
      state.samPromptMode = btn.dataset.samMode;
      updateSamUi();
    };
  });
  elBtnSamAdd.onclick = () => applySamMask("add");
  elBtnSamNew.onclick = () => applySamMask("new");
  elBtnSamReplace.onclick = () => applySamMask("replace");
  elBtnSamUndoPt.onclick = undoLastSamPrompt;
  elBtnSamClear.onclick = () => clearSamPrompts(true);

  // Join Masks popover controls
  document.getElementById("btn-join-masks").onclick = () => {
    const opening = elJoinPopover.classList.contains("hidden");
    hideDockPopovers(opening ? "join" : null);
    if (opening) {
      refreshJoinUi();
      elJoinPopover.classList.remove("hidden");
    }
  };
  document.getElementById("btn-join-close").onclick = () => elJoinPopover.classList.add("hidden");
  elBtnJoinSelected.onclick = joinSelectedObjectsIntoOne;
  elBtnJoinSam.onclick = () => applySamMask("add");
  document.getElementById("btn-join-fragments").onclick = () => joinNearbyFragmentsClosing(2);

  function setFullscreen(flag) {
    const next = Boolean(flag);
    if (state.isFullscreen === next) return;
    const oldRect = viewport.getBoundingClientRect();
    state.isFullscreen = next;
    elAppShell.classList.toggle("is-fullscreen", next);
    if (elBtnFullscreen) {
      elBtnFullscreen.textContent = next ? "✕ Salir" : "⛶ Pantalla completa";
    }

    if (next) {
      const req = elAppShell.requestFullscreen || elAppShell.webkitRequestFullscreen;
      if (typeof req === "function") {
        try {
          const p = req.call(elAppShell);
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch (_) {}
      }
    } else if (document.fullscreenElement || document.webkitFullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (typeof exit === "function") {
        try {
          const p = exit.call(document);
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch (_) {}
      }
    }

    requestAnimationFrame(() => {
      const newRect = viewport.getBoundingClientRect();
      state.tx += (newRect.width - oldRect.width) * 0.5;
      state.ty += (newRect.height - oldRect.height) * 0.5;
      updateStageTransform();
      clampDockIntoViewport();
    });
  }

  document.getElementById("btn-toggle-panel").onclick = () => {
    elInspector.classList.toggle("collapsed");
    requestAnimationFrame(clampDockIntoViewport);
  };

  if (elBtnFullscreen) {
    elBtnFullscreen.onclick = () => setFullscreen(!state.isFullscreen);
  }
  document.getElementById("fs-btn-exit").onclick = () => setFullscreen(false);
  document.getElementById("fs-btn-fit").onclick = fitImageToViewport;
  document.getElementById("fs-btn-save").onclick = saveCurrentMasks;

  const goPrevImg = () => {
    const idx = state.images.findIndex((i) => String(i.id) === String(state.currentImageId));
    if (idx > 0) loadImage(state.images[idx - 1].id);
  };
  const goNextImg = () => {
    const idx = state.images.findIndex((i) => String(i.id) === String(state.currentImageId));
    if (idx >= 0 && idx < state.images.length - 1) loadImage(state.images[idx + 1].id);
  };
  document.getElementById("btn-prev-img").onclick = goPrevImg;
  document.getElementById("btn-next-img").onclick = goNextImg;
  document.getElementById("fs-btn-prev").onclick = goPrevImg;
  document.getElementById("fs-btn-next").onclick = goNextImg;

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && state.isFullscreen && !navigator.maxTouchPoints) {
      setFullscreen(false);
    }
  });

  const btnGrayBg = document.getElementById("btn-gray-bg");
  btnGrayBg.onclick = () => {
    state.grayBgPreview = !state.grayBgPreview;
    btnGrayBg.classList.toggle("active", state.grayBgPreview);
    renderPhotoCanvas();
  };

  const btnPeek = document.getElementById("btn-peek");
  btnPeek.addEventListener("pointerdown", () => {
    state.peekOriginal = true;
    maskCanvas.style.opacity = "0";
    samCanvas.style.opacity = "0";
  });
  const endPeek = () => {
    state.peekOriginal = false;
    maskCanvas.style.opacity = "1";
    samCanvas.style.opacity = "1";
  };
  btnPeek.addEventListener("pointerup", endPeek);
  btnPeek.addEventListener("pointercancel", endPeek);
  btnPeek.addEventListener("pointerleave", endPeek);

  elSelectImage.onchange = (e) => loadImage(e.target.value);

  async function downloadCurrentXml() {
    if (state.dirty && state.currentImageId !== null) await saveCurrentMasks();
    if (state.offlineMode) {
      const store = window.CvatOfflineStore;
      if (!store || !store.doc) return showToast("Carga un lote primero");
      triggerBlobDownload(store.getXmlBlob(), "annotations.xml");
      showToast("⬇ Descargado annotations.xml");
      return;
    }
    const resp = await fetch("./api/export/annotations.xml");
    if (!resp.ok) return showToast("❌ Error descargando XML");
    triggerBlobDownload(await resp.blob(), "annotations.xml");
  }

  async function downloadCurrentCvatZip() {
    if (state.dirty && state.currentImageId !== null) await saveCurrentMasks();
    if (state.offlineMode) {
      const store = window.CvatOfflineStore;
      if (!store || !store.doc) return showToast("Carga un lote primero");
      const { blob, filename } = await store.buildCvatZipBlob();
      triggerBlobDownload(blob, filename);
      showToast(`📦 Guardado ${filename}`);
      return;
    }
    const resp = await fetch("./api/export/cvat_zip");
    if (!resp.ok) return showToast("❌ Error descargando ZIP");
    triggerBlobDownload(await resp.blob(), "cvat_export.zip");
  }

  if (elBtnDownloadXml) elBtnDownloadXml.onclick = downloadCurrentXml;
  if (elBtnDownloadCvatZip) elBtnDownloadCvatZip.onclick = downloadCurrentCvatZip;
  if (elBtnLocalExportZip) elBtnLocalExportZip.onclick = downloadCurrentCvatZip;

  if (elBtnDownloadIpadBundle) {
    elBtnDownloadIpadBundle.onclick = async () => {
      if (state.dirty && state.currentImageId !== null) await saveCurrentMasks();
      showToast("📦 Empaquetando lote completo para iPad...");
      const resp = await fetch("./api/export/ipad_bundle");
      if (!resp.ok) return showToast("❌ Error empaquetando lote");
      const disp = resp.headers.get("Content-Disposition") || "";
      const match = disp.match(/filename="([^"]+)"/i);
      const fname = match ? match[1] : "lote_para_ipad.zip";
      triggerBlobDownload(await resp.blob(), fname);
      showToast(`📦 Guarda ${fname} en Google Drive o En mi iPad`);
    };
  }

  if (elBtnUploadSyncZip && elPcSyncUploadInput) {
    elBtnUploadSyncZip.onclick = () => elPcSyncUploadInput.click();
    elPcSyncUploadInput.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      showToast("⬆ Enviando cambios del iPad al PC...");
      const buf = await file.arrayBuffer();
      const resp = await fetch("./api/sync/import_zip", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buf,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(`❌ ${data.error || "Error sincronizando"}`);
        return;
      }
      await applyWorkspaceStatus(await fetch("./api/status").then((r) => r.json()));
      showToast(`✅ Sincronizado con PC (${data.updated_images || 0} imágenes)`);
    };
  }

  if (elBtnLocalBatch) {
    elBtnLocalBatch.onclick = () => {
      if (state.offlineMode) {
        openLocalModal();
      } else {
        elInspector.classList.remove("collapsed");
        showToast("Conectado al PC: usa Exportación y Sincronización");
      }
    };
  }

  if (elBtnLocalModalClose) elBtnLocalModalClose.onclick = closeLocalModal;
  if (elBtnLocalContinue) elBtnLocalContinue.onclick = closeLocalModal;

  if (elLocalFilesInput) {
    elLocalFilesInput.onchange = async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      elLocalImportStatus.textContent = "Cargando archivos en el iPad (IndexedDB)...";
      try {
        const store = window.CvatOfflineStore;
        const res = await store.importFiles(files);
        state.offlineMode = true;
        await applyWorkspaceStatus(store.getStatus());
        updateLocalModalUi();
        elLocalImportStatus.textContent = `✅ Lote cargado: ${res.matchedPhotos}/${res.totalImages} fotos listas en el iPad.`;
        showToast(`📂 ${res.projectName} listo (${res.matchedPhotos} fotos)`);
        closeLocalModal();
      } catch (err) {
        console.error(err);
        elLocalImportStatus.textContent = `❌ ${err.message || err}`;
        showToast("❌ Error cargando archivos");
      } finally {
        e.target.value = "";
      }
    };
  }

  if (elBtnLocalClear) {
    elBtnLocalClear.onclick = async () => {
      const store = window.CvatOfflineStore;
      if (!store) return;
      await store.clearProject();
      state.images = [];
      state.objects = [];
      state.currentImageId = null;
      elSelectImage.innerHTML = "";
      updateLocalModalUi();
      elLocalImportStatus.textContent = "Caché local borrada. Elige otro lote cuando quieras.";
      showToast("🗑️ Caché local borrada");
    };
  }

  if (elBtnExportBenchmark) {
    elBtnExportBenchmark.onclick = async () => {
      if (state.offlineMode) return;
      if (state.currentImageId === null) return;
      if (state.dirty) await saveCurrentMasks();
      const resp = await fetch(`./api/export/benchmark_case/${encodeURIComponent(state.currentImageId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (resp.ok) {
        showToast(`🧪 Exportado a ${data.output_dir}`);
      } else {
        showToast(`❌ ${data.error || "Error"}`);
      }
    };
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !state.peekOriginal) {
      e.preventDefault();
      state.peekOriginal = true;
      maskCanvas.style.opacity = "0";
      samCanvas.style.opacity = "0";
    } else if (e.key === "e" || e.key === "E") {
      setTool("eraser", true, false);
    } else if (e.key === "b" || e.key === "B") {
      setTool("brush", true, false);
    } else if (e.key === "a" || e.key === "A") {
      setTool("sam_ai", true, false);
    } else if (e.key === "f" || e.key === "F") {
      setFullscreen(!state.isFullscreen);
    } else if (e.key === "Escape" && state.isFullscreen) {
      setFullscreen(false);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveCurrentMasks();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      state.peekOriginal = false;
      maskCanvas.style.opacity = "1";
      samCanvas.style.opacity = "1";
    }
  });

  init().catch((err) => {
    console.error(err);
    showToast("❌ Error cargando proyecto");
  });
})();
