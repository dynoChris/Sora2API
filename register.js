import {
  getCurrentUser,
  logEvent,
  onAuthReady,
  registerWithEmail,
  signInWithEmail,
} from "./firebase.js?v=20260120";

const form = document.querySelector("#auth-form");
const statusEl = document.querySelector("#auth-status");
const submitBtn = document.querySelector("#auth-submit");
const continueBtn = document.querySelector("#continue-btn");
const emailInput = document.querySelector("#reg-email");
const passwordInput = document.querySelector("#reg-password");
const toggle = document.querySelector("[data-auth-toggle]");
const titleEl = document.querySelector("#auth-title");
const subtitleEl = document.querySelector("#auth-subtitle");
const passwordHelp = document.querySelector("#password-help");

let authReady = false;
let mode = "register";
let redirectScheduled = false;

const safeLogEvent = (name, meta) => {
  logEvent(name, meta).catch(() => {});
};

const setStatus = (message, tone) => {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.remove("success", "error");
  if (tone) {
    statusEl.classList.add(tone);
  }
};

const showContinue = () => {
  if (continueBtn) {
    continueBtn.classList.remove("hidden");
  }
};

const redirectToPlayground = () => {
  if (redirectScheduled) {
    return;
  }
  redirectScheduled = true;
  window.location.replace("index.html");
};

const setDisabled = (disabled) => {
  if (submitBtn) {
    submitBtn.disabled = disabled;
  }
  if (emailInput) {
    emailInput.disabled = disabled;
  }
  if (passwordInput) {
    passwordInput.disabled = disabled;
  }
  if (toggle) {
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.disabled = disabled;
    });
  }
};

const normalizeError = (error, nextMode) => {
  if (!error || !error.code) {
    return "Something went wrong. Please try again.";
  }
  if (
    nextMode === "login" &&
    [
      "auth/user-not-found",
      "auth/wrong-password",
      "auth/invalid-credential",
      "auth/invalid-login-credentials",
    ].includes(error.code)
  ) {
    return "Incorrect email or password.";
  }
  switch (error.code) {
    case "auth/email-already-in-use":
      return "This email is already in use. Try another one.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/operation-not-allowed":
      return "Email/password auth is not enabled.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Auth.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait and try again.";
    default:
      return nextMode === "login"
        ? "Unable to sign in. Please try again."
        : "Unable to register. Please try again.";
  }
};

const modeCopy = {
  register: {
    title: "Create your account",
    subtitle:
      "Register to run generations, save history, and unlock upcoming features.",
    submit: "Create account",
    placeholder: "At least 6 characters",
    autocomplete: "new-password",
    helpVisible: true,
  },
  login: {
    title: "Sign in to your account",
    subtitle: "Access your saved history and run new generations.",
    submit: "Sign in",
    placeholder: "Your password",
    autocomplete: "current-password",
    helpVisible: false,
  },
};

const setMode = (nextMode, shouldLog = true) => {
  if (!modeCopy[nextMode]) {
    return;
  }
  mode = nextMode;

  if (form) {
    form.dataset.authMode = nextMode;
  }
  if (titleEl) {
    titleEl.textContent = modeCopy[nextMode].title;
  }
  if (subtitleEl) {
    subtitleEl.textContent = modeCopy[nextMode].subtitle;
  }
  if (submitBtn) {
    submitBtn.textContent = modeCopy[nextMode].submit;
  }
  if (passwordInput) {
    passwordInput.placeholder = modeCopy[nextMode].placeholder;
    passwordInput.autocomplete = modeCopy[nextMode].autocomplete;
  }
  if (passwordHelp) {
    passwordHelp.classList.toggle("hidden", !modeCopy[nextMode].helpVisible);
  }

  if (toggle) {
    toggle.querySelectorAll("button").forEach((btn) => {
      const isActive = btn.dataset.authMode === nextMode;
      btn.classList.toggle("active", isActive);
    });
  }

  setStatus("", null);
  if (shouldLog) {
    safeLogEvent("auth_mode_switch", { mode: nextMode });
  }
};

if (toggle) {
  toggle.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) {
      return;
    }
    const nextMode = button.dataset.authMode;
    if (nextMode && nextMode !== mode) {
      setMode(nextMode);
    }
  });
}

onAuthReady((user) => {
  authReady = true;
  safeLogEvent("auth_view", { mode });

  if (user && !user.isAnonymous) {
    setStatus("You are already signed in. Redirecting...", "success");
    showContinue();
    setDisabled(true);
    redirectToPlayground();
    return;
  }

  setDisabled(false);
});

if (continueBtn) {
  continueBtn.addEventListener("click", () => {
    safeLogEvent("auth_continue");
    window.location.href = "index.html";
  });
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!authReady) {
      setStatus("Preparing your session. Please try again in a moment.", "error");
      return;
    }

    const email = emailInput ? emailInput.value.trim() : "";
    const password = passwordInput ? passwordInput.value : "";

    if (!email || !password) {
      setStatus("Enter your email and password to continue.", "error");
      return;
    }

    const user = getCurrentUser();
    if (user && !user.isAnonymous) {
      setStatus("You are already signed in.", "success");
      showContinue();
      setDisabled(true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }

    const statusCopy =
      mode === "login" ? "Signing you in..." : "Creating your account...";
    setStatus(statusCopy, null);
    safeLogEvent("auth_submit", { mode });

    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
        safeLogEvent("auth_success", { mode });
        setStatus("Signed in successfully. Redirecting...", "success");
      } else {
        await registerWithEmail(email, password);
        safeLogEvent("auth_success", { mode });
        setStatus("Account created. Redirecting...", "success");
      }
      showContinue();
      redirectToPlayground();
    } catch (error) {
      safeLogEvent("auth_error", { mode, code: error.code || "unknown" });
      setStatus(normalizeError(error, mode), "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  });
}

setMode("register", false);
