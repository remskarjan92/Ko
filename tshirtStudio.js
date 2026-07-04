(function() {
  const h = React.createElement;
  const { useEffect, useMemo, useRef, useState } = React;

  const CANVAS_SIZE = 1000;
  const COLOR_LIBRARY = {
    white: { id: "white", name: "White", hex: "#F6F3EE", shadow: "rgba(76,68,58,0.18)" },
    black: { id: "black", name: "Black", hex: "#17181B", shadow: "rgba(0,0,0,0.46)" },
    navy: { id: "navy", name: "Navy", hex: "#263451", shadow: "rgba(12,18,32,0.32)" },
    red: { id: "red", name: "Red", hex: "#A9272E", shadow: "rgba(90,20,24,0.30)" },
    true_royal: { id: "true_royal", name: "True Royal", hex: "#2464A8", shadow: "rgba(19,54,92,0.28)" },
    athletic_heather: { id: "athletic_heather", name: "Athletic Heather", hex: "#B8BCC2", shadow: "rgba(48,54,66,0.22)" },
    asphalt: { id: "asphalt", name: "Asphalt", hex: "#55575B", shadow: "rgba(20,22,26,0.30)" },
    forest: { id: "forest", name: "Forest", hex: "#2D4B3C", shadow: "rgba(13,23,19,0.28)" },
    sand: { id: "sand", name: "Sand", hex: "#D9D0C3", shadow: "rgba(90,74,58,0.22)" },
    sport_gray: { id: "sport_gray", name: "Sport Gray", hex: "#C3C5C8", shadow: "rgba(58,62,70,0.22)" },
    dark_heather: { id: "dark_heather", name: "Dark Heather", hex: "#4E5157", shadow: "rgba(22,24,29,0.34)" },
    military_green: { id: "military_green", name: "Military Green", hex: "#5B6249", shadow: "rgba(34,40,26,0.28)" },
    natural: { id: "natural", name: "Natural", hex: "#EEE5D4", shadow: "rgba(90,78,58,0.18)" },
    ivory: { id: "ivory", name: "Ivory", hex: "#F0E6D2", shadow: "rgba(90,78,58,0.18)" },
    pepper: { id: "pepper", name: "Pepper", hex: "#5C5A55", shadow: "rgba(26,24,21,0.32)" },
    crimson: { id: "crimson", name: "Crimson", hex: "#7F1D2A", shadow: "rgba(64,12,22,0.32)" },
    yam: { id: "yam", name: "Yam", hex: "#C56B32", shadow: "rgba(88,42,18,0.28)" }
  };
  const colorRefs = ids => ids.map(id => COLOR_LIBRARY[id]).filter(Boolean);
  const PRODUCTS = [{
    id: "bella_canvas_3001",
    brand: "Bella+Canvas",
    model: "3001",
    displayName: "Bella+Canvas 3001",
    name: "Bella+Canvas 3001",
    category: "Unisex Jersey Tee",
    fit: "Retail fit, side-seamed",
    availableColors: colorRefs(["white", "black", "athletic_heather", "asphalt", "navy", "red", "true_royal", "forest"]),
    frontMockup: { type: "vector", template: "retail_tee_front" },
    backMockup: { type: "vector", template: "retail_tee_back" },
    printArea: { x: 0.32, y: 0.245, width: 0.36, height: 0.44 },
    recommendedDesignWidth: 4500,
    recommendedDesignHeight: 5400,
    dpi: 300,
    exportSize: 2000,
    templateKey: "bella"
  }, {
    id: "gildan_5000",
    brand: "Gildan",
    model: "5000",
    displayName: "Gildan 5000",
    name: "Gildan 5000",
    category: "Unisex Heavy Cotton Tee",
    fit: "Classic fit, tubular body",
    availableColors: colorRefs(["white", "black", "sport_gray", "dark_heather", "navy", "red", "forest", "military_green", "sand"]),
    frontMockup: { type: "vector", template: "heavy_cotton_front" },
    backMockup: { type: "vector", template: "heavy_cotton_back" },
    printArea: { x: 0.30, y: 0.255, width: 0.40, height: 0.43 },
    recommendedDesignWidth: 4500,
    recommendedDesignHeight: 5100,
    dpi: 300,
    exportSize: 2000,
    templateKey: "gildan"
  }, {
    id: "comfort_colors_1717",
    brand: "Comfort Colors",
    model: "1717",
    displayName: "Comfort Colors 1717",
    name: "Comfort Colors 1717",
    category: "Garment-Dyed Heavyweight Tee",
    fit: "Relaxed garment-dyed fit",
    availableColors: colorRefs(["ivory", "pepper", "crimson", "yam", "black", "white", "navy", "forest"]),
    frontMockup: { type: "vector", template: "garment_dyed_front" },
    backMockup: { type: "vector", template: "garment_dyed_back" },
    printArea: { x: 0.29, y: 0.27, width: 0.42, height: 0.39 },
    recommendedDesignWidth: 4500,
    recommendedDesignHeight: 4800,
    dpi: 300,
    exportSize: 2000,
    templateKey: "comfort"
  }];
  const MODELS = PRODUCTS;
  const COLORS = Object.values(COLOR_LIBRARY);
  const VIEWS = [{
    id: "front",
    name: "Front"
  }, {
    id: "back",
    name: "Back"
  }];
  const LOCAL_PRESETS_KEY = "ko_tshirt_studio_presets_v1";
  const PRODUCT_FAVORITES_KEY = "ko_tshirt_studio_favorite_products_v1";
  const SNAP_CENTER_THRESHOLD = 8;
  const SNAP_GUIDE_DURATION = 650;

  function toCanvasPrintArea(printArea) {
    return {
      x: Math.round(printArea.x * CANVAS_SIZE),
      y: Math.round(printArea.y * CANVAS_SIZE),
      width: Math.round(printArea.width * CANVAS_SIZE),
      height: Math.round(printArea.height * CANVAS_SIZE)
    };
  }

  function productWithCanvasArea(product) {
    return {
      ...product,
      printArea: toCanvasPrintArea(product.printArea),
      normalizedPrintArea: product.printArea
    };
  }

  function findProduct(productId) {
    return PRODUCTS.find(item => item.id === productId) || PRODUCTS[0];
  }

  function findColor(product, colorId) {
    return product.availableColors.find(item => item.id === colorId) || product.availableColors[0] || COLORS[0];
  }

  function svgDataUrl(modelId, colorId, viewId = "front", transparent = false) {
    const product = findProduct(modelId);
    const color = findColor(product, colorId);
    const shapes = {
      bella: {
        body: "M281 208 L376 152 L452 183 Q500 154 548 183 L624 152 L719 208 L677 318 L653 798 Q651 824 625 824 L375 824 Q349 824 347 798 L323 318 Z",
        collar: "M430 195 Q500 142 570 195 Q547 228 500 234 Q453 228 430 195 Z",
        sleeveLeft: "M279 208 L216 268 L252 364 L324 317 Z",
        sleeveRight: "M721 208 L784 268 L748 364 L676 317 Z"
      },
      gildan: {
        body: "M248 214 L362 152 L448 180 Q500 156 552 180 L638 152 L752 214 L704 350 L682 790 Q680 824 648 824 L352 824 Q320 824 318 790 L296 350 Z",
        collar: "M421 196 Q500 144 579 196 Q552 231 500 238 Q448 231 421 196 Z",
        sleeveLeft: "M248 214 L186 288 L236 392 L300 352 Z",
        sleeveRight: "M752 214 L814 288 L764 392 L700 352 Z"
      },
      comfort: {
        body: "M315 206 L396 156 L458 184 Q500 162 542 184 L604 156 L685 206 L652 316 L633 794 Q630 824 604 824 L396 824 Q370 824 367 794 L348 316 Z",
        collar: "M436 196 Q500 150 564 196 Q543 227 500 233 Q457 227 436 196 Z",
        sleeveLeft: "M315 206 L256 262 L286 354 L348 318 Z",
        sleeveRight: "M685 206 L744 262 L714 354 L652 318 Z"
      }
    };
    const shape = shapes[product.templateKey] || shapes.bella;
    const isBack = viewId === "back";
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
	      <defs>
	        <linearGradient id="shirtShade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.22)"/>
          <stop offset="42%" stop-color="rgba(255,255,255,0.06)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.14)"/>
        </linearGradient>
      </defs>
	      ${transparent ? "" : '<rect width="1000" height="1000" fill="#F4EEE5"/>'}
      <ellipse cx="500" cy="852" rx="230" ry="34" fill="${color.shadow}" opacity="0.38"/>
      <path d="${shape.body}" fill="${color.hex}" stroke="rgba(35,35,38,0.18)" stroke-width="8" stroke-linejoin="round"/>
	      <path d="${shape.sleeveLeft}" fill="${color.hex}" stroke="rgba(35,35,38,0.16)" stroke-width="8" stroke-linejoin="round"/>
	      <path d="${shape.sleeveRight}" fill="${color.hex}" stroke="rgba(35,35,38,0.16)" stroke-width="8" stroke-linejoin="round"/>
	      <path d="${shape.body}" fill="url(#shirtShade)" opacity="0.42"/>
	      <path d="${shape.collar}" fill="${isBack ? "rgba(255,255,255,0.10)" : "rgba(22,24,28,0.82)"}"/>
	      ${isBack ? '<path d="M392 196 Q500 258 608 196" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="8" stroke-linecap="round"/>' : ""}
	      <path d="M500 236 L500 808" stroke="rgba(255,255,255,0.08)" stroke-width="2" stroke-dasharray="7 12"/>
	      <text x="500" y="912" text-anchor="middle" font-family="Arial" font-size="18" fill="rgba(30,30,32,0.34)">${product.brand} ${product.model} ${isBack ? "Back" : "Front"}</text>
	    </svg>`)}`;
  }

  function loadFabricImage(url) {
    return new Promise((resolve, reject) => {
      try {
        window.fabric.Image.fromURL(url, img => img ? resolve(img) : reject(new Error("image_load_failed")), { crossOrigin: "anonymous" });
      } catch (error) {
        reject(error);
      }
    });
  }

  function tokenButton(touchButton, border, bg, color, extra) {
    return touchButton ? touchButton(border, bg, color, extra) : {
      minHeight: 38,
      padding: "10px 12px",
      borderRadius: 12,
      border,
      background: bg,
      color
    };
  }

  function hashAssetId(value) {
    const text = String(value || "");
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 33 ^ text.charCodeAt(i)) >>> 0;
    }
    return `design-${hash.toString(16)}`;
  }

  function TShirtStudioSection({
    userSession,
    uploadedDesignUrl,
    generatedDesignChoices = [],
    requestJson,
    fileToDataUrl,
    slugifyName,
    touchButton
  }) {
    const [shirtModelId, setShirtModelId] = useState(MODELS[0].id);
    const [shirtColorId, setShirtColorId] = useState(COLORS[0].id);
    const [shirtView, setShirtView] = useState(VIEWS[0].id);
    const [productSearch, setProductSearch] = useState("");
    const [brandFilter, setBrandFilter] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [favoriteProducts, setFavoriteProducts] = useState([]);
    const [selectedDesignId, setSelectedDesignId] = useState("");
    const [localDesign, setLocalDesign] = useState(null);
    const [placements, setPlacements] = useState([]);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [saveBusy, setSaveBusy] = useState(false);
    const [exportBusy, setExportBusy] = useState("");
    const [loadBusy, setLoadBusy] = useState(false);
    const [placementSnapshot, setPlacementSnapshot] = useState(null);
    const [printAreaWarning, setPrintAreaWarning] = useState("");
    const [applyAllColors, setApplyAllColors] = useState(true);
    const [applyAllMockups, setApplyAllMockups] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [localPresets, setLocalPresets] = useState([]);
    const [layers, setLayers] = useState([]);
    const [activeLayerId, setActiveLayerId] = useState("");
    const [textLayerValue, setTextLayerValue] = useState("New text");
    const canvasRef = useRef(null);
    const fabricCanvasRef = useRef(null);
    const designObjectRef = useRef(null);
    const layerObjectsRef = useRef(new Map());
    const pendingPlacementRef = useRef(null);
    const fileInputRef = useRef(null);
    const placementLoadTokenRef = useRef("");
    const productViewRef = useRef("");
    const snapGuideObjectsRef = useRef([]);
    const snapGuideTimerRef = useRef(null);

    const designChoices = useMemo(() => {
      const deduped = [];
      const seen = new Set();
      const push = choice => {
        if (!choice?.url || seen.has(choice.url)) return;
        seen.add(choice.url);
        deduped.push(choice);
      };
      if (uploadedDesignUrl) push({ id: "uploaded-design", assetId: hashAssetId(`upload:${uploadedDesignUrl}`), label: "Uploaded design", url: uploadedDesignUrl, kind: "upload" });
      generatedDesignChoices.forEach((choice, index) => push({
        id: choice.id || `generated-${index}`,
        assetId: choice.assetId || hashAssetId(`${choice.id || index}:${choice.url || ""}`),
        label: choice.label || `Generated asset ${index + 1}`,
        url: choice.url,
        kind: choice.kind || "generated"
      }));
      if (localDesign?.url) push(localDesign);
      return deduped;
    }, [uploadedDesignUrl, generatedDesignChoices, localDesign]);

    const selectedProduct = findProduct(shirtModelId);
    const model = productWithCanvasArea(selectedProduct);
    const color = findColor(selectedProduct, shirtColorId);
    const selectedDesign = designChoices.find(item => item.id === selectedDesignId) || designChoices[0] || null;
    const selectedDesignAssetId = selectedDesign?.assetId || null;
    const brands = Array.from(new Set(PRODUCTS.map(item => item.brand))).sort();
    const categories = Array.from(new Set(PRODUCTS.map(item => item.category))).sort();
    const filteredProducts = PRODUCTS.filter(item => {
      const query = productSearch.trim().toLowerCase();
      const matchesSearch = !query || [item.brand, item.model, item.displayName, item.category].join(" ").toLowerCase().includes(query);
      const matchesBrand = !brandFilter || item.brand === brandFilter;
      const matchesCategory = !categoryFilter || item.category === categoryFilter;
      return matchesSearch && matchesBrand && matchesCategory;
    }).sort((a, b) => {
      const favDelta = Number(favoriteProducts.includes(b.id)) - Number(favoriteProducts.includes(a.id));
      return favDelta || a.displayName.localeCompare(b.displayName);
    });

    function designBoundsStatus(obj) {
      if (!obj) return { inside: true, message: "" };
      obj.setCoords();
      const area = model.printArea;
      const bounds = obj.getBoundingRect(true, true);
      const inside = bounds.left >= area.x
        && bounds.top >= area.y
        && bounds.left + bounds.width <= area.x + area.width
        && bounds.top + bounds.height <= area.y + area.height;
      return {
        inside,
        message: inside ? "" : "Warning: design is outside the safe print area."
      };
    }

    function clearSnapGuides() {
      if (snapGuideTimerRef.current) {
        window.clearTimeout(snapGuideTimerRef.current);
        snapGuideTimerRef.current = null;
      }
      const canvas = fabricCanvasRef.current;
      if (canvas && snapGuideObjectsRef.current.length) {
        snapGuideObjectsRef.current.forEach(obj => canvas.remove(obj));
        canvas.requestRenderAll();
      }
      snapGuideObjectsRef.current = [];
    }

    function showSnapGuides({ vertical = false, horizontal = false } = {}) {
      if (!fabricCanvasRef.current || !window.fabric) return;
      clearSnapGuides();
      const canvas = fabricCanvasRef.current;
      const area = model.printArea;
      const guides = [];
      if (vertical) {
        guides.push(new window.fabric.Line([
          area.x + area.width / 2,
          area.y,
          area.x + area.width / 2,
          area.y + area.height
        ], {
          stroke: "rgba(255,220,100,0.95)",
          strokeWidth: 2,
          strokeDashArray: [8, 8],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          koGuide: true
        }));
      }
      if (horizontal) {
        guides.push(new window.fabric.Line([
          area.x,
          area.y + area.height / 2,
          area.x + area.width,
          area.y + area.height / 2
        ], {
          stroke: "rgba(255,220,100,0.95)",
          strokeWidth: 2,
          strokeDashArray: [8, 8],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          koGuide: true
        }));
      }
      guides.forEach(line => {
        canvas.add(line);
        line.bringToFront();
      });
      snapGuideObjectsRef.current = guides;
      canvas.requestRenderAll();
      if (guides.length) {
        snapGuideTimerRef.current = window.setTimeout(() => {
          clearSnapGuides();
        }, SNAP_GUIDE_DURATION);
      }
    }

    function applySnapAlignment(obj, alignment = {}) {
      if (!obj) return { snappedX: false, snappedY: false };
      const area = model.printArea;
      obj.setCoords();
      const bounds = obj.getBoundingRect(true, true);
      const currentCenterX = bounds.left + bounds.width / 2;
      const currentCenterY = bounds.top + bounds.height / 2;
      const next = {};
      let snappedX = false;
      let snappedY = false;
      if (alignment.horizontal) {
        const targetCenterX = alignment.horizontal === "left"
          ? area.x + bounds.width / 2
          : alignment.horizontal === "right"
            ? area.x + area.width - bounds.width / 2
            : area.x + area.width / 2;
        next.left = (obj.left || 0) + (targetCenterX - currentCenterX);
        snappedX = true;
      }
      if (alignment.vertical) {
        const targetCenterY = alignment.vertical === "top"
          ? area.y + bounds.height / 2
          : alignment.vertical === "bottom"
            ? area.y + area.height - bounds.height / 2
            : area.y + area.height / 2;
        next.top = (obj.top || 0) + (targetCenterY - currentCenterY);
        snappedY = true;
      }
      if (snappedX || snappedY) {
        obj.set(next);
        obj.setCoords();
      }
      if (snappedX || snappedY) {
        showSnapGuides({ vertical: snappedX, horizontal: snappedY });
      } else {
        clearSnapGuides();
      }
      return { snappedX, snappedY };
    }

    function snapObjectToPrintCenter(obj) {
      return applySnapAlignment(obj, { horizontal: "center", vertical: "center" });
    }

    function maybeSnapObjectDuringDrag(obj) {
      if (!obj) return;
      obj.setCoords();
      const area = model.printArea;
      const bounds = obj.getBoundingRect(true, true);
      const currentCenterX = bounds.left + bounds.width / 2;
      const currentCenterY = bounds.top + bounds.height / 2;
      const snapHorizontal = Math.abs(currentCenterX - (area.x + area.width / 2)) <= SNAP_CENTER_THRESHOLD;
      const snapVertical = Math.abs(currentCenterY - (area.y + area.height / 2)) <= SNAP_CENTER_THRESHOLD;
      if (!snapHorizontal && !snapVertical) {
        clearSnapGuides();
        return;
      }
      const next = {};
      if (snapHorizontal) {
        next.left = (obj.left || 0) + ((area.x + area.width / 2) - currentCenterX);
      }
      if (snapVertical) {
        next.top = (obj.top || 0) + ((area.y + area.height / 2) - currentCenterY);
      }
      obj.set(next);
      obj.setCoords();
      showSnapGuides({ vertical: snapHorizontal, horizontal: snapVertical });
    }

    function getActiveLayerObject() {
      return layerObjectsRef.current.get(activeLayerId) || designObjectRef.current || null;
    }

    function applyLayerInteractivity(obj, layer) {
      const locked = !!layer?.locked;
      obj.set({
        selectable: !locked,
        evented: !locked,
        lockMovementX: locked,
        lockMovementY: locked,
        lockScalingX: locked,
        lockScalingY: locked,
        lockRotation: locked,
        opacity: layer?.opacity ?? obj.opacity ?? 1
      });
      obj.setCoords();
    }

    function selectLayer(layerId) {
      const obj = layerObjectsRef.current.get(layerId);
      setActiveLayerId(layerId);
      designObjectRef.current = obj || null;
      if (fabricCanvasRef.current && obj) {
        fabricCanvasRef.current.setActiveObject(obj);
        fabricCanvasRef.current.renderAll();
      }
      syncPlacement(obj || null);
    }

    function syncPlacement() {
      const obj = arguments.length ? arguments[0] : getActiveLayerObject();
      if (!obj) {
        setPlacementSnapshot(null);
        setPrintAreaWarning("");
        return;
      }
      const status = designBoundsStatus(obj);
      setPrintAreaWarning(status.message);
      setPlacementSnapshot({
        layerId: obj.koLayerId || activeLayerId || null,
        x: Number((obj.left || 0).toFixed(2)),
        y: Number((obj.top || 0).toFixed(2)),
        scale: Number((obj.scaleX || 1).toFixed(4)),
        rotation: Number((obj.angle || 0).toFixed(2)),
        width: Number(((obj.width || 0) * (obj.scaleX || 1)).toFixed(2)),
        height: Number(((obj.height || 0) * (obj.scaleY || 1)).toFixed(2)),
        insidePrintArea: status.inside
      });
    }

    function clampObject(obj) {
      const area = model.printArea;
      const scaleLimit = Math.max(0.08, Math.min((area.width * 0.95) / Math.max(obj.width || 1, 1), (area.height * 0.95) / Math.max(obj.height || 1, 1)));
      if (obj.scaleX > scaleLimit) obj.scaleX = scaleLimit;
      obj.scaleY = obj.scaleX;
      obj.setCoords();
    }

    function fitObjectInsidePrintArea(obj) {
      const area = model.printArea;
      const scaleLimit = Math.max(0.08, Math.min((area.width * 0.9) / Math.max(obj.width || 1, 1), (area.height * 0.9) / Math.max(obj.height || 1, 1)));
      if ((obj.scaleX || 1) > scaleLimit) {
        obj.set({ scaleX: scaleLimit, scaleY: scaleLimit });
      } else {
        obj.set({ scaleY: obj.scaleX || 1 });
      }
      obj.setCoords();
      const bounds = obj.getBoundingRect(true, true);
      let nextLeft = obj.left || 0;
      let nextTop = obj.top || 0;
      if (bounds.left < area.x) nextLeft += area.x - bounds.left;
      if (bounds.top < area.y) nextTop += area.y - bounds.top;
      if (bounds.left + bounds.width > area.x + area.width) nextLeft -= bounds.left + bounds.width - (area.x + area.width);
      if (bounds.top + bounds.height > area.y + area.height) nextTop -= bounds.top + bounds.height - (area.y + area.height);
      obj.set({ left: nextLeft, top: nextTop });
      obj.setCoords();
    }

    async function drawBase() {
      if (!fabricCanvasRef.current || !window.fabric) return;
      const canvas = fabricCanvasRef.current;
      const currentProductView = `${shirtModelId}:${shirtView}`;
      const productViewChanged = !!productViewRef.current && productViewRef.current !== currentProductView;
      clearSnapGuides();
      canvas.clear();
      const bg = await loadFabricImage(svgDataUrl(shirtModelId, shirtColorId, shirtView));
      bg.set({ left: 0, top: 0, selectable: false, evented: false, originX: "left", originY: "top" });
      bg.scaleToWidth(CANVAS_SIZE);
      bg.scaleToHeight(CANVAS_SIZE);
      canvas.setBackgroundImage(bg, canvas.renderAll.bind(canvas));
	      const safeRect = new window.fabric.Rect({
	        left: model.printArea.x,
        top: model.printArea.y,
        width: model.printArea.width,
        height: model.printArea.height,
        fill: "rgba(255,220,100,0.06)",
        stroke: "rgba(255,220,100,0.72)",
        strokeWidth: 2,
        strokeDashArray: [10, 8],
        selectable: false,
	        evented: false,
	        rx: 18,
	        ry: 18,
	        koGuide: true
	      });
      const label = new window.fabric.Text("SAFE PRINT AREA", {
        left: model.printArea.x + 12,
        top: model.printArea.y - 24,
        fontSize: 14,
	        fontFamily: "DM Mono",
	        fill: "rgba(255,220,100,0.88)",
	        selectable: false,
	        evented: false,
	        koGuide: true
	      });
      canvas.add(safeRect);
      canvas.add(label);
      const layerObjects = Array.from(layerObjectsRef.current.values());
      layerObjects.forEach(obj => {
        canvas.add(obj);
        if (productViewChanged) {
          fitObjectInsidePrintArea(obj);
        } else {
          clampObject(obj);
        }
      });
      [...layers].reverse().forEach(layer => {
        const obj = layerObjectsRef.current.get(layer.id);
        if (!obj) return;
        applyLayerInteractivity(obj, layer);
        obj.bringToFront();
      });
      if (activeLayerId && layerObjectsRef.current.has(activeLayerId)) {
        designObjectRef.current = layerObjectsRef.current.get(activeLayerId);
        canvas.setActiveObject(designObjectRef.current);
        syncPlacement(designObjectRef.current);
      } else if (layerObjects[0]) {
        designObjectRef.current = layerObjects[0];
        setActiveLayerId(layerObjects[0].koLayerId);
        canvas.setActiveObject(layerObjects[0]);
        syncPlacement(layerObjects[0]);
      } else {
        syncPlacement(null);
      }
      productViewRef.current = currentProductView;
      canvas.renderAll();
    }

    function addLayerRecord(layer, obj) {
      obj.koLayerId = layer.id;
      layerObjectsRef.current.set(layer.id, obj);
      setLayers(prev => [layer, ...prev]);
      setActiveLayerId(layer.id);
      designObjectRef.current = obj;
      if (fabricCanvasRef.current) {
        fabricCanvasRef.current.add(obj);
        fabricCanvasRef.current.setActiveObject(obj);
        obj.bringToFront();
        fabricCanvasRef.current.renderAll();
      }
      syncPlacement(obj);
    }

    function serializeLayer(layer) {
      const obj = layerObjectsRef.current.get(layer.id);
      if (!obj) return null;
      return {
        ...layer,
        x: Number((obj.left || 0).toFixed(2)),
        y: Number((obj.top || 0).toFixed(2)),
        scale: Number((obj.scaleX || 1).toFixed(4)),
        rotation: Number((obj.angle || 0).toFixed(2)),
        width: Number(((obj.width || 0) * (obj.scaleX || 1)).toFixed(2)),
        height: Number(((obj.height || 0) * (obj.scaleY || 1)).toFixed(2)),
        text: layer.type === "text" ? obj.text : layer.text || "",
        opacity: Number((obj.opacity ?? layer.opacity ?? 1).toFixed(2))
      };
    }

    async function placeDesign(savedPlacement, options = {}) {
      if (!fabricCanvasRef.current || !selectedDesign?.url || !window.fabric) return;
      const canvas = fabricCanvasRef.current;
      const img = await loadFabricImage(selectedDesign.url);
      if (options.replaceAll) {
        layerObjectsRef.current.forEach(obj => canvas.remove(obj));
        layerObjectsRef.current.clear();
        setLayers([]);
      }
      const area = model.printArea;
      const baseScale = Math.max(0.12, Math.min((area.width * 0.62) / Math.max(img.width || 1, 1), (area.height * 0.62) / Math.max(img.height || 1, 1)));
      const layer = {
        id: `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: savedPlacement?.design?.sourceName || selectedDesign.label || "Design layer",
        type: "image",
        sourceUrl: selectedDesign.url,
        locked: false,
        opacity: savedPlacement?.design?.opacity ?? 1
      };
      img.set({
        originX: "center",
        originY: "center",
        left: savedPlacement?.design?.x || area.x + area.width / 2,
        top: savedPlacement?.design?.y || area.y + area.height / 2,
        angle: savedPlacement?.design?.rotation || 0,
        scaleX: savedPlacement?.design?.scale || baseScale,
        scaleY: savedPlacement?.design?.scale || baseScale,
        padding: 6,
        transparentCorners: false,
        cornerStyle: "circle",
        cornerColor: "#FFDC64",
        cornerStrokeColor: "#141416",
        borderColor: "#FFDC64",
        lockUniScaling: true,
        hasControls: true,
        hasBorders: true,
        selectable: true,
        evented: true,
        hoverCursor: "move",
        moveCursor: "move",
        opacity: layer.opacity
      });
      clampObject(img);
      addLayerRecord(layer, img);
    }

    function currentPayload() {
      if (!placementSnapshot) return null;
      return {
        designAssetId: selectedDesignAssetId,
        productType: "tshirt",
        shirtModel: shirtModelId,
        color: shirtColorId,
        view: shirtView,
        product: {
          id: selectedProduct.id,
          brand: selectedProduct.brand,
          model: selectedProduct.model,
          displayName: selectedProduct.displayName,
          category: selectedProduct.category
        },
        design: {
          ...placementSnapshot,
          sourceName: selectedDesign?.label || null
        },
        layers: layers.map(serializeLayer).filter(Boolean),
        activeLayerId,
        printArea: model.printArea,
        normalizedPrintArea: selectedProduct.printArea,
        recommendedDesignWidth: selectedProduct.recommendedDesignWidth,
        recommendedDesignHeight: selectedProduct.recommendedDesignHeight,
        dpi: selectedProduct.dpi,
        exportSize: selectedProduct.exportSize,
        applyAllColors,
        applyAllMockups,
        createdAt: new Date().toISOString(),
        userId: userSession?.userId || userSession?.id || null
      };
    }

    useEffect(() => {
      if (!canvasRef.current || !window.fabric || fabricCanvasRef.current) return;
      const canvas = new window.fabric.Canvas(canvasRef.current, {
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        selection: false,
        preserveObjectStacking: true
      });
	      const sync = event => {
	        if (!event?.target || event.target.koGuide) return;
	        if (event.target.koLayerId) {
	          designObjectRef.current = event.target;
	          setActiveLayerId(event.target.koLayerId);
	        }
	        if (event?.transform?.action === "drag") {
	          maybeSnapObjectDuringDrag(event.target);
	        } else if (event?.type === "modified") {
	          clearSnapGuides();
	        }
	        clampObject(event.target);
	        syncPlacement(event.target);
	        canvas.renderAll();
	      };
	      canvas.on("object:moving", sync);
	      canvas.on("object:scaling", sync);
	      canvas.on("object:rotating", sync);
	      canvas.on("object:modified", sync);
	      canvas.on("selection:created", event => {
	        if (event.selected?.[0]?.koLayerId) selectLayer(event.selected[0].koLayerId);
	      });
	      canvas.on("selection:updated", event => {
	        if (event.selected?.[0]?.koLayerId) selectLayer(event.selected[0].koLayerId);
	      });
      fabricCanvasRef.current = canvas;
      drawBase().catch(() => setError("The shirt preview could not be rendered."));
      return () => {
        clearSnapGuides();
        canvas.dispose();
        fabricCanvasRef.current = null;
        designObjectRef.current = null;
      };
    }, []);

    useEffect(() => {
      const handleKeyDown = event => {
        if (!activeLayerId || editorDisabled) return;
        const target = event.target;
        const tagName = target?.tagName ? String(target.tagName).toLowerCase() : "";
        if (target?.isContentEditable || ["input", "textarea", "select"].includes(tagName)) return;
        const step = event.shiftKey ? 10 : 1;
        let handled = true;
        switch (event.key) {
          case "ArrowLeft":
            moveDesign(-step, 0);
            break;
          case "ArrowRight":
            moveDesign(step, 0);
            break;
          case "ArrowUp":
            moveDesign(0, -step);
            break;
          case "ArrowDown":
            moveDesign(0, step);
            break;
          default:
            handled = false;
            break;
        }
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeLayerId, editorDisabled]);

    useEffect(() => {
      if (!designChoices.length) {
        setSelectedDesignId("");
        return;
      }
      if (!selectedDesignId || !designChoices.some(choice => choice.id === selectedDesignId)) {
        setSelectedDesignId(designChoices[0].id);
      }
    }, [designChoices, selectedDesignId]);

    useEffect(() => {
      if (selectedProduct.availableColors.some(item => item.id === shirtColorId)) return;
      setShirtColorId(selectedProduct.availableColors[0]?.id || COLORS[0].id);
    }, [selectedProduct.id, shirtColorId]);

    useEffect(() => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(PRODUCT_FAVORITES_KEY) || "[]");
        setFavoriteProducts(Array.isArray(stored) ? stored : []);
      } catch {
        setFavoriteProducts([]);
      }
    }, []);

    function toggleFavoriteProduct(productId) {
      const next = favoriteProducts.includes(productId)
        ? favoriteProducts.filter(id => id !== productId)
        : [productId, ...favoriteProducts];
      setFavoriteProducts(next);
      try {
        window.localStorage.setItem(PRODUCT_FAVORITES_KEY, JSON.stringify(next));
      } catch {
        setError("Favorite product was updated for this session, but local storage is unavailable.");
      }
    }

    useEffect(() => {
      if (!fabricCanvasRef.current) return;
	      drawBase().then(() => {
	        if (pendingPlacementRef.current) {
	          const saved = pendingPlacementRef.current;
	          pendingPlacementRef.current = null;
	          if (Array.isArray(saved.layers) && saved.layers.length) {
	            return restoreLayersFromPlacement(saved);
	          }
	          if (!selectedDesign?.url) return null;
	          return placeDesign(saved, { replaceAll: true });
	        }
	      }).catch(() => setError("The shirt preview could not be rendered."));
    }, [shirtModelId, shirtColorId, shirtView]);

    useEffect(() => {
      if (!fabricCanvasRef.current) return;
      if (!selectedDesign?.url) {
        if (designObjectRef.current) {
          fabricCanvasRef.current.remove(designObjectRef.current);
          designObjectRef.current = null;
          syncPlacement();
          fabricCanvasRef.current.renderAll();
        }
        return;
      }
      placeDesign().catch(() => setError("The selected design could not be loaded."));
    }, [selectedDesignId]);

    useEffect(() => {
      let active = true;
      setLoadBusy(true);
      requestJson("/api/mockup-placements", null, "GET").then(({ res, data }) => {
        if (!active) return;
        if (res.ok) setPlacements(Array.isArray(data?.placements) ? data.placements : []);
      }).catch(() => {}).finally(() => {
        if (active) setLoadBusy(false);
      });
      return () => {
        active = false;
      };
    }, [requestJson]);

    useEffect(() => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(LOCAL_PRESETS_KEY) || "[]");
        setLocalPresets(Array.isArray(stored) ? stored : []);
      } catch {
        setLocalPresets([]);
      }
    }, []);

    function persistLocalPresets(nextPresets) {
      setLocalPresets(nextPresets);
      try {
        window.localStorage.setItem(LOCAL_PRESETS_KEY, JSON.stringify(nextPresets));
      } catch {
        setError("Preset was saved for this session, but local storage is unavailable.");
      }
    }

    async function handleLocalUpload(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!String(file.type || "").startsWith("image/")) {
        setError("Choose an image file for the studio design.");
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      const source = {
        id: `local-design-${Date.now()}`,
        assetId: hashAssetId(`local:${file.name || "studio-upload"}:${dataUrl}`),
        label: file.name || "Studio upload",
        url: dataUrl,
        kind: "local-upload"
      };
      setLocalDesign(source);
      setSelectedDesignId(source.id);
      setNotice("Local design added to the studio.");
      setError("");
    }

    async function savePlacement() {
      const payload = currentPayload();
      if (!payload) {
        setError("Place a design on the shirt before saving.");
        return;
      }
      setSaveBusy(true);
      setError("");
      try {
        const { res, data } = await requestJson("/api/mockup-placements", payload);
        if (!res.ok) throw new Error(data?.error || "Placement save failed");
        const placement = data?.placement || payload;
        setPlacements(prev => [placement, ...prev].slice(0, 20));
        setNotice("This placement will be reused for this design.");
      } catch (err) {
        setError(err.message || "Placement save failed.");
      } finally {
        setSaveBusy(false);
      }
    }

    async function savePlacementPreset(options = {}) {
      const payload = currentPayload();
      if (!payload) {
        setError("Place a design on the shirt before saving.");
        return;
      }
      const nextPayload = {
        ...payload,
        applyAllColors: options.applyAllColors ?? applyAllColors,
        applyAllMockups: options.applyAllMockups ?? applyAllMockups
      };
      setSaveBusy(true);
      setError("");
      try {
        const { res, data } = await requestJson("/api/mockup-placements", nextPayload);
        if (!res.ok) throw new Error(data?.error || "Placement save failed");
        const placement = data?.placement || nextPayload;
        setPlacements(prev => [placement, ...prev].slice(0, 20));
        setApplyAllMockups(!!nextPayload.applyAllMockups);
        setNotice(nextPayload.applyAllMockups ? "This placement will be reused for this design across all mockups." : "This placement will be reused for this design.");
      } catch (err) {
        setError(err.message || "Placement save failed.");
      } finally {
        setSaveBusy(false);
      }
    }

    function resetPlacement() {
      const obj = getActiveLayerObject();
      if (obj && fabricCanvasRef.current) {
        const area = model.printArea;
        const baseScale = Math.max(0.12, Math.min((area.width * 0.62) / Math.max(obj.width || 1, 1), (area.height * 0.62) / Math.max(obj.height || 1, 1)));
        obj.set({
          left: area.x + area.width / 2,
          top: area.y + area.height / 2,
          angle: 0,
          scaleX: baseScale,
          scaleY: baseScale
        });
        clampObject(obj);
        fabricCanvasRef.current.setActiveObject(obj);
        syncPlacement(obj);
        fabricCanvasRef.current.renderAll();
        return;
      }
      if (selectedDesign?.url) {
        placeDesign().catch(() => setError("The selected design could not be loaded."));
      } else {
        setError("Select a design first.");
      }
    }

    function updateDesignObject(mutator) {
      const obj = getActiveLayerObject();
      const canvas = fabricCanvasRef.current;
      if (!obj || !canvas) {
        setError("Select or upload a design before editing placement.");
        return;
      }
      mutator(obj);
      clampObject(obj);
      canvas.setActiveObject(obj);
      obj.bringToFront();
      obj.setCoords();
      syncPlacement();
      canvas.renderAll();
      setError("");
    }

    function moveDesign(dx, dy) {
      updateDesignObject(obj => {
        obj.set({
          left: (obj.left || 0) + dx,
          top: (obj.top || 0) + dy
        });
        maybeSnapObjectDuringDrag(obj);
      });
    }

    function alignDesign(horizontal, vertical) {
      updateDesignObject(obj => {
        applySnapAlignment(obj, { horizontal, vertical });
      });
    }

    function snapToCenter() {
      alignDesign("center", "center");
    }

    function setDesignScale(value) {
      const nextScale = Math.max(0.04, Number(value) || 0.04);
      updateDesignObject(obj => obj.set({
        scaleX: nextScale,
        scaleY: nextScale
      }));
    }

    function scaleDesign(multiplier) {
      updateDesignObject(obj => {
        const current = Number(obj.scaleX || 1);
        const nextScale = Math.max(0.04, current * multiplier);
        obj.set({
          scaleX: nextScale,
          scaleY: nextScale
        });
      });
    }

    function setDesignRotation(value) {
      const nextRotation = Number(value);
      updateDesignObject(obj => obj.set({
        angle: Number.isFinite(nextRotation) ? nextRotation : 0
      }));
    }

    function rotateDesign(delta) {
      updateDesignObject(obj => obj.set({
        angle: (Number(obj.angle) || 0) + delta
      }));
    }

    function addTextLayer() {
      if (!fabricCanvasRef.current || !window.fabric) return;
      const area = model.printArea;
      const text = new window.fabric.Textbox(textLayerValue.trim() || "New text", {
        originX: "center",
        originY: "center",
        left: area.x + area.width / 2,
        top: area.y + area.height / 2,
        width: Math.min(area.width * 0.8, 320),
        fontSize: 54,
        fontFamily: "Arial",
        fontWeight: "700",
        fill: "#151515",
        textAlign: "center",
        transparentCorners: false,
        cornerStyle: "circle",
        cornerColor: "#FFDC64",
        cornerStrokeColor: "#141416",
        borderColor: "#FFDC64",
        lockUniScaling: true
      });
      const layer = {
        id: `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: textLayerValue.trim() || "Text layer",
        type: "text",
        text: text.text,
        locked: false,
        opacity: 1
      };
      addLayerRecord(layer, text);
      setNotice("Text layer added.");
      setError("");
    }

    function updateLayerMeta(layerId, patch) {
      setLayers(prev => prev.map(layer => {
        if (layer.id !== layerId) return layer;
        const next = { ...layer, ...patch };
        const obj = layerObjectsRef.current.get(layerId);
        if (obj) {
          if (patch.name && layer.type === "text" && !patch.text) obj.set({ text: patch.name });
          if (patch.text !== undefined && layer.type === "text") obj.set({ text: patch.text });
          if (patch.opacity !== undefined) obj.set({ opacity: patch.opacity });
          applyLayerInteractivity(obj, next);
          if (fabricCanvasRef.current) fabricCanvasRef.current.renderAll();
        }
        return next;
      }));
    }

    function deleteLayer(layerId) {
      const obj = layerObjectsRef.current.get(layerId);
      if (obj && fabricCanvasRef.current) fabricCanvasRef.current.remove(obj);
      layerObjectsRef.current.delete(layerId);
      setLayers(prev => {
        const next = prev.filter(layer => layer.id !== layerId);
        const fallback = next[0]?.id || "";
        setActiveLayerId(fallback);
        designObjectRef.current = fallback ? layerObjectsRef.current.get(fallback) || null : null;
        syncPlacement(designObjectRef.current);
        return next;
      });
      if (fabricCanvasRef.current) fabricCanvasRef.current.renderAll();
    }

    async function duplicateLayer(layerId) {
      const layer = layers.find(item => item.id === layerId);
      const obj = layerObjectsRef.current.get(layerId);
      if (!layer || !obj || !fabricCanvasRef.current) return;
      const cloned = await new Promise(resolve => obj.clone(resolve));
      const nextLayer = {
        ...layer,
        id: `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: `${layer.name} copy`
      };
      cloned.set({
        left: (obj.left || 0) + 18,
        top: (obj.top || 0) + 18
      });
      addLayerRecord(nextLayer, cloned);
    }

    function moveLayer(layerId, direction) {
      setLayers(prev => {
        const index = prev.findIndex(layer => layer.id === layerId);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= prev.length) return prev;
        const next = [...prev];
        const [item] = next.splice(index, 1);
        next.splice(targetIndex, 0, item);
        return next;
      });
      const obj = layerObjectsRef.current.get(layerId);
      if (obj) {
        direction < 0 ? obj.bringForward() : obj.sendBackwards();
        if (fabricCanvasRef.current) fabricCanvasRef.current.renderAll();
      }
    }

    function toggleLayerLock(layerId) {
      const layer = layers.find(item => item.id === layerId);
      if (!layer) return;
      updateLayerMeta(layerId, { locked: !layer.locked });
    }

    async function restoreLayersFromPlacement(placement) {
      if (!fabricCanvasRef.current || !window.fabric || !Array.isArray(placement.layers)) return false;
      const canvas = fabricCanvasRef.current;
      layerObjectsRef.current.forEach(obj => canvas.remove(obj));
      layerObjectsRef.current.clear();
      const restoredLayers = [];
      for (const savedLayer of placement.layers) {
        let obj = null;
        if (savedLayer.type === "image" && savedLayer.sourceUrl) {
          obj = await loadFabricImage(savedLayer.sourceUrl);
        } else if (savedLayer.type === "text") {
          obj = new window.fabric.Textbox(savedLayer.text || savedLayer.name || "Text layer", {
            width: Math.max(120, Number(savedLayer.width || 260)),
            fontSize: 54,
            fontFamily: "Arial",
            fontWeight: "700",
            fill: "#151515",
            textAlign: "center"
          });
        }
        if (!obj) continue;
        const layer = {
          id: savedLayer.id || `layer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: savedLayer.name || (savedLayer.type === "text" ? "Text layer" : "Design layer"),
          type: savedLayer.type || "image",
          sourceUrl: savedLayer.sourceUrl || null,
          text: savedLayer.text || "",
          locked: !!savedLayer.locked,
          opacity: savedLayer.opacity ?? 1
        };
        obj.set({
          originX: "center",
          originY: "center",
          left: savedLayer.x || model.printArea.x + model.printArea.width / 2,
          top: savedLayer.y || model.printArea.y + model.printArea.height / 2,
          angle: savedLayer.rotation || 0,
          scaleX: savedLayer.scale || 1,
          scaleY: savedLayer.scale || 1,
          transparentCorners: false,
          cornerStyle: "circle",
          cornerColor: "#FFDC64",
          cornerStrokeColor: "#141416",
          borderColor: "#FFDC64",
          lockUniScaling: true
        });
        obj.koLayerId = layer.id;
        applyLayerInteractivity(obj, layer);
        layerObjectsRef.current.set(layer.id, obj);
        restoredLayers.push(layer);
        canvas.add(obj);
      }
      setLayers(restoredLayers);
      const nextActiveId = placement.activeLayerId && restoredLayers.some(layer => layer.id === placement.activeLayerId)
        ? placement.activeLayerId
        : restoredLayers[0]?.id || "";
      if (nextActiveId) {
        const activeObj = layerObjectsRef.current.get(nextActiveId);
        designObjectRef.current = activeObj || null;
        setActiveLayerId(nextActiveId);
        if (activeObj) canvas.setActiveObject(activeObj);
        syncPlacement(activeObj || null);
      } else {
        designObjectRef.current = null;
        setActiveLayerId("");
        syncPlacement(null);
      }
      canvas.renderAll();
      return true;
    }

    async function applySavedPlacement(placement) {
      if (!selectedDesign?.url && !Array.isArray(placement.layers)) {
        setError("Choose a design before applying a saved layout.");
        return;
      }
      pendingPlacementRef.current = placement;
      const templateChanges = (placement.shirtModel && placement.shirtModel !== shirtModelId)
        || (placement.color && placement.color !== shirtColorId)
        || (placement.view && placement.view !== shirtView);
      if (placement.shirtModel) setShirtModelId(placement.shirtModel);
      if (placement.color) setShirtColorId(placement.color);
      if (placement.view) setShirtView(placement.view);
      if (Array.isArray(placement.layers) && placement.layers.length) {
        if (!templateChanges) {
          pendingPlacementRef.current = null;
          restoreLayersFromPlacement(placement).catch(() => setError("Saved layers could not be restored."));
        }
      } else if (!placement.shirtModel || placement.shirtModel === shirtModelId) {
        pendingPlacementRef.current = null;
        placeDesign(placement, { replaceAll: true }).catch(() => {});
      }
      setNotice("Saved layout applied.");
      setError("");
    }

    function saveNamedPreset() {
      const payload = currentPayload();
      if (!payload) {
        setError("Place a design on the shirt before saving a preset.");
        return;
      }
      const name = presetName.trim();
      if (!name) {
        setError("Enter a preset name before saving.");
        return;
      }
      const preset = {
        ...payload,
        id: `local-preset-${Date.now()}`,
        name,
        savedAt: new Date().toISOString()
      };
      persistLocalPresets([preset, ...localPresets.filter(item => item.name !== name)].slice(0, 24));
      setPresetName("");
      setNotice(`Preset saved: ${name}`);
      setError("");
    }

    function loadNamedPreset(preset) {
      applySavedPlacement(preset);
      setPresetName(preset.name || "");
    }

    function buildExportFileName(format, transparent = false) {
      const presetPart = presetName.trim() || "preset";
      const transparentPart = transparent ? "transparent" : "mockup";
      return [
        slugifyName(model.name),
        slugifyName(color.name),
        slugifyName(shirtView),
        slugifyName(presetPart),
        transparentPart
      ].filter(Boolean).join("-") + `.${format}`;
    }

    function downloadDataUrl(dataUrl, fileName) {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    function setBackgroundImage(canvas, image) {
      return new Promise(resolve => {
        canvas.setBackgroundImage(image, () => {
          canvas.renderAll();
          resolve();
        });
      });
    }

    async function exportMockup(format, options = {}) {
      if (!fabricCanvasRef.current || !placementSnapshot) {
        setError("Place a design on the shirt before exporting.");
        return;
      }
      if (printAreaWarning && !window.confirm("The design is outside the safe print area. Export anyway?")) {
        setNotice("Export cancelled.");
        return;
      }
      const requestedFormat = format === "jpg" ? "jpeg" : "png";
      const transparent = !!options.transparent && requestedFormat === "png";
      const busyKey = transparent ? "transparent-png" : format;
      const canvas = fabricCanvasRef.current;
      const guideObjects = canvas.getObjects().filter(obj => obj.koGuide);
      const previousBackground = canvas.backgroundImage;
      const previousBackgroundColor = canvas.backgroundColor;
      setExportBusy(busyKey);
      setError("");
      try {
        guideObjects.forEach(obj => obj.set({ visible: false }));
        if (transparent) {
          const transparentBg = await loadFabricImage(svgDataUrl(shirtModelId, shirtColorId, shirtView, true));
          transparentBg.set({ left: 0, top: 0, selectable: false, evented: false, originX: "left", originY: "top" });
          transparentBg.scaleToWidth(CANVAS_SIZE);
          transparentBg.scaleToHeight(CANVAS_SIZE);
          canvas.backgroundColor = "rgba(0,0,0,0)";
          await setBackgroundImage(canvas, transparentBg);
        }
        canvas.discardActiveObject();
        canvas.renderAll();
        const dataUrl = canvas.toDataURL({
          format: requestedFormat,
          multiplier: 2,
          quality: requestedFormat === "jpeg" ? 0.94 : 1
        });
        downloadDataUrl(dataUrl, buildExportFileName(format, transparent));
        setNotice(`${transparent ? "Transparent " : ""}${format.toUpperCase()} exported at 2000×2000 without guide overlays.`);
      } catch (err) {
        setError(err.message || "Mockup export failed.");
      } finally {
        guideObjects.forEach(obj => obj.set({ visible: true }));
        if (transparent) {
          canvas.backgroundColor = previousBackgroundColor;
          await setBackgroundImage(canvas, previousBackground);
        }
        if (designObjectRef.current) canvas.setActiveObject(designObjectRef.current);
        canvas.renderAll();
        setExportBusy("");
      }
    }

    const previewJson = currentPayload() || {
      productType: "tshirt",
      shirtModel: shirtModelId,
      color: shirtColorId,
      view: shirtView
    };
    function renderDesignChoice(choice) {
      return h("button", {
        key: choice.id,
        type: "button",
        onClick: () => setSelectedDesignId(choice.id),
        style: tokenButton(touchButton, choice.id === selectedDesignId ? "1px solid rgba(255,220,100,0.34)" : "1px solid rgba(255,255,255,0.08)", choice.id === selectedDesignId ? "rgba(255,220,100,0.07)" : "rgba(255,255,255,0.03)", choice.id === selectedDesignId ? "var(--accent-gold)" : "var(--text-secondary)", {
          width: "100%",
          minHeight: 60,
          padding: "8px 10px",
          borderRadius: 12,
          justifyContent: "flex-start",
          gap: 10
        })
      }, h("img", {
        src: choice.url,
        alt: choice.label,
        style: { width: 40, height: 40, objectFit: "cover", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", flexShrink: 0 }
      }), h("div", {
        style: { minWidth: 0, textAlign: "left" }
      }, h("div", {
        style: { fontSize: 11, fontWeight: 600, color: choice.id === selectedDesignId ? "var(--accent-gold)" : "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
      }, choice.label), h("div", {
        style: { fontSize: 10, color: "var(--text-tertiary)", marginTop: 3 }
      }, choice.kind === "generated" ? "Generated asset" : choice.kind === "local-upload" ? "Studio upload" : "Main upload")));
    }
    function renderPlacementRow(placement) {
      return h("div", {
        key: placement.id,
        style: { border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "10px 11px" }
      }, h("div", {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }
      }, h("div", null, h("div", {
        style: { fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }
      }, (MODELS.find(item => item.id === placement.shirtModel)?.displayName || placement.shirtModel), " · ", COLORS.find(item => item.id === placement.color)?.name || placement.color), h("div", {
        style: { fontSize: 10, color: "var(--text-tertiary)", marginTop: 3 }
      }, placement.design?.sourceName || "Saved layout")), h("button", {
        type: "button",
        onClick: () => applySavedPlacement(placement),
        style: tokenButton(touchButton, "1px solid rgba(255,220,100,0.24)", "rgba(255,220,100,0.06)", "var(--accent-gold)", {
          minHeight: 32,
          padding: "7px 9px",
          borderRadius: 10,
          fontSize: 10
        })
      }, "Use layout")), h("div", {
        style: { marginTop: 7, fontSize: 10, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace" }
      }, `x ${placement.design?.x || 0} · y ${placement.design?.y || 0} · scale ${placement.design?.scale || 1} · rot ${placement.design?.rotation || 0}`));
    }

    function renderLocalPresetRow(preset) {
      return h("div", {
        key: preset.id || preset.name,
        style: { border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "10px 11px" }
      }, h("div", {
        style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }
      }, h("div", {
        style: { minWidth: 0 }
      }, h("div", {
        style: { fontSize: 12, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
      }, preset.name || "Untitled preset"), h("div", {
        style: { fontSize: 10, color: "var(--text-tertiary)", marginTop: 3 }
      }, `${MODELS.find(item => item.id === preset.shirtModel)?.displayName || preset.shirtModel || "Any model"} · ${COLORS.find(item => item.id === preset.color)?.name || preset.color || "Any color"} · ${preset.view || "front"}`)), h("button", {
        type: "button",
        onClick: () => loadNamedPreset(preset),
        style: tokenButton(touchButton, "1px solid rgba(255,220,100,0.24)", "rgba(255,220,100,0.06)", "var(--accent-gold)", {
          minHeight: 32,
          padding: "7px 9px",
          borderRadius: 10,
          fontSize: 10
        })
      }, "Load")), h("div", {
        style: { marginTop: 7, fontSize: 10, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace" }
      }, `x ${preset.design?.x || 0} · y ${preset.design?.y || 0} · scale ${preset.design?.scale || 1} · rot ${preset.design?.rotation || 0}`));
    }
    useEffect(() => {
      if (!selectedDesignAssetId || !requestJson) return;
      const token = `${selectedDesignAssetId}:${shirtModelId}:${shirtView}:${shirtColorId}`;
      placementLoadTokenRef.current = token;
      requestJson(`/api/mockup-placements?designAssetId=${encodeURIComponent(selectedDesignAssetId)}&shirtModel=${encodeURIComponent(shirtModelId)}&view=${encodeURIComponent(shirtView)}&color=${encodeURIComponent(shirtColorId)}&latest=1`, null, "GET").then(({ res, data }) => {
        if (!res.ok || placementLoadTokenRef.current !== token) return;
        const placement = data?.placement || null;
        if (!placement) return;
        pendingPlacementRef.current = placement;
        setApplyAllColors(!!placement.applyAllColors || !placement.color);
        setApplyAllMockups(!!placement.applyAllMockups || !placement.shirtModel);
        if (placement.shirtModel && placement.shirtModel !== shirtModelId) setShirtModelId(placement.shirtModel);
        if (placement.view && placement.view !== shirtView) setShirtView(placement.view);
        if (placement.color && placement.color !== shirtColorId) setShirtColorId(placement.color);
        if (!placement.shirtModel || placement.shirtModel === shirtModelId) {
          placeDesign(placement).then(() => {
            setNotice("Last saved placement applied for this design.");
          }).catch(() => {});
        }
      }).catch(() => {});
    }, [selectedDesignAssetId, shirtModelId, shirtView, shirtColorId, requestJson]);
    const panelStyle = {
      background: "rgba(255,255,255,0.022)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 18,
      padding: 16
    };
    const sectionTitle = label => h("div", {
      style: {
        fontSize: 10,
        color: "var(--text-tertiary)",
        fontFamily: "'DM Mono',monospace",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        marginBottom: 10
      }
    }, label);
    const propertyRow = (label, value) => h("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        padding: "9px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)"
      }
    }, h("span", {
      style: { color: "var(--text-tertiary)", fontSize: 11 }
    }, label), h("span", {
      style: { color: "var(--text-primary)", fontSize: 11, fontFamily: "'DM Mono',monospace", textAlign: "right" }
    }, value));
    const placementList = placements.length ? h("div", {
      style: { display: "grid", gap: 8, maxHeight: 220, overflowY: "auto", paddingRight: 3 }
    }, placements.map(renderPlacementRow)) : h("div", {
      style: { fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }
    }, loadBusy ? "Loading saved placements..." : "No saved placements yet.");
    const localPresetList = localPresets.length ? h("div", {
      style: { display: "grid", gap: 8, maxHeight: 220, overflowY: "auto", paddingRight: 3, marginTop: 10 }
    }, localPresets.map(renderLocalPresetRow)) : h("div", {
      style: { fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 10 }
    }, "No local presets saved yet.");
    const scalePercent = placementSnapshot ? `${Math.round(Number(placementSnapshot.scale || 0) * 100)}%` : "—";
    const rotationDegrees = placementSnapshot ? `${placementSnapshot.rotation}°` : "—";
    const printAreaStatus = placementSnapshot?.insidePrintArea ? "Inside print area" : placementSnapshot ? "Outside print area" : "No design";
    const activeLayer = layers.find(layer => layer.id === activeLayerId) || null;
    const editorDisabled = !placementSnapshot || !!activeLayer?.locked;
    const smallControlStyle = {
      minHeight: 34,
      borderRadius: 10,
      padding: "8px 10px",
      fontSize: 11
    };
    const rangeStyle = {
      width: "100%",
      accentColor: "#FFDC64"
    };
    const nudgeButton = (label, dx, dy) => h("button", {
      key: label,
      type: "button",
      onClick: () => moveDesign(dx, dy),
      disabled: editorDisabled,
      style: {
        ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle),
        opacity: editorDisabled ? 0.45 : 1
      }
    }, label);
    const renderLayerRow = (layer, index) => {
      const active = layer.id === activeLayerId;
      return h("div", {
        key: layer.id,
        style: {
          border: active ? "1px solid rgba(255,220,100,0.36)" : "1px solid rgba(255,255,255,0.08)",
          background: active ? "rgba(255,220,100,0.07)" : "rgba(255,255,255,0.03)",
          borderRadius: 8,
          padding: 9
        }
      }, h("div", {
        style: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }
      }, h("input", {
        type: "text",
        value: layer.name,
        onFocus: () => selectLayer(layer.id),
        onChange: event => updateLayerMeta(layer.id, { name: event.target.value }),
        style: {
          minHeight: 32,
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.18)",
          color: "var(--text-primary)",
          padding: "7px 9px",
          fontSize: 11
        }
      }), h("button", {
        type: "button",
        onClick: () => selectLayer(layer.id),
        style: tokenButton(touchButton, active ? "1px solid rgba(255,220,100,0.32)" : "1px solid rgba(255,255,255,0.08)", active ? "rgba(255,220,100,0.08)" : "rgba(255,255,255,0.03)", active ? "var(--accent-gold)" : "var(--text-secondary)", { minHeight: 32, borderRadius: 8, padding: "7px 9px", fontSize: 10 })
      }, active ? "Active" : "Select")), h("div", {
        style: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginTop: 8 }
      }, h("button", {
        type: "button",
        title: "Move layer up",
        onClick: () => moveLayer(layer.id, -1),
        disabled: index === 0,
        style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: index === 0 ? 0.45 : 1 }
      }, "Up"), h("button", {
        type: "button",
        title: "Move layer down",
        onClick: () => moveLayer(layer.id, 1),
        disabled: index === layers.length - 1,
        style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: index === layers.length - 1 ? 0.45 : 1 }
      }, "Down"), h("button", {
        type: "button",
        title: "Duplicate layer",
        onClick: () => duplicateLayer(layer.id),
        style: tokenButton(touchButton, "1px solid rgba(90,180,255,0.24)", "rgba(90,180,255,0.07)", "var(--accent-blue)", smallControlStyle)
      }, "Copy"), h("button", {
        type: "button",
        title: layer.locked ? "Unlock layer" : "Lock layer",
        onClick: () => toggleLayerLock(layer.id),
        style: tokenButton(touchButton, "1px solid rgba(255,220,100,0.24)", "rgba(255,220,100,0.07)", "var(--accent-gold)", smallControlStyle)
      }, layer.locked ? "Unlock" : "Lock"), h("button", {
        type: "button",
        title: "Delete layer",
        onClick: () => deleteLayer(layer.id),
        style: tokenButton(touchButton, "1px solid rgba(255,120,120,0.24)", "rgba(255,120,120,0.07)", "#ff9a9a", smallControlStyle)
      }, "Del")), h("label", {
        style: { display: "grid", gap: 5, marginTop: 8, fontSize: 10, color: "var(--text-tertiary)" }
      }, "Opacity", h("input", {
        type: "range",
        min: "0",
        max: "1",
        step: "0.01",
        value: layer.opacity ?? 1,
        onChange: event => updateLayerMeta(layer.id, { opacity: Number(event.target.value) }),
        style: rangeStyle
      })));
    };
    const selectStyle = {
      width: "100%",
      minHeight: 38,
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.035)",
      color: "var(--text-primary)",
      padding: "8px 10px",
      fontSize: 12
    };
    const renderProductButton = item => {
      const active = item.id === shirtModelId;
      const favorite = favoriteProducts.includes(item.id);
      return h("div", {
        key: item.id,
        style: {
          border: active ? "1px solid rgba(255,220,100,0.34)" : "1px solid rgba(255,255,255,0.08)",
          background: active ? "rgba(255,220,100,0.08)" : "rgba(255,255,255,0.03)",
          borderRadius: 12,
          padding: 10
        }
      }, h("div", {
        style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }
      }, h("button", {
        type: "button",
        onClick: () => setShirtModelId(item.id),
        style: {
          flex: 1,
          textAlign: "left",
          border: "none",
          background: "transparent",
          color: active ? "var(--accent-gold)" : "var(--text-primary)",
          padding: 0,
          cursor: "pointer"
        }
      }, h("div", {
        style: { fontSize: 12, fontWeight: 800 }
      }, item.displayName), h("div", {
        style: { fontSize: 10, color: "var(--text-tertiary)", marginTop: 4 }
      }, `${item.category} · ${item.fit}`)), h("button", {
        type: "button",
        onClick: () => toggleFavoriteProduct(item.id),
        title: favorite ? "Remove favorite" : "Favorite product",
        style: {
          border: "1px solid rgba(255,255,255,0.08)",
          background: favorite ? "rgba(255,220,100,0.12)" : "rgba(255,255,255,0.03)",
          color: favorite ? "var(--accent-gold)" : "var(--text-tertiary)",
          borderRadius: 9,
          minWidth: 30,
          minHeight: 30,
          cursor: "pointer"
        }
      }, favorite ? "★" : "☆")));
    };
    const leftSidebar = h("aside", {
      style: { ...panelStyle, minWidth: 0 }
    }, sectionTitle("Product selector"), h("div", {
      style: { display: "grid", gap: 8, marginBottom: 10 }
    }, h("input", {
      type: "search",
      value: productSearch,
      onChange: event => setProductSearch(event.target.value),
      placeholder: "Search product, brand, model",
      style: selectStyle
    }), h("select", {
      value: brandFilter,
      onChange: event => setBrandFilter(event.target.value),
      style: selectStyle
    }, h("option", {
      value: ""
    }, "All brands"), brands.map(brand => h("option", {
      key: brand,
      value: brand
    }, brand))), h("select", {
      value: categoryFilter,
      onChange: event => setCategoryFilter(event.target.value),
      style: selectStyle
    }, h("option", {
      value: ""
    }, "All categories"), categories.map(category => h("option", {
      key: category,
      value: category
    }, category)))), h("div", {
      style: { display: "grid", gap: 8, maxHeight: 265, overflowY: "auto", paddingRight: 3, marginBottom: 18 }
    }, filteredProducts.length ? filteredProducts.map(renderProductButton) : h("div", {
      style: { fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }
    }, "No products match the current filters.")), sectionTitle("Shirt Color"), h("div", {
      style: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 18 }
    }, selectedProduct.availableColors.map(item => h("button", {
      key: item.id,
      type: "button",
      onClick: () => setShirtColorId(item.id),
      style: tokenButton(touchButton, item.id === shirtColorId ? "1px solid rgba(255,220,100,0.34)" : "1px solid rgba(255,255,255,0.08)", item.id === shirtColorId ? "rgba(255,220,100,0.08)" : "rgba(255,255,255,0.03)", item.id === shirtColorId ? "var(--accent-gold)" : "var(--text-secondary)", { minHeight: 58, padding: "10px 8px", borderRadius: 12, flexDirection: "column", gap: 7 })
    }, h("span", {
      style: { width: 22, height: 22, borderRadius: "50%", background: item.hex, border: item.id === "white" ? "1px solid rgba(20,20,22,0.12)" : "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 14px rgba(0,0,0,0.18)" }
    }), h("span", {
      style: { fontSize: 11 }
    }, item.name)))), sectionTitle("View"), h("div", {
      style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }
    }, VIEWS.map(item => h("button", {
      key: item.id,
      type: "button",
      onClick: () => setShirtView(item.id),
      style: tokenButton(touchButton, item.id === shirtView ? "1px solid rgba(255,220,100,0.34)" : "1px solid rgba(255,255,255,0.08)", item.id === shirtView ? "rgba(255,220,100,0.08)" : "rgba(255,255,255,0.03)", item.id === shirtView ? "var(--accent-gold)" : "var(--text-secondary)", { minHeight: 42, borderRadius: 12, padding: "10px 12px", fontSize: 11 })
    }, item.name))));
    const centerCanvas = h("main", {
      style: { ...panelStyle, minWidth: 0 }
    }, h("div", {
      style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }
    }, h("div", null, h("div", {
      style: { fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }
    }, `${model.name} · ${color.name}`), h("div", {
      style: { marginTop: 4, fontSize: 12, color: "var(--text-secondary)" }
    }, `${VIEWS.find(item => item.id === shirtView)?.name || "Front"} view with visible safe print area`)), h("span", {
      style: { fontSize: 11, color: "var(--text-tertiary)", fontFamily: "'DM Mono',monospace" }
    }, "2000×2000 export")), h("div", {
      style: {
        borderRadius: 22,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "#F4EEE5",
        boxShadow: "0 28px 90px rgba(0,0,0,0.24)"
      }
    }, h("canvas", {
      ref: canvasRef,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      style: { width: "100%", display: "block", aspectRatio: "1 / 1" }
    })), h("div", {
      style: {
        marginTop: 10,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 11
      }
    }, h("span", {
      style: { color: "rgba(255,220,100,0.82)", fontFamily: "'DM Mono',monospace" }
    }, "Safe print area is visible on shirt"), h("span", {
      style: { color: printAreaWarning ? "#FF8E8E" : "var(--accent-green)", fontFamily: "'DM Mono',monospace" }
    }, printAreaWarning || printAreaStatus)));
    const rightSidebar = h("aside", {
      style: { display: "grid", gap: 12, minWidth: 0 }
    }, h("div", {
      style: panelStyle
    }, sectionTitle("Design Properties"), h("div", {
      style: { display: "flex", gap: 8, marginBottom: 10 }
    }, h("button", {
      type: "button",
      onClick: () => fileInputRef.current && fileInputRef.current.click(),
      style: tokenButton(touchButton, "1px solid rgba(90,180,255,0.26)", "rgba(90,180,255,0.08)", "var(--accent-blue)", { minHeight: 36, padding: "8px 12px", borderRadius: 10, fontSize: 11 })
    }, "Upload design"), h("button", {
      type: "button",
      onClick: addTextLayer,
      style: tokenButton(touchButton, "1px solid rgba(255,220,100,0.26)", "rgba(255,220,100,0.08)", "var(--accent-gold)", { minHeight: 36, padding: "8px 12px", borderRadius: 10, fontSize: 11 })
    }, "Add text"), h("input", {
      ref: fileInputRef,
      type: "file",
      accept: "image/*",
      onChange: handleLocalUpload,
      style: { display: "none" }
    })), h("input", {
      type: "text",
      value: textLayerValue,
      onChange: event => setTextLayerValue(event.target.value),
      placeholder: "Text layer content",
      style: { ...selectStyle, marginBottom: 10 }
    }), designChoices.length === 0 ? h("div", {
      style: { fontSize: 12, color: "var(--text-secondary)", padding: "8px 0", lineHeight: 1.5 }
    }, "Upload a design in the composer or directly here to start.") : h("div", {
      style: { display: "grid", gap: 8, maxHeight: 210, overflowY: "auto", paddingRight: 3 }
    }, designChoices.map(renderDesignChoice)), h("div", {
      style: { fontSize: 11, color: "var(--text-tertiary)", marginTop: 10, lineHeight: 1.45 }
    }, "Drag the selected design directly on the canvas. Use corner handles to resize and rotate."), propertyRow("Active layer", activeLayer ? activeLayer.name : "None"), propertyRow("Aspect ratio", "Locked"), propertyRow("Safe area", printAreaStatus)), h("div", {
      style: panelStyle
    }, sectionTitle("Layers"), layers.length ? h("div", {
      style: { display: "grid", gap: 8, maxHeight: 360, overflowY: "auto", paddingRight: 3 }
    }, layers.map(renderLayerRow)) : h("div", {
      style: { fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }
    }, "No layers yet.")), h("div", {
      style: panelStyle
    }, sectionTitle("Position"), printAreaWarning && h("div", {
      style: { color: "#FF8E8E", fontSize: 12, lineHeight: 1.45, marginBottom: 8 }
    }, printAreaWarning), propertyRow("X position", placementSnapshot ? placementSnapshot.x : "—"), propertyRow("Y position", placementSnapshot ? placementSnapshot.y : "—"), h("div", {
      style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 }
    }, h("button", {
      type: "button",
      onClick: () => alignDesign("left", null),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Left"), h("button", {
      type: "button",
      onClick: () => alignDesign("center", null),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,220,100,0.26)", "rgba(255,220,100,0.08)", "var(--accent-gold)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Center X"), h("button", {
      type: "button",
      onClick: () => alignDesign("right", null),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Right")), h("div", {
      style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }
    }, h("button", {
      type: "button",
      onClick: () => alignDesign(null, "top"),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Top"), h("button", {
      type: "button",
      onClick: () => alignDesign(null, "center"),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,220,100,0.26)", "rgba(255,220,100,0.08)", "var(--accent-gold)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Middle"), h("button", {
      type: "button",
      onClick: () => alignDesign(null, "bottom"),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Bottom")), h("div", {
      style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 }
    }, nudgeButton("↖", -10, -10), nudgeButton("↑", 0, -10), nudgeButton("↗", 10, -10), nudgeButton("←", -10, 0), h("button", {
      type: "button",
      onClick: snapToCenter,
      disabled: !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,220,100,0.26)", "rgba(255,220,100,0.08)", "var(--accent-gold)", { minHeight: 38, borderRadius: 12, padding: "9px 11px", fontSize: 11 }), opacity: placementSnapshot ? 1 : 0.45 }
    }, "Snap to center"), nudgeButton("→", 10, 0), nudgeButton("↙", -10, 10), nudgeButton("↓", 0, 10), nudgeButton("↘", 10, 10)), h("div", {
      style: { display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }
    }, h("button", {
      type: "button",
      onClick: resetPlacement,
      disabled: !selectedDesign?.url,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", { minHeight: 38, borderRadius: 12, padding: "9px 11px", fontSize: 11 }), opacity: selectedDesign?.url ? 1 : 0.45 }
    }, "Reset this mockup"))), h("div", {
      style: panelStyle
    }, sectionTitle("Size"), propertyRow("Width", placementSnapshot ? placementSnapshot.width : "—"), propertyRow("Height", placementSnapshot ? placementSnapshot.height : "—"), propertyRow("Scale", scalePercent), propertyRow("Scale raw", placementSnapshot ? placementSnapshot.scale : "—"), h("input", {
      type: "range",
      min: "0.04",
      max: "1.4",
      step: "0.01",
      value: placementSnapshot ? placementSnapshot.scale : 0.1,
      disabled: editorDisabled,
      onChange: event => setDesignScale(event.target.value),
      style: { ...rangeStyle, marginTop: 12, opacity: editorDisabled ? 0.45 : 1 }
    }), h("div", {
      style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }
    }, h("button", {
      type: "button",
      onClick: () => scaleDesign(0.9),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Smaller"), h("button", {
      type: "button",
      onClick: () => scaleDesign(1.1),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,220,100,0.26)", "rgba(255,220,100,0.08)", "var(--accent-gold)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "Larger"))), h("div", {
      style: panelStyle
    }, sectionTitle("Rotation"), propertyRow("Rotation", rotationDegrees), h("input", {
      type: "range",
      min: "-45",
      max: "45",
      step: "1",
      value: placementSnapshot ? placementSnapshot.rotation : 0,
      disabled: editorDisabled,
      onChange: event => setDesignRotation(event.target.value),
      style: { ...rangeStyle, marginTop: 12, opacity: editorDisabled ? 0.45 : 1 }
    }), h("div", {
      style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }
    }, h("button", {
      type: "button",
      onClick: () => rotateDesign(-5),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "-5°"), h("button", {
      type: "button",
      onClick: () => setDesignRotation(0),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,220,100,0.26)", "rgba(255,220,100,0.08)", "var(--accent-gold)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "0°"), h("button", {
      type: "button",
      onClick: () => rotateDesign(5),
      disabled: editorDisabled,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", smallControlStyle), opacity: editorDisabled ? 0.45 : 1 }
    }, "+5°"))), h("div", {
      style: panelStyle
    }, sectionTitle("Print area information"), propertyRow("Area X", model.printArea.x), propertyRow("Area Y", model.printArea.y), propertyRow("Area width", model.printArea.width), propertyRow("Area height", model.printArea.height), propertyRow("Normalized", `${selectedProduct.printArea.width} × ${selectedProduct.printArea.height}`), propertyRow("Status", printAreaStatus)), h("div", {
      style: panelStyle
    }, sectionTitle("Product specifications"), propertyRow("Brand", selectedProduct.brand), propertyRow("Model", selectedProduct.model), propertyRow("Category", selectedProduct.category), propertyRow("Colors", selectedProduct.availableColors.length), propertyRow("Recommended", `${selectedProduct.recommendedDesignWidth}×${selectedProduct.recommendedDesignHeight}`), propertyRow("DPI", selectedProduct.dpi), propertyRow("Export size", `${selectedProduct.exportSize}×${selectedProduct.exportSize}`)), h("div", {
      style: panelStyle
    }, sectionTitle("Preset Reuse"), h("label", {
      style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-secondary)", marginBottom: 8, cursor: "pointer" }
    }, h("input", {
      type: "checkbox",
      checked: applyAllColors,
      onChange: event => setApplyAllColors(!!event.target.checked)
    }), "Apply to all colors"), h("label", {
      style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-secondary)", marginBottom: 10, cursor: "pointer" }
    }, h("input", {
      type: "checkbox",
      checked: applyAllMockups,
      onChange: event => setApplyAllMockups(!!event.target.checked)
    }), "Apply to all mockups"), h("div", {
      style: { display: "grid", gap: 8, marginBottom: 10 }
    }, h("input", {
      type: "text",
      value: presetName,
      onChange: event => setPresetName(event.target.value),
      placeholder: "Preset name",
      style: {
        minHeight: 38,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.035)",
        color: "var(--text-primary)",
        padding: "9px 11px",
        fontSize: 12
      }
    }), h("button", {
      type: "button",
      onClick: saveNamedPreset,
      disabled: !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(90,180,255,0.26)", "rgba(90,180,255,0.08)", "var(--accent-blue)", { minHeight: 38, borderRadius: 12, padding: "9px 11px", fontSize: 11 }), opacity: placementSnapshot ? 1 : 0.55 }
    }, "Save named preset")), h("div", {
      style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }
    }, h("button", {
      type: "button",
      onClick: () => savePlacementPreset({ applyAllColors: true, applyAllMockups: false }),
      disabled: saveBusy || !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,220,100,0.24)", "rgba(255,220,100,0.08)", "var(--accent-gold)", { minHeight: 38, borderRadius: 12, padding: "9px 11px", fontSize: 11 }), opacity: saveBusy || !placementSnapshot ? 0.55 : 1 }
    }, "Apply to colors"), h("button", {
      type: "button",
      onClick: () => savePlacementPreset({ applyAllColors, applyAllMockups: true }),
      disabled: saveBusy || !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(126,232,162,0.28)", "rgba(126,232,162,0.08)", "var(--accent-green)", { minHeight: 38, borderRadius: 12, padding: "9px 11px", fontSize: 11 }), opacity: saveBusy || !placementSnapshot ? 0.55 : 1 }
    }, "Apply to mockups")), h("div", {
      style: { fontSize: 11, color: "var(--text-tertiary)", marginTop: 10, lineHeight: 1.5 }
    }, "The latest saved preset for this design will be reused automatically.")), h("div", {
      style: panelStyle
    }, sectionTitle("Load saved preset"), localPresetList), h("div", {
      style: panelStyle
    }, sectionTitle("Export"), h("div", {
      style: { fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.45, marginBottom: 10 }
    }, `Filename: ${buildExportFileName("png", false)}`), printAreaWarning && h("div", {
      style: { color: "#FF8E8E", fontSize: 12, lineHeight: 1.45, marginBottom: 10 }
    }, "Export warning: design is outside the safe print area."), h("div", {
      style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }
    }, h("button", {
      type: "button",
      onClick: () => savePlacementPreset(),
      disabled: saveBusy || !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(126,232,162,0.28)", "rgba(126,232,162,0.08)", "var(--accent-green)", { minHeight: 40, borderRadius: 12, padding: "10px 12px", fontSize: 11 }), opacity: saveBusy || !placementSnapshot ? 0.55 : 1 }
    }, saveBusy ? "Saving..." : "Save placement"), h("button", {
      type: "button",
      onClick: () => exportMockup("png"),
      disabled: exportBusy === "png" || !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(90,180,255,0.26)", "rgba(90,180,255,0.08)", "var(--accent-blue)", { minHeight: 40, borderRadius: 12, padding: "10px 12px", fontSize: 11 }), opacity: exportBusy === "png" || !placementSnapshot ? 0.55 : 1 }
    }, exportBusy === "png" ? "PNG..." : "Export PNG")), h("div", {
      style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }
    }, h("button", {
      type: "button",
      onClick: () => exportMockup("jpg"),
      disabled: exportBusy === "jpg" || !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,255,255,0.08)", "rgba(255,255,255,0.03)", "var(--text-secondary)", { minHeight: 40, borderRadius: 12, padding: "10px 12px", fontSize: 11 }), opacity: exportBusy === "jpg" || !placementSnapshot ? 0.55 : 1 }
    }, exportBusy === "jpg" ? "JPG..." : "Export JPG"), h("button", {
      type: "button",
      onClick: () => exportMockup("png", { transparent: true }),
      disabled: exportBusy === "transparent-png" || !placementSnapshot,
      style: { ...tokenButton(touchButton, "1px solid rgba(255,220,100,0.26)", "rgba(255,220,100,0.08)", "var(--accent-gold)", { minHeight: 40, borderRadius: 12, padding: "10px 12px", fontSize: 11 }), opacity: exportBusy === "transparent-png" || !placementSnapshot ? 0.55 : 1 }
    }, exportBusy === "transparent-png" ? "Transparent..." : "Transparent PNG")), h("div", {
      style: { fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.45, marginTop: 10 }
    }, "Exports include the shirt and design only. Safe-area guide overlays are hidden during export."), error && h("div", {
      style: { marginTop: 12, fontSize: 12, color: "#FF8E8E", lineHeight: 1.45 }
    }, error), notice && h("div", {
      style: { marginTop: 8, fontSize: 12, color: "var(--accent-green)" }
    }, notice)), h("div", {
      style: panelStyle
    }, sectionTitle("Saved placements"), h("div", {
      style: { fontSize: 11, color: "var(--text-secondary)", marginBottom: 10 }
    }, loadBusy ? "Loading..." : `${placements.length} saved`), placementList), h("div", {
      style: panelStyle
    }, sectionTitle("Placement JSON"), h("pre", {
      style: { margin: 0, fontSize: 10, lineHeight: 1.55, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'DM Mono',monospace", maxHeight: 260, overflow: "auto" }
    }, JSON.stringify(previewJson, null, 2))));
    return h("div", {
      style: { maxWidth: 1480, margin: "0 auto", padding: "18px 20px 28px" }
    }, h("header", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: 16,
        marginBottom: 16,
        flexWrap: "wrap"
      }
    }, h("div", null, h("div", {
      style: { fontSize: 10, color: "var(--accent-gold)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }
    }, "Mockup production"), h("h2", {
      style: { margin: 0, color: "var(--text-primary)", fontSize: "clamp(24px, 3vw, 36px)", letterSpacing: "-0.04em" }
    }, "T-Shirt Studio"), h("p", {
      style: { margin: "8px 0 0", color: "var(--text-secondary)", fontSize: 13, maxWidth: 720, lineHeight: 1.55 }
    }, "Choose the shirt model, color, and view on the left. Position the design on the canvas, then inspect properties and export from the right.")), h("div", {
      style: { color: "var(--text-tertiary)", fontSize: 11, fontFamily: "'DM Mono',monospace" }
    }, "Canvas · Safe area · Export")), h("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "minmax(230px, 280px) minmax(420px, 1fr) minmax(280px, 340px)",
        gap: 16,
        alignItems: "start",
        overflowX: "auto",
        paddingBottom: 4
      }
    }, leftSidebar, centerCanvas, rightSidebar));
  }

  window.KOTShirtStudioSection = TShirtStudioSection;
})();
