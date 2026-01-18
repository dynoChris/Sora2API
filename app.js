import {
  getCurrentUser,
  getIdToken,
  logEvent,
  onAuthReady,
  signOutUser,
  waitForAuth,
} from "./firebase.js?v=20250123";

const toggleGroups = document.querySelectorAll("[data-toggle-group]");
const mainTabGroup = document.querySelector(
  '[data-toggle-group][data-toggle-target="main"]'
);
const openTabButtons = document.querySelectorAll("[data-open-tab]");
const runButton = document.querySelector('[data-action="run"]');
const runText = runButton ? runButton.querySelector(".run-text") : null;
const promptInput = document.querySelector("#prompt-input");
const watermarkToggle = document.querySelector("#watermark-toggle");
const videoPlayer = document.querySelector(".video-player");
const durationGroup = document.querySelector('[data-setting="duration"]');
const orientationGroup = document.querySelector('[data-setting="orientation"]');
const generationStatus = document.querySelector("#generation-status");
const historyList = document.querySelector("#video-history");
const historyCount = document.querySelector("#history-count");
const profileButton = document.querySelector("[data-profile-btn]");
const profileMenu = document.querySelector("[data-profile-menu]");
const profileEmail = document.querySelector("[data-profile-email]");
const profileSignout = document.querySelector("[data-profile-signout]");

const safeLogEvent = (name, meta) => {
  logEvent(name, meta).catch(() => {});
};

let activeUser = null;
let generationInFlight = false;

const API_BASE = "https://us-central1-sora2api-9feeb.cloudfunctions.net";
const CREATE_ENDPOINT = `${API_BASE}/createSoraTask`;
const QUERY_ENDPOINT = `${API_BASE}/getSoraTask`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getActiveSegmentValue = (group) => {
  if (!group) {
    return "";
  }
  const active = group.querySelector(".seg.active");
  return active ? active.textContent.trim() : "";
};

const setRunButtonState = (isLoading) => {
  if (!runButton) {
    return;
  }
  runButton.classList.toggle("loading", isLoading);
  runButton.setAttribute("aria-busy", isLoading ? "true" : "false");
  if (runText) {
    runText.textContent = isLoading ? "Running..." : "30 Run";
  }
};

const setGenerationStatus = (message, tone) => {
  if (!generationStatus) {
    return;
  }
  generationStatus.textContent = message;
  generationStatus.classList.remove("running", "error");
  if (tone) {
    generationStatus.classList.add(tone);
  }
};

const updateHistoryCount = () => {
  if (!historyCount || !historyList) {
    return;
  }
  const total = historyList.querySelectorAll(".history-item").length;
  historyCount.textContent = String(total);
};

const addHistoryItem = (url, elapsedSeconds) => {
  if (!historyList) {
    return;
  }
  const empty = historyList.querySelector(".history-empty");
  if (empty) {
    empty.remove();
  }

  const item = document.createElement("div");
  item.className = "history-item";

  const thumb = document.createElement("div");
  thumb.className = "history-thumb";
  const thumbVideo = document.createElement("video");
  thumbVideo.src = url;
  thumbVideo.controls = true;
  thumbVideo.preload = "metadata";
  thumb.appendChild(thumbVideo);

  const info = document.createElement("div");
  info.className = "history-info";

  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = "Generated video";

  const meta = document.createElement("div");
  meta.className = "history-meta";

  const time = document.createElement("span");
  time.textContent = `Generated in ${elapsedSeconds.toFixed(3)} seconds`;

  const status = document.createElement("span");
  status.className = "history-status";
  const dot = document.createElement("span");
  dot.className = "dot";
  const statusText = document.createElement("span");
  statusText.textContent = "Complete";
  status.appendChild(dot);
  status.appendChild(statusText);

  meta.appendChild(time);
  meta.appendChild(status);
  info.appendChild(title);
  info.appendChild(meta);

  item.appendChild(thumb);
  item.appendChild(info);
  historyList.prepend(item);
  updateHistoryCount();
};

const closeProfileMenu = () => {
  if (profileMenu) {
    profileMenu.classList.remove("open");
  }
  if (profileButton) {
    profileButton.setAttribute("aria-expanded", "false");
  }
};

const openProfileMenu = () => {
  if (profileMenu) {
    profileMenu.classList.add("open");
  }
  if (profileButton) {
    profileButton.setAttribute("aria-expanded", "true");
  }
};

const updateProfileUI = (user) => {
  activeUser = user;
  if (!profileMenu || !profileButton) {
    return;
  }

  const isLoggedIn = user && !user.isAnonymous && user.email;
  profileButton.dataset.loggedIn = isLoggedIn ? "true" : "false";
  if (profileEmail) {
    profileEmail.textContent = isLoggedIn ? user.email : "";
  }
  if (!isLoggedIn) {
    closeProfileMenu();
  }
};

const updatePanels = (group, value) => {
  const target = group.dataset.toggleTarget;
  if (!target || !value) {
    return;
  }

  const panels = document.querySelectorAll(`[data-toggle-panel="${target}"]`);
  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panelValue === value);
  });
};

const activateGroupValue = (group, value) => {
  const buttons = Array.from(group.querySelectorAll("button"));
  const targetButton = buttons.find(
    (item) => item.dataset.toggleValue === value
  );
  const activeButton = targetButton || buttons[0];
  if (!activeButton) {
    return;
  }

  buttons.forEach((item) => item.classList.remove("active"));
  activeButton.classList.add("active");
  updatePanels(group, activeButton.dataset.toggleValue);
};

const logToggleEvent = (group, value) => {
  const target = group.dataset.toggleTarget;
  if (target === "main") {
    safeLogEvent("tab_switch", { tab: value });
    return;
  }
  if (target === "input") {
    safeLogEvent("input_mode_switch", { mode: value });
    return;
  }
  if (target === "output") {
    safeLogEvent("output_mode_switch", { mode: value });
    return;
  }

  const setting = group.dataset.setting;
  if (setting) {
    safeLogEvent("setting_change", { setting, value });
  }
};

toggleGroups.forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.classList.contains("icon-only")) {
      return;
    }

    const buttons = group.querySelectorAll("button");
    buttons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    updatePanels(group, button.dataset.toggleValue);

    const value = button.dataset.toggleValue || button.textContent.trim();
    logToggleEvent(group, value);
  });
});

openTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!mainTabGroup) {
      return;
    }

    const value = button.dataset.openTab;
    activateGroupValue(mainTabGroup, value);
    safeLogEvent("run_with_api_click", { open: value });
    safeLogEvent("tab_switch", { tab: value, source: "cta" });

    const tabs = document.querySelector(".tabs");
    if (tabs) {
      tabs.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-event]");
  if (!button) {
    return;
  }
  safeLogEvent(button.dataset.event);
});

const waitForAuthReady = async () => {
  if (getCurrentUser()) {
    return getCurrentUser();
  }
  await Promise.race([
    waitForAuth(),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  return getCurrentUser();
};

if (runButton) {
  runButton.addEventListener("click", async (event) => {
    const user = await waitForAuthReady();
    safeLogEvent("run_click");

    if (!user || user.isAnonymous) {
      safeLogEvent("redirect_register");
      event.preventDefault();
      window.location.href = "register.html";
      return;
    }

    event.preventDefault();
    if (generationInFlight) {
      return;
    }

    const prompt = promptInput ? promptInput.value.trim() : "";
    if (!prompt) {
      setGenerationStatus("Prompt is required.", "error");
      return;
    }

    const durationLabel = getActiveSegmentValue(durationGroup);
    const duration = Number.parseInt(durationLabel.replace("s", ""), 10) || 10;
    const orientationLabel = getActiveSegmentValue(orientationGroup);
    const orientation = orientationLabel.toLowerCase() || "landscape";
    const removeWatermark = watermarkToggle ? watermarkToggle.checked : false;

    const token = await getIdToken();
    if (!token) {
      setGenerationStatus("Authentication required.", "error");
      return;
    }

    generationInFlight = true;
    setRunButtonState(true);
    setGenerationStatus("Submitting generation request...", "running");
    safeLogEvent("run_authenticated", {
      duration,
      orientation,
      remove_watermark: removeWatermark,
    });

    const startTime = performance.now();

    try {
      const createResponse = await fetch(CREATE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt,
          duration,
          orientation,
          removeWatermark,
        }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createData.error || "Failed to start generation");
      }

      const taskId = createData.taskId;
      if (!taskId) {
        throw new Error("Task ID missing from server response");
      }

      setGenerationStatus("Generating video...", "running");

      let outputUrl = "";
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await sleep(5000);
        const queryResponse = await fetch(
          `${QUERY_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        const queryData = await queryResponse.json();
        if (!queryResponse.ok) {
          throw new Error(queryData.error || "Failed to fetch status");
        }

        const status = (queryData.status || "").toLowerCase();
        outputUrl = queryData.outputUrl || outputUrl;

        if (["succeeded", "completed", "success", "done"].includes(status)) {
          break;
        }

        if (["failed", "error", "canceled"].includes(status)) {
          throw new Error("Generation failed");
        }
      }

      if (!outputUrl) {
        throw new Error("No video URL returned");
      }

      const elapsedSeconds = (performance.now() - startTime) / 1000;
      setGenerationStatus(
        `Generated in ${elapsedSeconds.toFixed(3)} seconds`,
        null
      );
      safeLogEvent("generation_complete", {
        elapsed_seconds: Number(elapsedSeconds.toFixed(3)),
      });

      if (videoPlayer) {
        videoPlayer.src = outputUrl;
        videoPlayer.load();
      }
      addHistoryItem(outputUrl, elapsedSeconds);
    } catch (error) {
      setGenerationStatus(error.message || "Generation failed.", "error");
      safeLogEvent("generation_error", {
        message: error.message || "unknown",
      });
    } finally {
      generationInFlight = false;
      setRunButtonState(false);
    }
  });
}

if (promptInput) {
  promptInput.addEventListener("blur", () => {
    safeLogEvent("prompt_blur", { length: promptInput.value.trim().length });
  });
}

if (watermarkToggle) {
  watermarkToggle.addEventListener("change", () => {
    safeLogEvent("watermark_toggle", { enabled: watermarkToggle.checked });
  });
}

if (videoPlayer) {
  videoPlayer.addEventListener("play", () => {
    safeLogEvent("video_play");
  });
}

if (profileButton) {
  profileButton.addEventListener("click", (event) => {
    event.preventDefault();
    const user = activeUser;
    if (!user || user.isAnonymous) {
      safeLogEvent("profile_redirect_register");
      window.location.href = "register.html";
      return;
    }

    if (profileMenu && profileMenu.classList.contains("open")) {
      closeProfileMenu();
      return;
    }
    safeLogEvent("profile_open");
    openProfileMenu();
  });
}

if (profileSignout) {
  profileSignout.addEventListener("click", async (event) => {
    event.preventDefault();
    safeLogEvent("sign_out");
    try {
      await signOutUser();
    } catch (error) {
      // Ignore sign-out errors to avoid trapping the user.
    }
    closeProfileMenu();
    window.location.href = "register.html";
  });
}

document.addEventListener("click", (event) => {
  if (!profileMenu || !profileButton) {
    return;
  }
  const isInside = event.target.closest(".profile-wrapper");
  if (!isInside && profileMenu.classList.contains("open")) {
    closeProfileMenu();
  }
});

let pageViewLogged = false;
onAuthReady((user) => {
  updateProfileUI(user);
  if (!pageViewLogged) {
    safeLogEvent("page_view", { page: "playground", status: user.isAnonymous });
    pageViewLogged = true;
  }
});
