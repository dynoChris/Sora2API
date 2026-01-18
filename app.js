import {
  getCurrentUser,
  logEvent,
  onAuthReady,
  waitForAuth,
} from "./firebase.js?v=20250121";

const toggleGroups = document.querySelectorAll("[data-toggle-group]");
const mainTabGroup = document.querySelector(
  '[data-toggle-group][data-toggle-target="main"]'
);
const openTabButtons = document.querySelectorAll("[data-open-tab]");
const runButton = document.querySelector('[data-action="run"]');
const promptInput = document.querySelector("#prompt-input");
const watermarkToggle = document.querySelector("#watermark-toggle");
const videoPlayer = document.querySelector(".video-player");

const safeLogEvent = (name, meta) => {
  logEvent(name, meta).catch(() => {});
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
    safeLogEvent("run_authenticated");
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

let pageViewLogged = false;
onAuthReady((user) => {
  if (!pageViewLogged) {
    safeLogEvent("page_view", { page: "playground", status: user.isAnonymous });
    pageViewLogged = true;
  }
});
