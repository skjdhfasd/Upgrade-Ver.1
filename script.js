/* =========================================================
   바이브 FOUR YOU — script.js
   data.json 로드 → 필터링/정렬 → 카드 렌더링 → Leaflet 지도 연동
   ========================================================= */

(() => {
  "use strict";

  /* ---------- 상태 ---------- */
  const state = {
    places: [],
    shift: "전체",
    category: "전체",
    walkableOnly: false,
    rerouteMode: false,
    selectedId: null,
  };

  /* ---------- DOM 참조 ---------- */
  const els = {
    clock: document.getElementById("liveClock"),
    placeList: document.getElementById("placeList"),
    resultCount: document.getElementById("resultCount"),
    emptyState: document.getElementById("emptyState"),
    shiftFilter: document.getElementById("shiftFilter"),
    categoryFilter: document.getElementById("categoryFilter"),
    walkToggle: document.getElementById("walkToggle"),
    rerouteToggle: document.getElementById("rerouteToggle"),
    mainLayout: document.querySelector(".main-layout"),
    mobileTabs: document.querySelectorAll(".mobile-tab"),
  };

  /* ---------- 헤더 필터 영역 접기/펼치기 (터치 기기용) ---------- */
  const appHeader = document.querySelector(".app-header");
  const brandToggle = document.getElementById("brandToggle");

  function setHeaderPinned(pinned) {
    appHeader.classList.toggle("is-pinned", pinned);
    brandToggle.setAttribute("aria-expanded", String(pinned));
  }

  brandToggle.addEventListener("click", () => {
    setHeaderPinned(!appHeader.classList.contains("is-pinned"));
  });

  brandToggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setHeaderPinned(!appHeader.classList.contains("is-pinned"));
    }
  });

  // 헤더 바깥을 탭하면 펼쳐진 필터 영역을 다시 접음 (모바일)
  document.addEventListener("click", (e) => {
    if (!appHeader.contains(e.target)) {
      setHeaderPinned(false);
    }
  });

  /* ---------- 실시간 디지털 시계 ---------- */
  function updateClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    els.clock.textContent = `${hh}:${mm}:${ss}`;
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ---------- Leaflet 지도 초기화 ---------- */
  // 정선/태백 중심 좌표로 초기 세팅
  const MAP_CENTER = [37.28, 128.85];
  const map = L.map("map", { scrollWheelZoom: true }).setView(MAP_CENTER, 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);
  const markersById = new Map();

  function congestionColorClass(level) {
    if (level === "혼잡") return "map-marker--혼잡";
    if (level === "보통") return "map-marker--보통";
    return "map-marker--여유";
  }

  function buildMarkerIcon(level) {
    return L.divIcon({
      className: "",
      html: `<div class="map-marker ${congestionColorClass(level)}"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 22],
      popupAnchor: [0, -22],
    });
  }

  function renderMarkers(places) {
    markerLayer.clearLayers();
    markersById.clear();

    places.forEach((place) => {
      const marker = L.marker([place.lat, place.lng], {
        icon: buildMarkerIcon(place.congestionLevel),
      });

      marker.bindPopup(`
        <div class="popup-title">${escapeHtml(place.name)}</div>
        <div class="popup-meta">${escapeHtml(place.region)} · ${escapeHtml(place.category)}</div>
        <div class="popup-meta">혼잡도: ${escapeHtml(place.congestionLevel)} · 교통혼잡: ${place.trafficCongestion}/5</div>
      `);

      marker.addTo(markerLayer);
      markersById.set(place.id, marker);
    });
  }

  function focusPlaceOnMap(place) {
    map.flyTo([place.lat, place.lng], 13, { duration: 0.6 });
    const marker = markersById.get(place.id);
    if (marker) {
      marker.openPopup();
    }
  }

  /* ---------- 유틸 ---------- */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function trafficBadgeLabel(score) {
    if (score <= 2) return `🟢 교통 원활 (${score}/5)`;
    if (score === 3) return `🟡 교통 보통 (${score}/5)`;
    return `🔴 교통 혼잡 (${score}/5)`;
  }

  /* ---------- 필터링 + 정렬 (AI 우회 추천 로직) ---------- */
  function getFilteredPlaces() {
    let list = state.places.filter((p) => {
      const shiftOk = state.shift === "전체" || p.shift === state.shift;
      const categoryOk = state.category === "전체" || p.category === state.category;
      const walkOk = !state.walkableOnly || p.walkability.possible === true;
      return shiftOk && categoryOk && walkOk;
    });

    if (state.rerouteMode) {
      // 교통 혼잡도가 낮고(trafficCongestion 작을수록 원활) + 관람 혼잡도가 '여유'인 지점을 최상단 우선 정렬
      list = [...list].sort((a, b) => {
        const scoreOf = (p) => {
          const relaxedBonus = p.congestionLevel === "여유" ? 0 : 1;
          return relaxedBonus * 10 + p.trafficCongestion;
        };
        return scoreOf(a) - scoreOf(b);
      });
    }

    return list;
  }

  /* ---------- 카드 렌더링 ---------- */
  function renderPlaceList() {
    const filtered = getFilteredPlaces();

    els.resultCount.textContent = `${filtered.length}곳`;
    els.placeList.innerHTML = "";
    els.emptyState.hidden = filtered.length > 0;

    filtered.forEach((place, index) => {
      const card = document.createElement("article");
      card.className = "place-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${place.name} 지도에서 보기`);
      card.dataset.id = place.id;

      if (place.id === state.selectedId) {
        card.classList.add("is-selected");
      }

      const recommendedBadge =
        state.rerouteMode && index === 0
          ? `<span class="badge badge--reroute">🚦 우선 추천</span>`
          : "";

      const walkBadge = place.walkability.possible
        ? `<span class="badge badge--walk">🚶‍♂️ 도보 ${place.walkability.distanceKm}km</span>`
        : "";

      card.innerHTML = `
        <div class="place-card-top">
          <div class="place-name">${escapeHtml(place.name)}</div>
        </div>
        <div class="place-region-cat">${escapeHtml(place.region)} · ${escapeHtml(place.category)} · ${escapeHtml(place.shift)} SHIFT</div>
        <p class="place-desc">${escapeHtml(place.description)}</p>
        <div class="place-meta-row">
          <span class="badge badge--congestion-${escapeHtml(place.congestionLevel)}">${escapeHtml(place.congestionLevel)}</span>
          <span class="badge badge--traffic">${trafficBadgeLabel(place.trafficCongestion)}</span>
          ${walkBadge}
          <span class="badge badge--tag">${escapeHtml(place.tag)}</span>
          ${recommendedBadge}
        </div>
      `;

      card.addEventListener("click", () => selectPlace(place));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectPlace(place);
        }
      });

      els.placeList.appendChild(card);
    });

    renderMarkers(filtered);
  }

  function selectPlace(place) {
    state.selectedId = place.id;
    renderPlaceList();
    focusPlaceOnMap(place);

    // 모바일에서는 카드를 선택하면 지도 탭으로 자동 전환
    if (window.matchMedia("(max-width: 768px)").matches) {
      switchMobileTab("map");
    }
  }

  /* ---------- 필터 버튼 이벤트 ---------- */
  function setupChipGroup(container, stateKey) {
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;

      [...container.querySelectorAll(".chip")].forEach((c) => c.classList.remove("is-active"));
      btn.classList.add("is-active");

      state[stateKey] = btn.dataset.value;
      renderPlaceList();
    });
  }

  setupChipGroup(els.shiftFilter, "shift");
  setupChipGroup(els.categoryFilter, "category");

  els.walkToggle.addEventListener("click", () => {
    state.walkableOnly = !state.walkableOnly;
    els.walkToggle.setAttribute("aria-pressed", String(state.walkableOnly));
    renderPlaceList();
  });

  els.rerouteToggle.addEventListener("click", () => {
    state.rerouteMode = !state.rerouteMode;
    els.rerouteToggle.setAttribute("aria-pressed", String(state.rerouteMode));
    renderPlaceList();
  });

  /* ---------- 모바일 탭 전환 ---------- */
  function switchMobileTab(tab) {
    els.mobileTabs.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
    });
    els.mainLayout.classList.toggle("show-map", tab === "map");
    els.mainLayout.classList.toggle("show-list", tab === "list");

    if (tab === "map") {
      // 탭 전환 시 지도 크기 재계산 (Leaflet 렌더링 이슈 방지)
      setTimeout(() => map.invalidateSize(), 50);
    }
  }

  els.mobileTabs.forEach((btn) => {
    btn.addEventListener("click", () => switchMobileTab(btn.dataset.tab));
  });

  // 초기 모바일 상태: 지도 우선 표시
  if (window.matchMedia("(max-width: 768px)").matches) {
    els.mainLayout.classList.add("show-map");
  }

  /* ---------- data.json 로드 ---------- */
  async function loadData() {
    try {
      const res = await fetch("data.json");
      if (!res.ok) throw new Error(`데이터 로드 실패: ${res.status}`);
      const json = await res.json();
      state.places = json.places || [];
      renderPlaceList();

      if (state.places.length > 0) {
        const bounds = L.latLngBounds(state.places.map((p) => [p.lat, p.lng]));
        // 초기 뷰는 정선/태백 중심 zoom 10~11 유지 (전체 bounds로 과도하게 축소하지 않음)
        map.setView(MAP_CENTER, 10);
      }
    } catch (err) {
      els.placeList.innerHTML = `<p class="empty-state">데이터를 불러오지 못했습니다. (${escapeHtml(err.message)})</p>`;
      console.error(err);
    }
  }

  loadData();
})();