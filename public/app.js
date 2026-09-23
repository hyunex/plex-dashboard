// 전역 상태 관리
const state = {
  currentView: "dashboard", // "dashboard" | "logs"
  currentUser: "all",
  currentType: "all",
  activityLimit: 100,
  activities: [], // 오래된 순(위) → 최신 순(아래) 누적
  activityTotal: 0,
  activityHasMorePast: false,
  isLoadingPastActivity: false,
  aliases: {},
  locations: {},
  showStreamDownloads: true,

  // 로그 뷰어 상태
  activeLogGroupId: "Plex Media Server",
  logLimit: 100,
  logLines: [],
  totalLines: 0,
  fromLine: 0,
  toLine: 0,
  hasMorePast: false,
  hasMoreFuture: false,
  isLoadingPast: false,
  liveTailInterval: null,
  isLiveTailActive: false,

  // 분석 (Analytics) 상태
  analytics: {
    bandwidthRange: "1h",
    peakSource: "activity",
    bandwidthChart: null,
    peakHoursChart: null,
    isLoading: false,
  },
};

// DOM 요소 캐시
const el = {
  navDashboard: document.getElementById("nav-dashboard"),
  navMainLogs: document.getElementById("nav-main-logs"),
  navPluginLogs: document.getElementById("nav-plugin-logs"),
  viewDashboard: document.getElementById("view-dashboard"),
  viewLogs: document.getElementById("view-logs"),
  // 모바일 네비게이션 드로어 요소
  btnToggleSidebar: document.getElementById("btn-toggle-sidebar"),
  btnCloseSidebar: document.getElementById("btn-close-sidebar"),
  sidebarAside: document.getElementById("sidebar-aside"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  btnMobileNavDashboard: document.getElementById("btn-mobile-nav-dashboard"),
  btnOpenAliasesMobile: document.getElementById("btn-open-aliases-mobile"),
  btnOpenSettingsMobile: document.getElementById("btn-open-settings-mobile"),
  // 대시보드 요소
  filterUser: document.getElementById("filter-user"),
  filterType: document.getElementById("filter-type"),
  btnRefreshActivities: document.getElementById("btn-refresh-activities"),
  btnManualImport: document.getElementById("btn-manual-import"),
  importStatusText: document.getElementById("import-status-text"),
  activityList: document.getElementById("activity-list"),
  activityShowingText: document.getElementById("activity-showing-text"),
  pastActivityIndicator: document.getElementById("past-activity-indicator"),
  totalEventsBadge: document.getElementById("total-events-badge"),

  // 통계 요소
  statActiveUsers: document.getElementById("stat-active-users"),
  statTotalUsers: document.getElementById("stat-total-users"),
  statPlays: document.getElementById("stat-plays"),
  statDownloads: document.getElementById("stat-downloads"),
  statEvents: document.getElementById("stat-events"),

  // 뷰어 요소
  logViewTitle: document.getElementById("log-view-title"),
  logSplitBadge: document.getElementById("log-split-badge"),
  logViewDesc: document.getElementById("log-view-desc"),
  logLimitSelect: document.getElementById("log-limit-select"),
  btnToggleLive: document.getElementById("btn-toggle-live"),
  liveIndicatorDot: document.getElementById("live-indicator-dot"),
  liveToggleText: document.getElementById("live-toggle-text"),
  btnRefreshLog: document.getElementById("btn-refresh-log"),
  btnScrollBottom: document.getElementById("btn-scroll-bottom"),
  logTerminal: document.getElementById("log-terminal"),
  pastLoadingIndicator: document.getElementById("past-loading-indicator"),

  // 설정 모달 요소
  btnOpenSettings: document.getElementById("btn-open-settings"),
  settingsModal: document.getElementById("settings-modal"),
  btnCloseSettings: document.getElementById("btn-close-settings"),
  btnCancelSettings: document.getElementById("btn-cancel-settings"),
  btnSaveSettings: document.getElementById("btn-save-settings"),
  settingRetention: document.getElementById("setting-retention"),
  settingInterval: document.getElementById("setting-interval"),
  settingStreamDownloads: document.getElementById("setting-stream-downloads"),
  // 닉네임 모달 요소
  btnOpenAliases: document.getElementById("btn-open-aliases"),
  aliasModal: document.getElementById("alias-modal"),
  aliasList: document.getElementById("alias-list"),
  btnCloseAliases: document.getElementById("btn-close-aliases"),
  btnCancelAliases: document.getElementById("btn-cancel-aliases"),
  btnSaveAliases: document.getElementById("btn-save-aliases"),

  // 분석 (Analytics) 요소
  navAnalytics: document.getElementById("nav-analytics"),
  btnMobileNavAnalytics: document.getElementById("btn-mobile-nav-analytics"),
  viewAnalytics: document.getElementById("view-analytics"),
  btnRefreshAnalytics: document.getElementById("btn-refresh-analytics"),
  bandwidthRangeSelector: document.getElementById("bandwidth-range-selector"),
  bwStatCurrent: document.getElementById("bw-stat-current"),
  bwStatPeak: document.getElementById("bw-stat-peak"),
  bwStatTotal: document.getElementById("bw-stat-total"),
  bwStatAvg: document.getElementById("bw-stat-avg"),
  peakSourceSelector: document.getElementById("peak-source-selector"),
  peakHourBadge: document.getElementById("peak-hour-badge"),
  peakWindowBadge: document.getElementById("peak-window-badge"),
  topContentList: document.getElementById("top-content-list"),
  monthlyLabelBadge: document.getElementById("monthly-label-badge"),
  monthlyTotalBytes: document.getElementById("monthly-total-bytes"),
  monthlyWanBytes: document.getElementById("monthly-wan-bytes"),
  monthlyLanBytes: document.getElementById("monthly-lan-bytes"),
  monthlyActiveUsers: document.getElementById("monthly-active-users"),
  monthlyAvgUser: document.getElementById("monthly-avg-user"),
  monthlyUsersList: document.getElementById("monthly-users-list"),
};

// 1. 초기화
async function init() {
  initMeasuredViewport();
  bindEvents();
  await loadSettings();
  await refreshDashboard();
  await loadLogGroups();
}

// 실측 뷰포트: 모바일 주소창/툴바/노치 변화에 맞춰 body 높이를 px로 고정
function initMeasuredViewport() {
  const visibleContainer = () =>
    state.currentView === "logs"
      ? el.logTerminal
      : state.currentView === "analytics"
      ? el.viewAnalytics
      : el.activityList;
  const reAnchorVisible = () => {
    const c = visibleContainer();
    if (c && !c.classList.contains("hidden")) anchorToBottom(c);
  };
  const setVh = () => {
    const vv = window.visualViewport;
    // visualViewport가 있으면 실제 가시 높이, 없으면 innerHeight 사용
    const h = vv && vv.height ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-vh", `${Math.round(h)}px`);
    // 뷰포트 높이가 바뀌면(주소창 show/hide, 회전) 현재 뷰 맨 아래를 다시 정확히 맞춤
    requestAnimationFrame(reAnchorVisible);
    setTimeout(reAnchorVisible, 120);
  };
  setVh();
  window.addEventListener("resize", setVh);
  window.addEventListener("orientationchange", () => setTimeout(setVh, 120));
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", setVh);
    window.visualViewport.addEventListener("scroll", setVh);
  }
  window.__reAnchorVisible = reAnchorVisible;
}

// 스크롤 컨테이너를 "정확히 맨 아래"에 고정 (마지막 카드 전체 + spacer까지 보이도록)
function anchorToBottom(container) {
  if (!container) return;
  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
}

// 2. 이벤트 바인딩
function bindEvents() {
  // 뷰 전환
  el.navDashboard.addEventListener("click", () => switchView("dashboard"));

  // 필터 변경
  el.filterUser.addEventListener("change", (e) => {
    state.currentUser = e.target.value;
    reloadActivities();
  });

  el.filterType.addEventListener("change", (e) => {
    state.currentType = e.target.value;
    reloadActivities();
  });

  el.btnRefreshActivities.addEventListener("click", () => refreshDashboard());

  // 활동 피드 역방향 스크롤 (위로 올리면 과거 로드)
  el.activityList.addEventListener("scroll", handleActivityScroll);

  // 사용자 클릭 시 필터 전환 (이벤트 위임 방식으로 XSS 원천 차단)
  el.activityList.addEventListener("click", (e) => {
    const target = e.target.closest(".btn-filter-user");
    if (target && target.dataset.user) {
      filterByUser(target.dataset.user);
    }
  });

  // 수동 동기화
  el.btnManualImport.addEventListener("click", handleManualImport);

  // 로그 뷰어 제어
  el.logLimitSelect.addEventListener("change", (e) => {
    state.logLimit = parseInt(e.target.value, 10);
    loadLogViewer(state.activeLogGroupId, true);
  });

  el.btnRefreshLog.addEventListener("click", () => {
    refreshLogViewerLatest();
  });

  el.btnToggleLive.addEventListener("click", toggleLiveTail);
  el.btnScrollBottom.addEventListener("click", scrollTerminalToBottom);

  // 역방향 스크롤 감지 (위로 스크롤 시 과거 로그 로드)
  el.logTerminal.addEventListener("scroll", handleTerminalScroll);

  // 설정 모달
  el.btnOpenSettings.addEventListener("click", openSettingsModal);
  el.btnCloseSettings.addEventListener("click", closeSettingsModal);
  el.btnCancelSettings.addEventListener("click", closeSettingsModal);
  el.btnSaveSettings.addEventListener("click", saveSettings);

  // 닉네임 모달
  el.btnOpenAliases.addEventListener("click", openAliasModal);
  el.btnCloseAliases.addEventListener("click", closeAliasModal);
  el.btnCancelAliases.addEventListener("click", closeAliasModal);
  el.btnSaveAliases.addEventListener("click", saveAliases);

  // 모바일 드로어 이벤트 바인딩
  function openMobileSidebar() {
    if (el.sidebarAside) el.sidebarAside.classList.add("drawer-open");
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.remove("hidden");
  }
  function closeMobileSidebar() {
    if (el.sidebarAside) el.sidebarAside.classList.remove("drawer-open");
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.add("hidden");
  }

  if (el.btnToggleSidebar) el.btnToggleSidebar.addEventListener("click", openMobileSidebar);
  if (el.btnCloseSidebar) el.btnCloseSidebar.addEventListener("click", closeMobileSidebar);
  if (el.sidebarBackdrop) el.sidebarBackdrop.addEventListener("click", closeMobileSidebar);
  if (el.btnMobileNavDashboard) el.btnMobileNavDashboard.addEventListener("click", () => {
    switchView("dashboard");
    closeMobileSidebar();
  });
  if (el.btnOpenAliasesMobile) el.btnOpenAliasesMobile.addEventListener("click", openAliasModal);
  if (el.btnOpenSettingsMobile) el.btnOpenSettingsMobile.addEventListener("click", openSettingsModal);

  // 분석 (Analytics) 탭 및 컨트롤 이벤트
  if (el.navAnalytics) {
    el.navAnalytics.addEventListener("click", () => switchView("analytics"));
  }
  if (el.btnMobileNavAnalytics) {
    el.btnMobileNavAnalytics.addEventListener("click", () => {
      switchView("analytics");
      closeMobileSidebar();
    });
  }
  if (el.btnRefreshAnalytics) {
    el.btnRefreshAnalytics.addEventListener("click", () => loadAnalytics(true));
  }
  if (el.bandwidthRangeSelector) {
    el.bandwidthRangeSelector.addEventListener("click", (e) => {
      const btn = e.target.closest(".bw-range-btn");
      if (!btn) return;
      const range = btn.dataset.range;
      if (range && range !== state.analytics.bandwidthRange) {
        state.analytics.bandwidthRange = range;
        updateBandwidthRangeButtons();
        loadBandwidthData();
      }
    });
  }
  if (el.peakSourceSelector) {
    el.peakSourceSelector.addEventListener("click", (e) => {
      const btn = e.target.closest(".peak-src-btn");
      if (!btn) return;
      const src = btn.dataset.source;
      if (src && src !== state.analytics.peakSource) {
        state.analytics.peakSource = src;
        updatePeakSourceButtons();
        loadPeakHoursData();
      }
    });
  }
}

// 3. 뷰 전환
function switchView(viewName) {
  state.currentView = viewName;

  const viewDashboard = el.viewDashboard || document.getElementById("view-dashboard");
  const viewLogs = el.viewLogs || document.getElementById("view-logs");
  const viewAnalytics = el.viewAnalytics || document.getElementById("view-analytics");
  const navDashboard = el.navDashboard || document.getElementById("nav-dashboard");
  const navAnalytics = el.navAnalytics || document.getElementById("nav-analytics");

  // 모든 뷰 숨김 (클래스 및 인라인 스타일 모두 처리)
  if (viewDashboard) {
    viewDashboard.classList.add("hidden");
    viewDashboard.style.display = "none";
  }
  if (viewLogs) {
    viewLogs.classList.add("hidden");
    viewLogs.style.display = "none";
  }
  if (viewAnalytics) {
    viewAnalytics.classList.add("hidden");
    viewAnalytics.style.display = "none";
  }

  // 네비게이션 버튼 초기화
  const navInactive =
    "w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-gray-400 hover:bg-gray-800/60 hover:text-gray-200 transition-colors";
  const navActive =
    "w-full flex items-center space-x-3 px-3 py-2 rounded-lg bg-plex/10 text-plex font-medium hover:bg-plex/20 transition-colors";

  if (navDashboard) navDashboard.className = navInactive;
  if (navAnalytics) navAnalytics.className = navInactive;

  // 모바일 탑바 버튼 초기화
  const mbDash = el.btnMobileNavDashboard || document.getElementById("btn-mobile-nav-dashboard");
  const mbAnalytics = el.btnMobileNavAnalytics || document.getElementById("btn-mobile-nav-analytics");
  if (mbDash) {
    mbDash.className =
      viewName === "dashboard"
        ? "px-2.5 py-1 text-xs rounded-md bg-plex/10 text-plex hover:bg-plex/20 transition-colors flex items-center space-x-1"
        : "px-2.5 py-1 text-xs rounded-md text-gray-400 hover:text-plex transition-colors flex items-center space-x-1";
  }
  if (mbAnalytics) {
    mbAnalytics.className =
      viewName === "analytics"
        ? "px-2.5 py-1 text-xs rounded-md bg-plex/10 text-plex hover:bg-plex/20 transition-colors flex items-center space-x-1"
        : "px-2.5 py-1 text-xs rounded-md text-gray-400 hover:text-plex transition-colors flex items-center space-x-1";
  }

  // 사이드바 로그 active 표시 해제
  document.querySelectorAll(".nav-log-btn").forEach((btn) => {
    btn.className =
      "nav-log-btn w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-800/80 hover:text-gray-200 transition-colors text-left";
  });

  if (viewName === "dashboard") {
    if (viewDashboard) {
      viewDashboard.classList.remove("hidden");
      viewDashboard.style.display = "flex";
    }
    if (navDashboard) navDashboard.className = navActive;
    stopLiveTail();
    if (el.sidebarAside) el.sidebarAside.classList.remove("drawer-open");
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.add("hidden");
    requestAnimationFrame(() => anchorToBottom(el.activityList));
  } else if (viewName === "analytics") {
    if (viewAnalytics) {
      viewAnalytics.classList.remove("hidden");
      viewAnalytics.style.display = "flex";
    }
    if (navAnalytics) navAnalytics.className = navActive;
    stopLiveTail();
    if (el.sidebarAside) el.sidebarAside.classList.remove("drawer-open");
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.add("hidden");
    // 레이아웃이 확정된 후 분석 데이터 및 차트 로드
    requestAnimationFrame(() => {
      loadAnalytics();
    });
  } else {
    if (viewLogs) {
      viewLogs.classList.remove("hidden");
      viewLogs.style.display = "flex";
    }
    if (el.sidebarAside) el.sidebarAside.classList.remove("drawer-open");
    if (el.sidebarBackdrop) el.sidebarBackdrop.classList.add("hidden");
    requestAnimationFrame(() => anchorToBottom(el.logTerminal));
  }
}
window.switchView = switchView;
// 4. 대시보드 데이터 로드
async function refreshDashboard() {
  await loadAliases();
  await Promise.all([loadStats(), loadUsers(), reloadActivities()]);
}

function displayNameOf(userName) {
  const alias = (state.aliases[userName] || "").trim();
  return alias !== "" ? alias : userName;
}

async function loadAliases() {
  try {
    const res = await fetch("/api/aliases");
    state.aliases = await res.json();
  } catch (err) {
    console.error("별칭 로드 실패:", err);
  }
}

async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    el.statActiveUsers.innerText = data.active_users_today.toLocaleString();
    el.statTotalUsers.innerText = data.total_users.toLocaleString();
    el.statPlays.innerText = data.total_plays.toLocaleString();
    el.statDownloads.innerText = data.total_downloads.toLocaleString();
    el.statEvents.innerText = data.total_events.toLocaleString();
    el.totalEventsBadge.innerText = `${data.total_events.toLocaleString()}건`;
  } catch (err) {
    console.error("통계 로드 실패:", err);
  }
}

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const users = await res.json();

    const currentVal = el.filterUser.value;
    el.filterUser.innerHTML = '<option value="all">전체 사용자 (모두 보기)</option>';

    users.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.user_name;
      const label = u.display_name && u.display_name !== u.user_name
        ? `${u.display_name} (${u.user_name}, ${u.count.toLocaleString()}건)`
        : `${u.user_name} (${u.count.toLocaleString()}건)`;
      opt.textContent = label;
      el.filterUser.appendChild(opt);
    });

    if (currentVal && (currentVal === "all" || users.some((u) => u.user_name === currentVal))) {
      el.filterUser.value = currentVal;
    }
  } catch (err) {
    console.error("사용자 목록 로드 실패:", err);
  }
}

// 활동 피드: 아래가 최신(하단 앵커), 위로 스크롤하면 과거를 앞에 이어붙임
async function reloadActivities() {
  state.activities = [];
  state.activityTotal = 0;
  state.activityHasMorePast = false;
  await loadLatestActivities();
}

async function loadLatestActivities() {
  try {
    el.activityList.innerHTML = `
      <div class="p-8 text-center text-gray-500 text-sm">
        <i class="fa-solid fa-circle-notch fa-spin text-plex mr-2"></i> 활동 내역을 불러오는 중입니다...
      </div>
      <div id="activity-bottom-spacer" aria-hidden="true"></div>
    `;

    // API는 최신순(DESC) 반환. 화면은 "위=과거, 아래=최신"이므로 뒤집어서 누적
    const params = new URLSearchParams({
      limit: state.activityLimit.toString(),
      offset: "0",
    });
    if (state.currentUser !== "all") params.set("user", state.currentUser);
    if (state.currentType !== "all") params.set("type", state.currentType);

    const res = await fetch(`/api/activities?${params}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) {
      throw new Error("데이터 형식 오류");
    }

    state.activityTotal = data.total ?? 0;
    state.activities = [...data.items].reverse();
    state.activityHasMorePast = data.items.length > 0 && state.activities.length < (data.total ?? 0);

    renderActivities();
    scrollActivitiesToBottom();
  } catch (err) {
    console.error("활동 내역 로드 실패:", err);
    el.activityList.innerHTML = `
      <div class="p-6 text-center text-red-400 bg-red-950/20 border border-red-900/50 rounded-xl text-sm space-y-2">
        <div>활동 내역을 불러오지 못했습니다. (${escapeHtml(err.message || "오류")})</div>
        <button onclick="reloadActivities()" class="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded text-xs transition-colors">
          <i class="fa-solid fa-rotate-right mr-1"></i> 다시 시도
        </button>
      </div>
      <div id="activity-bottom-spacer" aria-hidden="true"></div>
    `;
  }
}

function renderActivities() {
  if (state.activities.length === 0) {
    el.activityList.innerHTML = `
      <div class="p-12 text-center bg-[#161b22] border border-gray-800 rounded-xl text-gray-400 text-sm">
        <i class="fa-regular fa-folder-open text-3xl mb-2 text-gray-600 block"></i>
        선택한 조건에 해당하는 활동 내역이 없습니다.
      </div>
      <div id="activity-bottom-spacer" aria-hidden="true"></div>
    `;
    el.activityShowingText.innerText = `총 ${state.activityTotal.toLocaleString()}건`;
    return;
  }
  el.activityList.innerHTML = state.activities.map((item) => renderActivityCard(item)).join("") + '<div id="activity-bottom-spacer" aria-hidden="true"></div>';
  el.activityShowingText.innerText = `총 ${state.activityTotal.toLocaleString()}건 중 ${state.activities.length.toLocaleString()}건 표시 (아래가 최신)`;
  resolveLocations(state.activities);
  // 렌더 직후 레이아웃 확정 타이밍에 정확히 맨 아래로 앵커
  requestAnimationFrame(() => anchorToBottom(el.activityList));
}

function scrollActivitiesToBottom() {
  const doScroll = () => anchorToBottom(el.activityList);
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 60);
  setTimeout(doScroll, 200);
}

async function handleActivityScroll() {
  if (state.isLoadingPastActivity || !state.activityHasMorePast) return;
  if (el.activityList.scrollTop > 40) return;

  state.isLoadingPastActivity = true;
  el.pastActivityIndicator.classList.remove("hidden");
  el.pastActivityIndicator.classList.add("flex");

  const prevHeight = el.activityList.scrollHeight;
  try {
    const params = new URLSearchParams({
      limit: state.activityLimit.toString(),
      offset: state.activities.length.toString(),
    });
    if (state.currentUser !== "all") params.set("user", state.currentUser);
    if (state.currentType !== "all") params.set("type", state.currentType);

    const res = await fetch(`/api/activities?${params}`);
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      state.activities = [...[...data.items].reverse(), ...state.activities];
      state.activityHasMorePast = state.activities.length < data.total;
      el.activityList.innerHTML = state.activities.map((item) => renderActivityCard(item)).join("") + '<div id="activity-bottom-spacer" aria-hidden="true"></div>';
      el.activityList.scrollTop = el.activityList.scrollHeight - prevHeight;
      el.activityShowingText.innerText = `총 ${data.total.toLocaleString()}건 중 ${state.activities.length.toLocaleString()}건 표시 (아래가 최신)`;
      resolveLocations(data.items);
    } else {
      state.activityHasMorePast = false;
    }
  } catch (err) {
    console.error("과거 활동 로드 실패:", err);
  } finally {
    state.isLoadingPastActivity = false;
    el.pastActivityIndicator.classList.add("hidden");
    el.pastActivityIndicator.classList.remove("flex");
  }
}

async function resolveLocations(items) {
  const ips = [...new Set(items.map((i) => i.client_ip).filter((ip) => ip && ip !== "Unknown" && !ip.startsWith("127.") && !ip.startsWith("172.") && !ip.startsWith("192.168.")))];
  const needed = ips.filter((ip) => !state.locations[ip]);
  if (needed.length === 0) {
    updateLocationSpans();
    return;
  }
  try {
    const res = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ips: needed }),
    });
    const map = await res.json();
    Object.assign(state.locations, map);
    updateLocationSpans();
  } catch (err) {
    console.error("위치 조회 실패:", err);
  }
}

function updateLocationSpans() {
  document.querySelectorAll("[data-ip-loc]").forEach((el) => {
    const ip = el.getAttribute("data-ip-loc");
    const loc = state.locations[ip];
    if (loc) {
      el.textContent = `· ${loc}`;
    }
  });
}

function renderActivityCard(act) {
  let badgeClass = "bg-gray-800 text-gray-300";
  let badgeText = act.activity_type;
  if (act.activity_type === "PLAY_START") {
    badgeClass = "bg-emerald-500/10 text-emerald-400";
    badgeText = "시청시작";
  } else if (act.activity_type === "PLAYING") {
    badgeClass = "bg-blue-500/10 text-blue-400";
    badgeText = "시청중";
  } else if (act.activity_type === "PAUSE") {
    badgeClass = "bg-yellow-500/10 text-yellow-400";
    badgeText = "일시정지";
  } else if (act.activity_type === "STOP") {
    badgeClass = "bg-slate-500/10 text-slate-300";
    badgeText = "시청종료";
  } else if (act.activity_type === "DOWNLOAD") {
    if (act.is_stream === 1) {
      badgeClass = "bg-indigo-500/10 text-indigo-400";
      badgeText = "스트리밍 전송";
    } else {
      badgeClass = "bg-amber-500/10 text-amber-400 font-bold";
      badgeText = "오프라인 다운로드";
    }
  } else if (act.activity_type === "CONNECT") {
    badgeClass = "bg-purple-500/10 text-purple-400";
    badgeText = "접속";
  }

  const displayName = displayNameOf(act.user_name);
  const initial = displayName.charAt(0).toUpperCase();
  const aliasTag = act.alias && act.alias.trim() !== "" ? `<span class="text-[10px] text-gray-500">(${escapeHtml(act.user_name)})</span>` : "";

  // 1행 대제목: 사용자명, 배지, 시간, IP, 위치
  const ip = act.client_ip && act.client_ip !== "Unknown" ? act.client_ip : "";
  const cachedLoc = ip ? (act.ip_location || state.locations[ip] || "") : "";
  const locSpan = ip ? `<span class="text-amber-400/90 font-normal" data-ip-loc="${escapeHtml(ip)}">${cachedLoc ? `· ${escapeHtml(cachedLoc)}` : ""}</span>` : "";

  // 2행 중제목: 미디어 정보 (있을 때만)
  let mediaText = "";
  if (act.media_title) {
    const se = [];
    if (act.season_index !== null && act.season_index !== undefined) se.push(`S${act.season_index}`);
    if (act.episode_index !== null && act.episode_index !== undefined) se.push(`E${act.episode_index}`);
    const seStr = se.length > 0 ? ` [${se.join("")}]` : "";
    const head = act.show_title ? `${act.show_title}${seStr} - ` : "";
    mediaText = `${head}${act.episode_title || act.media_title}`;
  }

  // 3행 하위 내용: 대/중제목과 겹치는 내용(사용자명, 미디어제목, IP) 완전 제외한 순수 상세 정보만 표시
  const details = [];
  const devParts = [];
  if (act.device_name && act.device_name !== "알 수 없는 기기") devParts.push(act.device_name);
  if (act.platform && act.platform !== "Unknown" && act.platform !== act.device_name) devParts.push(act.platform);
  if (act.product && act.product !== act.device_name && act.product !== act.platform) devParts.push(act.product);
  const devLabel = devParts.length > 0 ? devParts.join(" · ") : (act.device_name || "Plex Client");
  details.push(`<span class="text-gray-400">기기: <span class="text-gray-300 font-medium">${escapeHtml(devLabel)}</span></span>`);

  let pct = -1;
  if (act.duration_ms > 0 && act.progress_ms >= 0) {
    pct = Math.min(100, Math.max(0, Math.round((act.progress_ms / act.duration_ms) * 100)));
    details.push(`<span class="text-gray-400">진행: <span class="text-gray-300">${formatDuration(act.progress_ms)} / ${formatDuration(act.duration_ms)}</span> (<span class="text-plex font-semibold">${pct}%</span>)</span>`);
  } else if (act.activity_type === "DOWNLOAD") {
    const kind = act.is_stream === 1 ? "재생 버퍼 스트리밍" : "오프라인 다운로드 완료";
    details.push(`<span class="text-gray-400">전송량: <span class="text-amber-400 font-semibold">${formatBytes(act.file_size_bytes)}</span> (${kind})</span>`);
  } else if (act.activity_type === "CONNECT") {
    details.push(`<span class="text-gray-500">알림 채널 세션 오픈</span>`);
  }

  return `
    <div class="activity-card bg-[#161b22] border border-gray-800 rounded-lg px-2.5 py-1.5 flex items-start gap-2 text-xs">
      <div class="w-6 h-6 rounded-md bg-gray-800 flex items-center justify-center text-white font-bold text-[11px] flex-shrink-0 mt-0.5">${initial}</div>
      <div class="min-w-0 flex-1 leading-snug space-y-0.5">
        <!-- 1행: 대제목 (사용자명, 배지, 시간, IP, 위치) -->
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="btn-filter-user font-bold text-white hover:underline cursor-pointer" data-user="${escapeHtml(act.user_name)}">${escapeHtml(displayName)}</span>
          ${aliasTag}
          <span class="px-1.5 py-px rounded ${badgeClass} text-[10px] leading-4">${badgeText}</span>
          <span class="text-gray-500 font-mono text-[11px]">${act.timestamp}</span>
          ${ip ? `<span class="text-gray-500 font-mono text-[11px]">· ${escapeHtml(ip)}</span>` : ""}
          ${locSpan}
        </div>

        <!-- 2행: 중제목 (미디어 정보) -->
        ${mediaText ? `<div class="text-gray-200 font-medium truncate">${escapeHtml(mediaText)}</div>` : ""}

        <!-- 3행: 상세 정보 (순수 부가 정보만) -->
        <div class="text-gray-500 text-[11px] flex items-center gap-2 flex-wrap">
          ${details.join(' <span class="text-gray-700">|</span> ')}
        </div>
      </div>
      ${pct >= 0 ? `
      <div class="w-14 flex-shrink-0 hidden sm:block self-center">
        <div class="w-full bg-gray-800 rounded-full h-1 overflow-hidden">
          <div class="bg-plex h-1 rounded-full" style="width: ${pct}%"></div>
        </div>
      </div>` : ""}
    </div>
  `;
}

// 사용자 클릭 시 해당 사용자 필터로 즉시 전환
window.filterByUser = function (userName) {
  el.filterUser.value = userName;
  state.currentUser = userName;
  reloadActivities();
};

// 5. 사이드바 로그 그룹 로드
async function loadLogGroups() {
  try {
    const res = await fetch("/api/log-groups");
    const groups = await res.json();

    const mainGroups = groups.filter((g) => g.category === "main" || g.category === "scanner" || g.category === "other");
    const pluginGroups = groups.filter((g) => g.category === "plugin");

    // 메인 로그 렌더링
    el.navMainLogs.innerHTML = mainGroups
      .map(
        (g) => `
      <button onclick="selectLogGroup('${escapeHtml(g.id)}')" data-group-id="${escapeHtml(g.id)}"
        class="nav-log-btn w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-800/80 hover:text-gray-200 transition-colors text-left">
        <span class="truncate pr-2">${escapeHtml(g.displayName)}</span>
        <span class="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">${g.files.length}개</span>
      </button>
    `
      )
      .join("");

    // 플러그인 로그 렌더링 (서버에서 이미 최근 기록 순 정렬됨)
    el.navPluginLogs.innerHTML = pluginGroups
      .map((g) => {
        const rel = formatRelativeTime(g.lastWrite);
        return `
      <button onclick="selectLogGroup('${escapeHtml(g.id)}')" data-group-id="${escapeHtml(g.id)}" title="최근 기록: ${rel} · ${escapeHtml(g.displayName.replace("[플러그인] ", ""))}"
        class="nav-log-btn w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-800/80 hover:text-gray-200 transition-colors text-left">
        <span class="truncate pr-2">${escapeHtml(g.displayName.replace("[플러그인] ", ""))}</span>
        <span class="text-[10px] text-gray-500 font-mono flex-shrink-0">${rel}</span>
      </button>
    `;
      })
      .join("");
  } catch (err) {
    console.error("로그 그룹 목록 로드 실패:", err);
  }
}

function formatRelativeTime(mtimeMs) {
  if (!mtimeMs) return "-";
  const diff = Date.now() - mtimeMs;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일 전`;
  return `${Math.floor(day / 30)}달 전`;
}

// 6. 로그 그룹 선택
window.selectLogGroup = async function (groupId) {
  state.activeLogGroupId = groupId;
  switchView("logs");

  // 사이드바 액티브 스타일 업데이트
  document.querySelectorAll(".nav-log-btn").forEach((btn) => {
    if (btn.getAttribute("data-group-id") === groupId) {
      btn.className =
        "nav-log-btn w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs bg-plex/10 text-plex font-medium hover:bg-plex/20 transition-colors text-left";
    } else {
      btn.className =
        "nav-log-btn w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-gray-400 hover:bg-gray-800/80 hover:text-gray-200 transition-colors text-left";
    }
  });

  await loadLogViewer(groupId, true);
};

// 7. 가상 분할 로그 통합 뷰어 로드
async function loadLogViewer(groupId, scrollBottom = true) {
  try {
    el.logTerminal.innerHTML = `
      <div class="p-8 text-center text-gray-500 text-sm">
        <i class="fa-solid fa-circle-notch fa-spin text-plex mr-2"></i> 통합 로그를 불러오는 중입니다...
      </div>
      <div id="log-bottom-spacer" aria-hidden="true"></div>
    `;

    const params = new URLSearchParams({
      groupId,
      limit: state.logLimit.toString(),
    });

    const res = await fetch(`/api/logs/view?${params}`);
    const data = await res.json();

    state.logLines = data.lines;
    state.totalLines = data.totalLines;
    state.fromLine = data.fromLine;
    state.toLine = data.toLine;
    state.hasMorePast = data.hasMorePast;
    state.hasMoreFuture = data.hasMoreFuture;

    // 헤더 정보 업데이트
    let displayTitle = groupId;
    if (groupId.startsWith("plugin:")) {
      displayTitle = `PMS Plugin Logs / ${groupId.replace("plugin:", "")}.log`;
    } else {
      displayTitle = `${groupId}.log`;
    }
    el.logViewTitle.firstElementChild.innerText = displayTitle;
    el.logViewDesc.innerText = `총 ${data.totalLines.toLocaleString()}줄 중 ${data.fromLine + 1} - ${data.toLine}줄 표시 중`;

    renderLogTerminal(data.lines);

    if (scrollBottom) {
      scrollTerminalToBottom();
    }
  } catch (err) {
    console.error("로그 뷰어 로드 실패:", err);
    el.logTerminal.innerHTML = `<div class="p-4 text-red-400">로그를 불러오는 데 실패했습니다.</div><div id="log-bottom-spacer" aria-hidden="true"></div>`;
  }
}

// 8. 터미널 렌더링 및 구문 하이라이팅
function renderLogTerminal(lines) {
  const html = lines.map((line) => formatLogLine(line)).join("");
  el.logTerminal.innerHTML = html + '<div id="log-bottom-spacer" aria-hidden="true"></div>';
  requestAnimationFrame(() => anchorToBottom(el.logTerminal));
}

function formatLogLine(line) {
  // 타임스탬프 파싱
  const match = line.match(/^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+\[\d+\]\s+([A-Z]+)\s+-\s+(.*)$/);
  if (match) {
    const [, time, level, content] = match;
    const levelClass = `log-level-${level}`;
    return `<div class="log-line"><span class="log-time">${time}</span> <span class="${levelClass}">[${level}]</span> <span>${escapeHtml(content)}</span></div>`;
  }
  return `<div class="log-line">${escapeHtml(line)}</div>`;
}

// 9. 역방향 스크롤 (위로 스크롤 시 과거 로그 연속 로드)
async function handleTerminalScroll() {
  if (state.isLoadingPast || !state.hasMorePast) return;

  // 스크롤이 상단 30px 이내에 도달했을 때
  if (el.logTerminal.scrollTop <= 30) {
    state.isLoadingPast = true;
    el.pastLoadingIndicator.classList.remove("hidden");

    const prevScrollHeight = el.logTerminal.scrollHeight;
    const prevScrollTop = el.logTerminal.scrollTop;

    try {
      const params = new URLSearchParams({
        groupId: state.activeLogGroupId,
        limit: state.logLimit.toString(),
        beforeLine: state.fromLine.toString(),
      });

      const res = await fetch(`/api/logs/view?${params}`);
      const data = await res.json();

      if (data.lines && data.lines.length > 0) {
        state.fromLine = data.fromLine;
        state.hasMorePast = data.hasMorePast;
        state.logLines = [...data.lines, ...state.logLines];

        const pastHtml = data.lines.map((line) => formatLogLine(line)).join("");
        el.logTerminal.insertAdjacentHTML("afterbegin", pastHtml);

        // 스크롤 위치 보정 (사용자가 보던 위치 유지)
        const newScrollHeight = el.logTerminal.scrollHeight;
        el.logTerminal.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;

        el.logViewDesc.innerText = `총 ${state.totalLines.toLocaleString()}줄 중 ${state.fromLine + 1} - ${state.toLine}줄 표시 중`;
      }
    } catch (err) {
      console.error("과거 로그 로드 실패:", err);
    } finally {
      state.isLoadingPast = false;
      el.pastLoadingIndicator.classList.add("hidden");
    }
  }
}

// 10. 수동 새로고침 (최신 로그 갱신)
async function refreshLogViewerLatest() {
  await loadLogViewer(state.activeLogGroupId, true);
}

// 11. 실시간 새로고침 (Live Tail) 토글
function toggleLiveTail() {
  if (state.isLiveTailActive) {
    stopLiveTail();
  } else {
    startLiveTail();
  }
}

function startLiveTail() {
  state.isLiveTailActive = true;
  el.btnToggleLive.className =
    "px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs flex items-center space-x-1.5 transition-colors border border-emerald-500/40";
  el.liveIndicatorDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
  el.liveToggleText.innerText = "실시간 새로고침: ON";

  // 즉시 1회 최신화 후 2초 주기로 폴링
  refreshLogViewerLatest();
  state.liveTailInterval = setInterval(() => {
    refreshLogViewerLatest();
  }, 2000);
}

function stopLiveTail() {
  state.isLiveTailActive = false;
  if (state.liveTailInterval) {
    clearInterval(state.liveTailInterval);
    state.liveTailInterval = null;
  }
  el.btnToggleLive.className =
    "px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center space-x-1.5 transition-colors border border-gray-700";
  el.liveIndicatorDot.className = "w-2 h-2 rounded-full bg-gray-500";
  el.liveToggleText.innerText = "실시간 새로고침: OFF";
}

function scrollTerminalToBottom() {
  const doScroll = () => anchorToBottom(el.logTerminal);
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 60);
  setTimeout(doScroll, 200);
}

// 12. 수동 즉시 동기화 버튼 핸들러
async function handleManualImport() {
  el.btnManualImport.disabled = true;
  el.btnManualImport.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>동기화 중...</span>`;

  try {
    const res = await fetch("/api/import-now", { method: "POST" });
    const data = await res.json();
    el.importStatusText.innerText = `방금 동기화 완료 (${data.importedCount}건 반영)`;
    await refreshDashboard();
  } catch (err) {
    console.error("수동 동기화 실패:", err);
  } finally {
    el.btnManualImport.disabled = false;
    el.btnManualImport.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> <span>즉시 동기화</span>`;
  }
}

// 13. 설정 모달 핸들러
async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    el.settingRetention.value = data.retention_days || "90";
    el.settingInterval.value = data.import_interval_sec || "30";
    if (el.settingStreamDownloads) {
      el.settingStreamDownloads.checked = data.show_stream_downloads !== "0";
    }
    el.importStatusText.innerText = `자동 수집 주기: ${data.import_interval_sec}초`;
  } catch (err) {
    console.error("설정 로드 실패:", err);
  }
}

function openSettingsModal() {
  el.settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  el.settingsModal.classList.add("hidden");
}

async function saveSettings() {
  const retention = el.settingRetention.value;
  const interval = el.settingInterval.value;
  const streamVal = el.settingStreamDownloads && el.settingStreamDownloads.checked ? "1" : "0";

  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        retention_days: retention,
        import_interval_sec: interval,
        show_stream_downloads: streamVal,
      }),
    });
    el.importStatusText.innerText = `자동 수집 주기: ${interval}초`;
    closeSettingsModal();
    alert("설정이 저장되었습니다.");
    await reloadActivities();
  } catch (err) {
    console.error("설정 저장 실패:", err);
    alert("설정 저장에 실패했습니다.");
  }
}

// 14. 닉네임 모달 핸들러
async function openAliasModal() {
  el.aliasModal.classList.remove("hidden");
  el.aliasList.innerHTML = '<div class="text-xs text-gray-500">사용자 목록을 불러오는 중...</div>';
  try {
    const res = await fetch("/api/users");
    const users = await res.json();
    if (users.length === 0) {
      el.aliasList.innerHTML = '<div class="text-xs text-gray-500">표시할 사용자가 없습니다.</div>';
      return;
    }
    el.aliasList.innerHTML = users.map((u) => `
      <div class="flex items-center gap-2 bg-[#0e1117] border border-gray-800 rounded-lg px-2.5 py-1.5">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-bold text-white truncate">${escapeHtml(u.user_name)}</div>
          <div class="text-[10px] text-gray-500">${u.count.toLocaleString()}건 · 최근 ${escapeHtml(u.last_seen || "-")}</div>
        </div>
        <input data-alias-for="${escapeHtml(u.user_name)}" value="${escapeHtml(u.alias || "")}"
          placeholder="닉네임 입력" maxlength="30"
          class="w-36 bg-[#161b22] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-plex" />
      </div>
    `).join("");
  } catch (err) {
    console.error("닉네임 목록 로드 실패:", err);
    el.aliasList.innerHTML = '<div class="text-xs text-red-400">사용자 목록을 불러오지 못했습니다.</div>';
  }
}

function closeAliasModal() {
  el.aliasModal.classList.add("hidden");
}

async function saveAliases() {
  const inputs = el.aliasList.querySelectorAll("input[data-alias-for]");
  el.btnSaveAliases.disabled = true;
  try {
    for (const input of inputs) {
      const userName = input.getAttribute("data-alias-for");
      await fetch("/api/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_name: userName, alias: input.value || "" }),
      });
    }
    closeAliasModal();
    await refreshDashboard();
  } catch (err) {
    console.error("닉네임 저장 실패:", err);
    alert("닉네임 저장에 실패했습니다.");
  } finally {
    el.btnSaveAliases.disabled = false;
  }
}

// HTML 이스케이프 유틸
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "0초";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;
  return `${seconds}초`;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = (bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 0);
  return `${val} ${units[i]}`;
}


function formatMbps(mbps) {
  if (!mbps || mbps < 0.01) return "0.00 Mbps";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

// ==========================================
// 13. 서버 통계 & 분석 (Analytics) 모듈
// ==========================================

async function loadAnalytics(isRefresh = false) {
  if (state.analytics.isLoading) return;
  state.analytics.isLoading = true;

  const refreshBtn = el.btnRefreshAnalytics || document.getElementById("btn-refresh-analytics");
  if (isRefresh && refreshBtn) {
    refreshBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-[10px]"></i> <span class="hidden sm:inline">로딩 중...</span>`;
  }

  try {
    const range = state.analytics.bandwidthRange || "1h";
    const source = state.analytics.peakSource || "activity";
    const res = await fetch(`/api/analytics/all?range=${range}&source=${source}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.bandwidth) {
      try {
        renderBandwidthChart(data.bandwidth);
      } catch (e) {
        console.error("대역폭 차트 렌더 실패:", e);
      }
    }
    if (data.peakHours) {
      try {
        renderPeakHoursChart(data.peakHours);
      } catch (e) {
        console.error("피크 시간대 차트 렌더 실패:", e);
      }
    }
    if (data.topContent) {
      try {
        renderTopContent(data.topContent);
      } catch (e) {
        console.error("Top 10 콘텐츠 렌더 실패:", e);
      }
    }
    if (data.monthlyUsers) {
      try {
        renderMonthlyUsers(data.monthlyUsers);
      } catch (e) {
        console.error("월간 사용자 소비량 렌더 실패:", e);
      }
    }
  } catch (err) {
    console.error("통계 데이터 로드 실패:", err);
  } finally {
    state.analytics.isLoading = false;
    if (refreshBtn) {
      refreshBtn.innerHTML = `<i class="fa-solid fa-rotate-right text-[10px]"></i> <span class="hidden sm:inline">새로고침</span>`;
    }
  }
}

async function loadBandwidthData() {
  try {
    const range = state.analytics.bandwidthRange || "1h";
    const res = await fetch(`/api/analytics/bandwidth?range=${range}`);
    if (!res.ok) return;
    const data = await res.json();
    renderBandwidthChart(data);
  } catch (err) {
    console.error("대역폭 데이터 갱신 실패:", err);
  }
}

async function loadPeakHoursData() {
  try {
    const src = state.analytics.peakSource || "activity";
    const res = await fetch(`/api/analytics/peak-hours?source=${src}`);
    if (!res.ok) return;
    const data = await res.json();
    renderPeakHoursChart(data);
  } catch (err) {
    console.error("피크 시간대 데이터 갱신 실패:", err);
  }
}

function updateBandwidthRangeButtons() {
  if (!el.bandwidthRangeSelector) return;
  const btns = el.bandwidthRangeSelector.querySelectorAll(".bw-range-btn");
  btns.forEach((b) => {
    if (b.dataset.range === state.analytics.bandwidthRange) {
      b.className = "bw-range-btn px-2.5 py-1 text-xs rounded-md font-semibold transition-colors bg-plex text-black";
    } else {
      b.className = "bw-range-btn px-2.5 py-1 text-xs rounded-md font-medium transition-colors text-gray-400 hover:text-white";
    }
  });
}

function updatePeakSourceButtons() {
  if (!el.peakSourceSelector) return;
  const btns = el.peakSourceSelector.querySelectorAll(".peak-src-btn");
  btns.forEach((b) => {
    if (b.dataset.source === state.analytics.peakSource) {
      b.className = "peak-src-btn px-2 py-0.5 text-[11px] rounded font-semibold transition-colors bg-plex text-black";
    } else {
      b.className = "peak-src-btn px-2 py-0.5 text-[11px] rounded font-medium transition-colors text-gray-400 hover:text-white";
    }
  });
}

// 1) 대역폭 차트 렌더링
function renderBandwidthChart(data) {
  if (!data || !data.summary || !data.points) return;

  const cur = el.bwStatCurrent || document.getElementById("bw-stat-current");
  const peak = el.bwStatPeak || document.getElementById("bw-stat-peak");
  const tot = el.bwStatTotal || document.getElementById("bw-stat-total");
  const avg = el.bwStatAvg || document.getElementById("bw-stat-avg");

  if (cur) cur.innerText = formatMbps(data.summary.current_mbps);
  if (peak) peak.innerText = formatMbps(data.summary.peak_mbps);
  if (tot) tot.innerText = data.summary.total_bytes_formatted;
  if (avg) avg.innerText = formatMbps(data.summary.avg_mbps);

  const canvas = document.getElementById("chart-bandwidth");
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    renderFallbackBandwidth(data, canvas);
    return;
  }

  if (state.analytics.bandwidthChart) {
    try {
      state.analytics.bandwidthChart.destroy();
    } catch {}
    state.analytics.bandwidthChart = null;
  }

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, "rgba(229, 160, 13, 0.40)");
  gradient.addColorStop(0.7, "rgba(229, 160, 13, 0.06)");
  gradient.addColorStop(1, "rgba(229, 160, 13, 0.0)");

  const labels = data.points.map((p) => p.time_label);
  const values = data.points.map((p) => p.total_mbps);
  const rawBytes = data.points.map((p) => p.total_bytes);

  state.analytics.bandwidthChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "대역폭",
          data: values,
          borderColor: "#e5a00d",
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: data.points.length > 70 ? 0 : 2,
          pointHoverRadius: 5,
          pointBackgroundColor: "#e5a00d",
          pointHoverBackgroundColor: "#ffffff",
          pointHoverBorderColor: "#e5a00d",
          pointHoverBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#161b22",
          borderColor: "#374151",
          borderWidth: 1,
          titleColor: "#f3f4f6",
          titleFont: { size: 11, weight: "bold" },
          bodyColor: "#d1d5db",
          bodyFont: { size: 11, family: "ui-monospace, monospace" },
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: (context) => {
              const idx = context.dataIndex;
              const mbps = context.parsed.y;
              const bytes = rawBytes[idx] || 0;
              return `대역폭: ${mbps.toFixed(2)} Mbps (${formatBytes(bytes)})`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: "rgba(255, 255, 255, 0.04)",
            drawBorder: false,
          },
          ticks: {
            color: "#9ca3af",
            font: { size: 10 },
            maxTicksLimit: 12,
            maxRotation: 0,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(255, 255, 255, 0.06)",
            drawBorder: false,
          },
          ticks: {
            color: "#9ca3af",
            font: { size: 10 },
            callback: (val) => `${val} Mbps`,
          },
        },
      },
    },
  });
}

// 2) 피크 타임 바 차트 렌더링 (00시 ~ 23시)
function renderPeakHoursChart(data) {
  if (!data || !data.hours || !data.summary) return;

  const peakBadge = el.peakHourBadge || document.getElementById("peak-hour-badge");
  const winBadge = el.peakWindowBadge || document.getElementById("peak-window-badge");
  if (peakBadge) peakBadge.innerText = data.summary.peak_hour_label;
  if (winBadge) winBadge.innerText = data.summary.busiest_window;

  const canvas = document.getElementById("chart-peak-hours");
  if (!canvas) return;

  if (typeof Chart === "undefined") {
    renderFallbackPeakHours(data, canvas);
    return;
  }

  if (state.analytics.peakHoursChart) {
    try {
      state.analytics.peakHoursChart.destroy();
    } catch {}
    state.analytics.peakHoursChart = null;
  }

  const labels = data.hours.map((h) => h.hour_label);
  const values = data.hours.map((h) => h.total_count);
  const bgColors = data.hours.map((h) =>
    h.is_peak ? "rgba(229, 160, 13, 0.9)" : "rgba(100, 116, 139, 0.45)"
  );
  const borderColors = data.hours.map((h) =>
    h.is_peak ? "#e5a00d" : "rgba(148, 163, 184, 0.6)"
  );

  const ctx = canvas.getContext("2d");
  state.analytics.peakHoursChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "활동 횟수",
          data: values,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#161b22",
          borderColor: "#374151",
          borderWidth: 1,
          titleColor: "#f3f4f6",
          titleFont: { size: 11, weight: "bold" },
          bodyColor: "#d1d5db",
          bodyFont: { size: 11 },
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: (context) => {
              const idx = context.dataIndex;
              const h = data.hours[idx];
              const peakTag = h.is_peak ? " [주요 피크 시간대]" : "";
              return [
                `활동 건수: ${h.total_count}건${peakTag}`,
                `시청 횟수: ${h.play_count}회 · 사용자: ${h.user_count}명`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#9ca3af",
            font: { size: 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(255, 255, 255, 0.05)",
            drawBorder: false,
          },
          ticks: {
            color: "#9ca3af",
            font: { size: 10 },
            precision: 0,
          },
        },
      },
    },
  });
}

// 3) 최근 30일간 최다 재생 콘텐츠 Top 10 렌더링
function renderTopContent(items) {
  const container = el.topContentList || document.getElementById("top-content-list");
  if (!container) return;

  if (!items || items.length === 0) {
    el.topContentList.innerHTML = `
      <div class="p-8 text-center text-gray-500 text-xs">
        <i class="fa-solid fa-film text-2xl mb-2 text-gray-600 block"></i>
        최근 30일간 시청된 미디어가 없습니다.
      </div>
    `;
    return;
  }

  const html = items.map((item) => {
    let rankBadge = "";
    if (item.rank === 1) {
      rankBadge = `<span class="w-5 h-5 rounded-full bg-yellow-500/20 text-yellow-400 font-bold text-xs flex items-center justify-center border border-yellow-500/40">1</span>`;
    } else if (item.rank === 2) {
      rankBadge = `<span class="w-5 h-5 rounded-full bg-slate-300/20 text-slate-200 font-bold text-xs flex items-center justify-center border border-slate-300/40">2</span>`;
    } else if (item.rank === 3) {
      rankBadge = `<span class="w-5 h-5 rounded-full bg-amber-700/20 text-amber-500 font-bold text-xs flex items-center justify-center border border-amber-600/40">3</span>`;
    } else {
      rankBadge = `<span class="w-5 h-5 rounded-full bg-gray-800 text-gray-400 font-medium text-xs flex items-center justify-center">${item.rank}</span>`;
    }

    let typeBadge = "";
    if (item.type_label === "영화") {
      typeBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/20">영화</span>`;
    } else if (item.type_label === "드라마/시리즈") {
      typeBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/20">시리즈</span>`;
    } else {
      typeBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">${escapeHtml(item.type_label)}</span>`;
    }

    let thumbHtml = "";
    if (item.thumb_url) {
      thumbHtml = `<img src="${escapeHtml(item.thumb_url)}" alt="" class="w-8 h-10 object-cover rounded shadow flex-shrink-0 bg-gray-800" onerror="this.remove()" />`;
    } else {
      const icon = item.type_label === "영화" ? "fa-film" : "fa-tv";
      thumbHtml = `<div class="w-8 h-10 rounded bg-[#0e1117] border border-gray-800 flex items-center justify-center text-gray-500 flex-shrink-0 text-xs"><i class="fa-solid ${icon}"></i></div>`;
    }

    return `
      <div class="bg-[#0e1117] border border-gray-800/80 rounded-lg p-2.5 flex items-center space-x-3 text-xs hover:border-gray-700 transition-colors">
        ${rankBadge}
        ${thumbHtml}
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center space-x-1.5 flex-wrap">
            <span class="font-bold text-white truncate text-xs">${escapeHtml(item.title)}</span>
            ${typeBadge}
          </div>
          <div class="w-full bg-gray-800/80 rounded-full h-1.5 overflow-hidden">
            <div class="bg-plex h-1.5 rounded-full" style="width: ${Math.max(4, item.percentage)}%"></div>
          </div>
          <div class="flex items-center justify-between text-[11px] text-gray-400">
            <span><strong class="text-plex font-bold">${item.play_count}회</strong> 시청 · ${item.viewer_count}명</span>
            <span class="text-gray-500 text-[10px]">${item.last_played_at.slice(5, 16)}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = html;
}

// 4) 이번 달 사용자별 추정 데이터 사용량 렌더링
function renderMonthlyUsers(data) {
  if (!data || !data.summary || !data.users) return;

  const lbl = el.monthlyLabelBadge || document.getElementById("monthly-label-badge");
  const tot = el.monthlyTotalBytes || document.getElementById("monthly-total-bytes");
  const wan = el.monthlyWanBytes || document.getElementById("monthly-wan-bytes");
  const lan = el.monthlyLanBytes || document.getElementById("monthly-lan-bytes");
  const usr = el.monthlyActiveUsers || document.getElementById("monthly-active-users");
  const avg = el.monthlyAvgUser || document.getElementById("monthly-avg-user");
  const container = el.monthlyUsersList || document.getElementById("monthly-users-list");

  if (lbl) lbl.innerText = data.month_label;
  if (tot) tot.innerText = data.summary.total_bytes_formatted;
  if (wan) wan.innerText = data.summary.wan_bytes_formatted;
  if (lan) lan.innerText = data.summary.lan_bytes_formatted;
  if (usr) usr.innerText = `${data.summary.active_users}명`;
  if (avg) avg.innerText = data.summary.avg_per_user;

  if (!container) return;

  if (data.users.length === 0) {
    el.monthlyUsersList.innerHTML = `
      <div class="p-8 text-center text-gray-500 text-xs">
        이번 달 데이터 전송 통계가 없습니다.
      </div>
    `;
    return;
  }

  const html = data.users.map((u) => {
    const initial = u.display_name.charAt(0).toUpperCase();
    const aliasHtml = u.alias ? `<span class="text-[10px] text-gray-400">(${escapeHtml(u.user_name)})</span>` : "";

    return `
      <div class="bg-[#0e1117] border border-gray-800/80 rounded-lg p-3 text-xs space-y-2 hover:border-gray-700 transition-colors">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2.5 min-w-0">
            <span class="w-5 text-center text-gray-500 font-bold text-xs">${u.rank}</span>
            <div class="w-6 h-6 rounded bg-gray-800 text-white font-bold flex items-center justify-center text-[11px] flex-shrink-0">${initial}</div>
            <div class="truncate">
              <span class="font-bold text-white">${escapeHtml(u.alias || u.user_name)}</span>
              ${aliasHtml}
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <span class="font-mono font-bold text-plex text-sm">${u.total_bytes_formatted}</span>
            <span class="text-[10px] text-gray-400 ml-1 font-mono">(${u.percentage}%)</span>
          </div>
        </div>

        <!-- 점유율 프로그레스 바 -->
        <div class="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div class="bg-gradient-to-r from-plex to-amber-500 h-1.5 rounded-full" style="width: ${Math.max(2, u.percentage)}%"></div>
        </div>

        <!-- WAN vs LAN 세부 전송량 -->
        <div class="flex items-center justify-between text-[10px] text-gray-500">
          <span>외부 (WAN): <strong class="text-amber-400/90">${u.wan_bytes_formatted}</strong></span>
          <span>내부 (LAN): <strong class="text-gray-400">${u.lan_bytes_formatted}</strong></span>
        </div>
      </div>
    `;
  }).join("");
  container.innerHTML = html;
}
function renderFallbackBandwidth(data, canvas) {
  const container = canvas.parentElement;
  if (!container) return;
  const points = data.points || [];
  const max = Math.max(...points.map((p) => p.total_mbps), 1);
  const bars = points
    .map(
      (p) => `
      <div class="flex-1 flex flex-col items-center justify-end h-full group relative" title="${p.time_label}: ${p.total_mbps} Mbps">
        <div class="w-full bg-plex/80 hover:bg-plex rounded-t transition-all" style="height: ${Math.max(4, Math.round((p.total_mbps / max) * 100))}%;"></div>
      </div>
    `
    )
    .join("");
  container.innerHTML = `
    <div class="w-full h-full flex items-end gap-0.5 pt-4 pb-1">
      ${bars}
    </div>
  `;
}

function renderFallbackPeakHours(data, canvas) {
  const container = canvas.parentElement;
  if (!container) return;
  const hours = data.hours || [];
  const max = Math.max(...hours.map((h) => h.total_count), 1);
  const bars = hours
    .map(
      (h) => `
      <div class="flex-1 flex flex-col items-center justify-end h-full group relative" title="${h.hour_label}: ${h.total_count}건">
        <div class="w-full ${h.is_peak ? "bg-plex" : "bg-slate-600/60"} hover:bg-plex rounded-t transition-all" style="height: ${Math.max(4, Math.round((h.total_count / max) * 100))}%;"></div>
        <span class="text-[8px] text-gray-500 mt-1 select-none">${h.hour % 3 === 0 ? h.hour : ""}</span>
      </div>
    `
    )
    .join("");
  container.innerHTML = `
    <div class="w-full h-full flex items-end gap-1 pt-4 pb-2">
      ${bars}
    </div>
  `;
}
// 앱 실행
document.addEventListener("DOMContentLoaded", init);
